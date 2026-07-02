
-- =========================================================
-- CAVALYRA CLOUD ARCHITECTURE - Foundation Migration
-- =========================================================

-- 1) Global monotonic version sequence (used for delta sync)
CREATE SEQUENCE IF NOT EXISTS public.sync_version_seq;

-- 2) Generic trigger: sets updated_at + version on every write
CREATE OR REPLACE FUNCTION public.tg_set_sync_meta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := nextval('public.sync_version_seq');
  RETURN NEW;
END;
$$;

-- =========================================================
-- 3) Extend existing tables
-- =========================================================

-- horses
ALTER TABLE public.horses
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT nextval('public.sync_version_seq'),
  ADD COLUMN IF NOT EXISTS field_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS photo_path text;
-- keep `deleted` boolean for backward compat, but new code uses deleted_at

DROP TRIGGER IF EXISTS trg_horses_sync_meta ON public.horses;
CREATE TRIGGER trg_horses_sync_meta
BEFORE INSERT OR UPDATE ON public.horses
FOR EACH ROW EXECUTE FUNCTION public.tg_set_sync_meta();

CREATE INDEX IF NOT EXISTS idx_horses_user_version ON public.horses(user_id, version);
CREATE INDEX IF NOT EXISTS idx_horses_user_deleted ON public.horses(user_id) WHERE deleted_at IS NULL;

-- calendar_events
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT nextval('public.sync_version_seq'),
  ADD COLUMN IF NOT EXISTS field_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS horse_id uuid;

DROP TRIGGER IF EXISTS trg_calendar_events_sync_meta ON public.calendar_events;
CREATE TRIGGER trg_calendar_events_sync_meta
BEFORE INSERT OR UPDATE ON public.calendar_events
FOR EACH ROW EXECUTE FUNCTION public.tg_set_sync_meta();

CREATE INDEX IF NOT EXISTS idx_calendar_user_version ON public.calendar_events(user_id, version);

-- body_scan_history
ALTER TABLE public.body_scan_history
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT nextval('public.sync_version_seq'),
  ADD COLUMN IF NOT EXISTS image_paths text[] NOT NULL DEFAULT '{}';

DROP TRIGGER IF EXISTS trg_body_scan_sync_meta ON public.body_scan_history;
CREATE TRIGGER trg_body_scan_sync_meta
BEFORE INSERT OR UPDATE ON public.body_scan_history
FOR EACH ROW EXECUTE FUNCTION public.tg_set_sync_meta();

CREATE INDEX IF NOT EXISTS idx_body_scan_user_version ON public.body_scan_history(user_id, version);

-- horse_journal
ALTER TABLE public.horse_journal
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT nextval('public.sync_version_seq'),
  ADD COLUMN IF NOT EXISTS field_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

DROP TRIGGER IF EXISTS trg_horse_journal_sync_meta ON public.horse_journal;
CREATE TRIGGER trg_horse_journal_sync_meta
BEFORE INSERT OR UPDATE ON public.horse_journal
FOR EACH ROW EXECUTE FUNCTION public.tg_set_sync_meta();

CREATE INDEX IF NOT EXISTS idx_horse_journal_user_version ON public.horse_journal(user_id, version);

-- profile_values (single row per user; no deleted_at needed)
ALTER TABLE public.profile_values
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT nextval('public.sync_version_seq'),
  ADD COLUMN IF NOT EXISTS field_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

DROP TRIGGER IF EXISTS trg_profile_values_sync_meta ON public.profile_values;
CREATE TRIGGER trg_profile_values_sync_meta
BEFORE INSERT OR UPDATE ON public.profile_values
FOR EACH ROW EXECUTE FUNCTION public.tg_set_sync_meta();

-- =========================================================
-- 4) New table: rides (GPS)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  horse_id uuid,
  client_id text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_s integer,
  distance_m integer,
  avg_speed numeric,
  max_speed numeric,
  track jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  version bigint NOT NULL DEFAULT nextval('public.sync_version_seq'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rides TO authenticated;
GRANT ALL ON public.rides TO service_role;

ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own rides"
ON public.rides FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_rides_sync_meta
BEFORE INSERT OR UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.tg_set_sync_meta();

CREATE INDEX idx_rides_user_version ON public.rides(user_id, version);
CREATE INDEX idx_rides_horse ON public.rides(horse_id) WHERE horse_id IS NOT NULL;

-- =========================================================
-- 5) New table: course_progress
-- =========================================================
CREATE TABLE IF NOT EXISTS public.course_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  horse_id uuid,
  course_id text NOT NULL,
  step integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  version bigint NOT NULL DEFAULT nextval('public.sync_version_seq'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, horse_id, course_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_progress TO authenticated;
GRANT ALL ON public.course_progress TO service_role;

ALTER TABLE public.course_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own course progress"
ON public.course_progress FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_course_progress_sync_meta
BEFORE INSERT OR UPDATE ON public.course_progress
FOR EACH ROW EXECUTE FUNCTION public.tg_set_sync_meta();

CREATE INDEX idx_course_progress_user_version ON public.course_progress(user_id, version);

-- =========================================================
-- 6) New table: horse_members  (prepared for v2 sharing)
-- =========================================================
DO $$ BEGIN
  CREATE TYPE public.horse_member_role AS ENUM (
    'owner', 'co_rider', 'trainer', 'vet', 'family'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.horse_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horse_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role public.horse_member_role NOT NULL DEFAULT 'co_rider',
  invited_by uuid,
  accepted_at timestamptz,
  deleted_at timestamptz,
  version bigint NOT NULL DEFAULT nextval('public.sync_version_seq'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (horse_id, user_id, role)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.horse_members TO authenticated;
GRANT ALL ON public.horse_members TO service_role;

ALTER TABLE public.horse_members ENABLE ROW LEVEL SECURITY;

-- Users can see memberships they are part of, and owners of a horse can manage it
CREATE POLICY "Users see own memberships"
ON public.horse_members FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM public.horses h WHERE h.id = horse_id AND h.user_id = auth.uid())
);

CREATE POLICY "Horse owners manage memberships"
ON public.horse_members FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.horses h WHERE h.id = horse_id AND h.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.horses h WHERE h.id = horse_id AND h.user_id = auth.uid()));

CREATE TRIGGER trg_horse_members_sync_meta
BEFORE INSERT OR UPDATE ON public.horse_members
FOR EACH ROW EXECUTE FUNCTION public.tg_set_sync_meta();

CREATE INDEX idx_horse_members_user ON public.horse_members(user_id);
CREATE INDEX idx_horse_members_horse ON public.horse_members(horse_id);

-- =========================================================
-- 7) New table: sync_conflicts (audit log of merges)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  field text NOT NULL,
  server_value jsonb,
  client_value jsonb,
  chosen text NOT NULL, -- 'server' | 'client'
  server_ts timestamptz,
  client_ts timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.sync_conflicts TO authenticated;
GRANT ALL ON public.sync_conflicts TO service_role;

ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own conflicts"
ON public.sync_conflicts FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own conflicts"
ON public.sync_conflicts FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_sync_conflicts_user ON public.sync_conflicts(user_id, created_at DESC);

-- =========================================================
-- 8) Field-level merge RPC
--    Client sends: table, row (jsonb), base_version
--    Server: if current version > base_version -> field-wise LWW merge
--            using row.field_meta (client timestamps per field)
--            vs. server field_meta; conflicts are logged.
-- =========================================================
CREATE OR REPLACE FUNCTION public.sync_upsert_row(
  p_table text,
  p_row jsonb,
  p_base_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := (p_row->>'id')::uuid;
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

  -- Fetch current server row (if any)
  EXECUTE format(
    'SELECT to_jsonb(t.*), t.version, coalesce(t.field_meta, ''{}''::jsonb) FROM public.%I t WHERE t.id = $1 AND t.user_id = $2',
    p_table
  ) INTO v_current_row, v_current_version, v_server_meta
  USING v_id, v_uid;

  -- No conflict: simple upsert
  IF v_current_row IS NULL OR v_current_version <= p_base_version THEN
    EXECUTE format(
      'INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1)
       ON CONFLICT (id) DO UPDATE SET
         updated_at = now()
       RETURNING to_jsonb(public.%I.*)',
      p_table, p_table, p_table
    ) INTO v_merged USING p_row;
    -- Full row replace on conflict-free path
    EXECUTE format(
      'UPDATE public.%I SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)) WHERE id = $2 AND user_id = $3 RETURNING to_jsonb(public.%I.*)',
      p_table,
      (SELECT string_agg(quote_ident(column_name), ',')
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name=p_table
          AND column_name NOT IN ('id','user_id','created_at','updated_at','version')),
      (SELECT string_agg(quote_ident(column_name), ',')
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name=p_table
          AND column_name NOT IN ('id','user_id','created_at','updated_at','version')),
      p_table, p_table
    ) INTO v_merged USING p_row, v_id, v_uid;
    RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', v_merged);
  END IF;

  -- Conflict path: field-wise merge
  v_merged := v_current_row;
  FOR v_key IN SELECT jsonb_object_keys(p_row) LOOP
    IF v_key IN ('id','user_id','created_at','updated_at','version','field_meta') THEN
      CONTINUE;
    END IF;
    v_client_ts := NULLIF(v_client_meta->>v_key, '')::timestamptz;
    v_server_ts := NULLIF(v_server_meta->>v_key, '')::timestamptz;

    IF v_client_ts IS NOT NULL AND (v_server_ts IS NULL OR v_client_ts > v_server_ts) THEN
      -- Client wins for this field
      IF v_server_ts IS NOT NULL AND (v_current_row->v_key) IS DISTINCT FROM (p_row->v_key) THEN
        INSERT INTO public.sync_conflicts(user_id, table_name, row_id, field, server_value, client_value, chosen, server_ts, client_ts)
        VALUES (v_uid, p_table, v_id, v_key, v_current_row->v_key, p_row->v_key, 'client', v_server_ts, v_client_ts);
        v_conflicts := v_conflicts + 1;
      END IF;
      v_merged := jsonb_set(v_merged, ARRAY[v_key], p_row->v_key, true);
      v_server_meta := jsonb_set(v_server_meta, ARRAY[v_key], to_jsonb(v_client_ts::text), true);
    ELSIF v_client_ts IS NOT NULL AND v_server_ts IS NOT NULL AND v_client_ts < v_server_ts THEN
      -- Server wins for this field
      IF (v_current_row->v_key) IS DISTINCT FROM (p_row->v_key) THEN
        INSERT INTO public.sync_conflicts(user_id, table_name, row_id, field, server_value, client_value, chosen, server_ts, client_ts)
        VALUES (v_uid, p_table, v_id, v_key, v_current_row->v_key, p_row->v_key, 'server', v_server_ts, v_client_ts);
        v_conflicts := v_conflicts + 1;
      END IF;
      -- keep server value
    END IF;
  END LOOP;

  v_merged := jsonb_set(v_merged, '{field_meta}', v_server_meta, true);

  -- Apply merged row back
  EXECUTE format(
    'UPDATE public.%I SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)) WHERE id = $2 AND user_id = $3 RETURNING to_jsonb(public.%I.*)',
    p_table,
    (SELECT string_agg(quote_ident(column_name), ',')
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=p_table
        AND column_name NOT IN ('id','user_id','created_at','updated_at','version')),
    (SELECT string_agg(quote_ident(column_name), ',')
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=p_table
        AND column_name NOT IN ('id','user_id','created_at','updated_at','version')),
    p_table, p_table
  ) INTO v_merged USING v_merged, v_id, v_uid;

  RETURN jsonb_build_object('ok', true, 'conflict', true, 'conflicts', v_conflicts, 'row', v_merged);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_upsert_row(text, jsonb, bigint) TO authenticated;

-- =========================================================
-- 9) Realtime publication
-- =========================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.horses;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.body_scan_history;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.horse_journal;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.course_progress;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.horse_members;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.horses REPLICA IDENTITY FULL;
ALTER TABLE public.calendar_events REPLICA IDENTITY FULL;
ALTER TABLE public.rides REPLICA IDENTITY FULL;
ALTER TABLE public.body_scan_history REPLICA IDENTITY FULL;
ALTER TABLE public.horse_journal REPLICA IDENTITY FULL;
ALTER TABLE public.course_progress REPLICA IDENTITY FULL;
ALTER TABLE public.horse_members REPLICA IDENTITY FULL;
