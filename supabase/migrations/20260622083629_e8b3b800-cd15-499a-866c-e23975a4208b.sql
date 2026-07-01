
-- Shared updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- HORSES
CREATE TABLE public.horses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT,
  name TEXT,
  breed TEXT,
  birthdate DATE,
  photo_url TEXT,
  notes TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.horses TO authenticated;
GRANT ALL ON public.horses TO service_role;
ALTER TABLE public.horses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own horses" ON public.horses
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX horses_user_id_idx ON public.horses(user_id);
CREATE INDEX horses_user_client_idx ON public.horses(user_id, client_id);
CREATE TRIGGER horses_set_updated_at BEFORE UPDATE ON public.horses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- HORSE_JOURNAL (Pferdebuch)
CREATE TABLE public.horse_journal (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  horse_id UUID REFERENCES public.horses(id) ON DELETE CASCADE,
  client_id TEXT,
  entry_date DATE,
  entry_type TEXT,
  title TEXT,
  content TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.horse_journal TO authenticated;
GRANT ALL ON public.horse_journal TO service_role;
ALTER TABLE public.horse_journal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own journal" ON public.horse_journal
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX horse_journal_user_id_idx ON public.horse_journal(user_id);
CREATE INDEX horse_journal_user_client_idx ON public.horse_journal(user_id, client_id);
CREATE TRIGGER horse_journal_set_updated_at BEFORE UPDATE ON public.horse_journal
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- CALENDAR_EVENTS
CREATE TABLE public.calendar_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT,
  event_date TIMESTAMPTZ,
  title TEXT,
  notes TEXT,
  reminder_at TIMESTAMPTZ,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_events TO authenticated;
GRANT ALL ON public.calendar_events TO service_role;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own calendar" ON public.calendar_events
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX calendar_events_user_id_idx ON public.calendar_events(user_id);
CREATE INDEX calendar_events_user_client_idx ON public.calendar_events(user_id, client_id);
CREATE TRIGGER calendar_events_set_updated_at BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- BODY_SCAN_HISTORY
CREATE TABLE public.body_scan_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  horse_id UUID REFERENCES public.horses(id) ON DELETE SET NULL,
  client_id TEXT,
  scan_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  image_url TEXT,
  deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.body_scan_history TO authenticated;
GRANT ALL ON public.body_scan_history TO service_role;
ALTER TABLE public.body_scan_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own scans" ON public.body_scan_history
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX body_scan_user_id_idx ON public.body_scan_history(user_id);
CREATE TRIGGER body_scan_set_updated_at BEFORE UPDATE ON public.body_scan_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PROFILE_VALUES (single row per user, free-form)
CREATE TABLE public.profile_values (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_values TO authenticated;
GRANT ALL ON public.profile_values TO service_role;
ALTER TABLE public.profile_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own profile" ON public.profile_values
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER profile_values_set_updated_at BEFORE UPDATE ON public.profile_values
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- LICENSES (server-side license cache)
CREATE TABLE public.licenses (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,                 -- 'paddle' | 'google_play' | 'apple'
  status TEXT NOT NULL DEFAULT 'free',  -- 'pro' | 'trial' | 'free' | 'expired'
  expires_at TIMESTAMPTZ,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.licenses TO authenticated;          -- read-only for clients
GRANT ALL ON public.licenses TO service_role;              -- webhooks write
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own license" ON public.licenses
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER licenses_set_updated_at BEFORE UPDATE ON public.licenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
