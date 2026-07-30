
-- 1. Rate limit tracking table
CREATE TABLE IF NOT EXISTS public.sync_rate_limit (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_sync_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_rate_limit TO authenticated;
GRANT ALL ON public.sync_rate_limit TO service_role;

ALTER TABLE public.sync_rate_limit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_rate_limit" ON public.sync_rate_limit;
CREATE POLICY "own_rate_limit" ON public.sync_rate_limit
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2. Patch sync_upsert_row: 24h throttle guard at the top
CREATE OR REPLACE FUNCTION public.sync_upsert_row(p_table text, p_row jsonb, p_base_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_current_version bigint;
  v_current_row jsonb;
  v_merged jsonb;
  v_client_meta jsonb := coalesce(p_row->'field_meta', '{}'::jsonb);
  v_server_meta jsonb;
  v_key text;
  v_client_ts timestamptz;
  v_server_ts timestamptz;
  v_conflicts int := 0;
  v_allowed_tables text[] := ARRAY[
    'horses','calendar_events','rides','body_scan_history',
    'horse_journal','course_progress','profile_values'
  ];
  v_is_profile_values boolean;
  v_col_list text;
  v_insert_cols text;
  v_pv_key text;
  v_pv_value jsonb;
  v_pv_existing_data jsonb;
  v_pv_new_data jsonb;
  v_clean_row jsonb;
  v_last_sync timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- ============================================================
  -- RATE LIMIT GUARD: max 1 sync run per user per 24h.
  -- Any further calls return 200 OK immediately without any DB writes,
  -- triggers, or version changes.
  -- ============================================================
  SELECT last_sync_at INTO v_last_sync
    FROM public.sync_rate_limit
   WHERE user_id = v_uid;

  IF v_last_sync IS NOT NULL AND v_last_sync > (now() - interval '24 hours') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'throttled', true,
      'conflict', false,
      'row', coalesce(p_row, '{}'::jsonb),
      'retry_after', extract(epoch from ((v_last_sync + interval '24 hours') - now()))::bigint
    );
  END IF;

  -- Not throttled: mark this call as the start of the 24h window.
  INSERT INTO public.sync_rate_limit (user_id, last_sync_at, sync_count)
  VALUES (v_uid, now(), 1)
  ON CONFLICT (user_id) DO UPDATE
    SET last_sync_at = now(),
        sync_count = public.sync_rate_limit.sync_count + 1,
        updated_at = now();

  IF NOT (p_table = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'table_not_allowed: %', p_table;
  END IF;
  IF (p_row->>'user_id')::uuid <> v_uid THEN
    RAISE EXCEPTION 'user_id_mismatch';
  END IF;

  v_is_profile_values := (p_table = 'profile_values');

  IF v_is_profile_values THEN
    SELECT data INTO v_pv_existing_data FROM public.profile_values WHERE user_id = v_uid;

    IF (p_row ? 'data') AND (p_row->'data') IS NOT NULL AND jsonb_typeof(p_row->'data') = 'object' THEN
      v_pv_new_data := p_row->'data';
    ELSIF (p_row ? 'key') THEN
      v_pv_key := p_row->>'key';
      IF (p_row ? 'value') THEN
        IF jsonb_typeof(p_row->'value') IN ('object','array','number','boolean','null') THEN
          v_pv_value := p_row->'value';
        ELSE
          v_pv_value := to_jsonb(p_row->>'value');
        END IF;
      ELSE
        v_pv_value := 'null'::jsonb;
      END IF;
      v_pv_new_data := coalesce(v_pv_existing_data, '{}'::jsonb)
                       || jsonb_build_object(v_pv_key, v_pv_value);
    ELSE
      v_pv_new_data := coalesce(v_pv_existing_data, '{}'::jsonb);
    END IF;

    p_row := (p_row - 'key' - 'value' - 'id') || jsonb_build_object('data', v_pv_new_data);
  END IF;

  IF v_is_profile_values THEN
    SELECT to_jsonb(t.*), t.version, coalesce(t.field_meta, '{}'::jsonb)
      INTO v_current_row, v_current_version, v_server_meta
      FROM public.profile_values t
     WHERE t.user_id = v_uid;
  ELSE
    v_id := (p_row->>'id')::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'missing_id_for_%', p_table;
    END IF;
    EXECUTE format(
      'SELECT to_jsonb(t.*), t.version, coalesce(t.field_meta, ''{}''::jsonb) FROM public.%I t WHERE t.id = $1 AND t.user_id = $2',
      p_table
    ) INTO v_current_row, v_current_version, v_server_meta
    USING v_id, v_uid;
  END IF;

  SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    INTO v_clean_row
    FROM jsonb_each(p_row) AS kv(k, v)
   WHERE v IS NOT NULL
     AND jsonb_typeof(v) <> 'null'
     AND EXISTS (
       SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = p_table
          AND c.column_name = kv.k
     );

  SELECT string_agg(quote_ident(column_name), ',')
    INTO v_col_list
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = p_table
     AND column_name NOT IN ('id','user_id','created_at','updated_at','version');

  SELECT string_agg(quote_ident(k), ',')
    INTO v_insert_cols
    FROM jsonb_object_keys(v_clean_row) AS k;

  IF v_current_row IS NULL OR v_current_version <= p_base_version THEN
    IF v_current_row IS NULL THEN
      IF v_insert_cols IS NULL THEN
        IF v_is_profile_values THEN
          EXECUTE 'INSERT INTO public.profile_values (user_id) VALUES ($1) RETURNING to_jsonb(public.profile_values.*)'
            INTO v_merged USING v_uid;
        ELSE
          EXECUTE format(
            'INSERT INTO public.%I (id, user_id) VALUES ($1, $2) RETURNING to_jsonb(public.%I.*)',
            p_table, p_table
          ) INTO v_merged USING v_id, v_uid;
        END IF;
      ELSE
        EXECUTE format(
          'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) RETURNING to_jsonb(public.%I.*)',
          p_table, v_insert_cols, v_insert_cols, p_table, p_table
        ) INTO v_merged USING v_clean_row;
      END IF;
    ELSE
      v_merged := v_current_row || v_clean_row;
      IF v_is_profile_values THEN
        EXECUTE format(
          'UPDATE public.profile_values SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.profile_values, $1)) WHERE user_id = $2 RETURNING to_jsonb(public.profile_values.*)',
          v_col_list, v_col_list
        ) INTO v_merged USING v_merged, v_uid;
      ELSE
        EXECUTE format(
          'UPDATE public.%I SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)) WHERE id = $2 AND user_id = $3 RETURNING to_jsonb(public.%I.*)',
          p_table, v_col_list, v_col_list, p_table, p_table
        ) INTO v_merged USING v_merged, v_id, v_uid;
      END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', v_merged);
  END IF;

  v_merged := v_current_row;
  FOR v_key IN SELECT jsonb_object_keys(v_clean_row) LOOP
    IF v_key IN ('id','user_id','created_at','updated_at','version','field_meta') THEN
      CONTINUE;
    END IF;
    v_client_ts := NULLIF(v_client_meta->>v_key, '')::timestamptz;
    v_server_ts := NULLIF(v_server_meta->>v_key, '')::timestamptz;

    IF v_client_ts IS NOT NULL AND (v_server_ts IS NULL OR v_client_ts > v_server_ts) THEN
      IF v_server_ts IS NOT NULL AND (v_current_row->v_key) IS DISTINCT FROM (v_clean_row->v_key) THEN
        INSERT INTO public.sync_conflicts(user_id, table_name, row_id, field, server_value, client_value, chosen, server_ts, client_ts)
        VALUES (v_uid, p_table, coalesce(v_id, v_uid), v_key, v_current_row->v_key, v_clean_row->v_key, 'client', v_server_ts, v_client_ts);
        v_conflicts := v_conflicts + 1;
      END IF;
      v_merged := jsonb_set(v_merged, ARRAY[v_key], v_clean_row->v_key, true);
      v_server_meta := jsonb_set(v_server_meta, ARRAY[v_key], to_jsonb(v_client_ts::text), true);
    ELSIF v_client_ts IS NOT NULL AND v_server_ts IS NOT NULL AND v_client_ts < v_server_ts THEN
      IF (v_current_row->v_key) IS DISTINCT FROM (v_clean_row->v_key) THEN
        INSERT INTO public.sync_conflicts(user_id, table_name, row_id, field, server_value, client_value, chosen, server_ts, client_ts)
        VALUES (v_uid, p_table, coalesce(v_id, v_uid), v_key, v_current_row->v_key, v_clean_row->v_key, 'server', v_server_ts, v_client_ts);
        v_conflicts := v_conflicts + 1;
      END IF;
    END IF;
  END LOOP;

  v_merged := jsonb_set(v_merged, '{field_meta}', v_server_meta, true);

  IF v_is_profile_values THEN
    EXECUTE format(
      'UPDATE public.profile_values SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.profile_values, $1)) WHERE user_id = $2 RETURNING to_jsonb(public.profile_values.*)',
      v_col_list, v_col_list
    ) INTO v_merged USING v_merged, v_uid;
  ELSE
    EXECUTE format(
      'UPDATE public.%I SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)) WHERE id = $2 AND user_id = $3 RETURNING to_jsonb(public.%I.*)',
      p_table, v_col_list, v_col_list, p_table, p_table
    ) INTO v_merged USING v_merged, v_id, v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'conflict', true, 'conflicts', v_conflicts, 'row', v_merged);
END;
$function$;
