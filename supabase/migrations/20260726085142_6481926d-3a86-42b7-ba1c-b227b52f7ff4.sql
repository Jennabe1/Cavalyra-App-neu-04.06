-- 1. Add missing field_meta columns (additive, safe defaults)
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS field_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.body_scan_history
  ADD COLUMN IF NOT EXISTS field_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Replace sync_upsert_row with a schema-tolerant version.
--    - profile_values: keyed by user_id (no id column)
--    - all other allowed tables: keyed by id
--    - field_meta is now guaranteed to exist on every allowed table
CREATE OR REPLACE FUNCTION public.sync_upsert_row(
  p_table text,
  p_row jsonb,
  p_base_version bigint
)
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (p_table = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'table_not_allowed: %', p_table;
  END IF;
  IF (p_row->>'user_id')::uuid <> v_uid THEN
    RAISE EXCEPTION 'user_id_mismatch';
  END IF;

  v_is_profile_values := (p_table = 'profile_values');

  -- Fetch current server row (identity depends on table)
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

  -- Build the writable column list once (exclude system columns)
  SELECT string_agg(quote_ident(column_name), ',')
    INTO v_col_list
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = p_table
     AND column_name NOT IN ('id','user_id','created_at','updated_at','version');

  -- ---------- Conflict-free path ----------
  IF v_current_row IS NULL OR v_current_version <= p_base_version THEN
    IF v_is_profile_values THEN
      -- Upsert by user_id (single row per user)
      IF v_current_row IS NULL THEN
        EXECUTE format(
          'INSERT INTO public.profile_values SELECT * FROM jsonb_populate_record(NULL::public.profile_values, $1) RETURNING to_jsonb(public.profile_values.*)'
        ) INTO v_merged USING p_row;
      ELSE
        EXECUTE format(
          'UPDATE public.profile_values SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.profile_values, $1)) WHERE user_id = $2 RETURNING to_jsonb(public.profile_values.*)',
          v_col_list, v_col_list
        ) INTO v_merged USING p_row, v_uid;
      END IF;
    ELSE
      IF v_current_row IS NULL THEN
        EXECUTE format(
          'INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1) RETURNING to_jsonb(public.%I.*)',
          p_table, p_table, p_table
        ) INTO v_merged USING p_row;
      ELSE
        EXECUTE format(
          'UPDATE public.%I SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)) WHERE id = $2 AND user_id = $3 RETURNING to_jsonb(public.%I.*)',
          p_table, v_col_list, v_col_list, p_table, p_table
        ) INTO v_merged USING p_row, v_id, v_uid;
      END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', v_merged);
  END IF;

  -- ---------- Field-level LWW merge ----------
  v_merged := v_current_row;
  FOR v_key IN SELECT jsonb_object_keys(p_row) LOOP
    IF v_key IN ('id','user_id','created_at','updated_at','version','field_meta') THEN
      CONTINUE;
    END IF;
    v_client_ts := NULLIF(v_client_meta->>v_key, '')::timestamptz;
    v_server_ts := NULLIF(v_server_meta->>v_key, '')::timestamptz;

    IF v_client_ts IS NOT NULL AND (v_server_ts IS NULL OR v_client_ts > v_server_ts) THEN
      IF v_server_ts IS NOT NULL AND (v_current_row->v_key) IS DISTINCT FROM (p_row->v_key) THEN
        INSERT INTO public.sync_conflicts(user_id, table_name, row_id, field, server_value, client_value, chosen, server_ts, client_ts)
        VALUES (v_uid, p_table, coalesce(v_id, v_uid), v_key, v_current_row->v_key, p_row->v_key, 'client', v_server_ts, v_client_ts);
        v_conflicts := v_conflicts + 1;
      END IF;
      v_merged := jsonb_set(v_merged, ARRAY[v_key], p_row->v_key, true);
      v_server_meta := jsonb_set(v_server_meta, ARRAY[v_key], to_jsonb(v_client_ts::text), true);
    ELSIF v_client_ts IS NOT NULL AND v_server_ts IS NOT NULL AND v_client_ts < v_server_ts THEN
      IF (v_current_row->v_key) IS DISTINCT FROM (p_row->v_key) THEN
        INSERT INTO public.sync_conflicts(user_id, table_name, row_id, field, server_value, client_value, chosen, server_ts, client_ts)
        VALUES (v_uid, p_table, coalesce(v_id, v_uid), v_key, v_current_row->v_key, p_row->v_key, 'server', v_server_ts, v_client_ts);
        v_conflicts := v_conflicts + 1;
      END IF;
    END IF;
  END LOOP;

  v_merged := jsonb_set(v_merged, '{field_meta}', v_server_meta, true);

  -- Apply merged row back
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