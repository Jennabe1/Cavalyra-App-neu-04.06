
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.licenses DROP CONSTRAINT IF EXISTS licenses_pkey;
ALTER TABLE public.licenses ADD PRIMARY KEY (id);
ALTER TABLE public.licenses ALTER COLUMN user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS licenses_user_id_uniq ON public.licenses(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS licenses_installation_id_uniq ON public.licenses(installation_id) WHERE installation_id IS NOT NULL;
CREATE POLICY "Anon read own license by installation" ON public.licenses FOR SELECT TO anon USING (false);
