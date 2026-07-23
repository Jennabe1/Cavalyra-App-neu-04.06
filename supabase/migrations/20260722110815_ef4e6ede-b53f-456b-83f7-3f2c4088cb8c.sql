ALTER TABLE public.licenses
  ADD COLUMN IF NOT EXISTS installation_id text,
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS subscription_id text,
  ADD COLUMN IF NOT EXISTS email text;

CREATE INDEX IF NOT EXISTS licenses_installation_id_idx ON public.licenses (installation_id);
CREATE INDEX IF NOT EXISTS licenses_customer_id_idx ON public.licenses (customer_id);
CREATE INDEX IF NOT EXISTS licenses_subscription_id_idx ON public.licenses (subscription_id);
CREATE INDEX IF NOT EXISTS licenses_email_idx ON public.licenses (email);