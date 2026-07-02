
-- Storage RLS: users can only access their own folder in both buckets.
-- Path convention: {user_id}/... — enforced by (storage.foldername(name))[1]

-- horse-media
CREATE POLICY "horse-media: users read own folder"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'horse-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "horse-media: users insert own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'horse-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "horse-media: users update own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'horse-media' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'horse-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "horse-media: users delete own folder"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'horse-media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- body-scan-media
CREATE POLICY "body-scan-media: users read own folder"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'body-scan-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "body-scan-media: users insert own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'body-scan-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "body-scan-media: users update own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'body-scan-media' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'body-scan-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "body-scan-media: users delete own folder"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'body-scan-media' AND auth.uid()::text = (storage.foldername(name))[1]);
