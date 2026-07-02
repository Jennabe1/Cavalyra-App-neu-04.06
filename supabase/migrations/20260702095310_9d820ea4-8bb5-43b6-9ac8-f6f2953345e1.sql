
CREATE TABLE public.cloud_backup (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cloud_backup TO authenticated;
GRANT ALL ON public.cloud_backup TO service_role;

ALTER TABLE public.cloud_backup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own cloud backup"
  ON public.cloud_backup
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER cloud_backup_set_updated_at
  BEFORE UPDATE ON public.cloud_backup
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
