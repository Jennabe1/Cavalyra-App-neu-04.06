
REVOKE ALL ON FUNCTION public.sync_upsert_row(text, jsonb, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_upsert_row(text, jsonb, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_upsert_row(text, jsonb, bigint) TO authenticated;
