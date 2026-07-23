// Cavalyra – Check License (Supabase Edge Function)
// Liest ausschließlich aus public.licenses. Keine Paddle API. Auth via Supabase JWT.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { ok: false, error: "supabase_env_missing" });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.slice("Bearer ".length);
  const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) {
    return json(401, { ok: false, error: "unauthorized" });
  }
  const userId = claimsData.claims.sub as string;

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lic, error } = await service
    .from("licenses")
    .select("status,expires_at,customer_id,subscription_id,source,updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[check-license] db error", error);
    return json(500, { ok: false, error: "db_error" });
  }

  if (!lic) {
    return json(200, {
      ok: true,
      status: "free",
      expiresAt: null,
      customerId: null,
      subscriptionId: null,
      source: null,
      updatedAt: null,
    });
  }

  let status = lic.status || "free";
  const expiresAt = lic.expires_at || null;
  if (
    status === "pro" &&
    expiresAt &&
    new Date(expiresAt).getTime() < Date.now()
  ) {
    status = "expired";
  }

  return json(200, {
    ok: true,
    status,
    expiresAt,
    customerId: lic.customer_id || null,
    subscriptionId: lic.subscription_id || null,
    source: lic.source || null,
    updatedAt: lic.updated_at || null,
  });
});
