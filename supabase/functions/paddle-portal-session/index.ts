// Cavalyra – Paddle Customer Portal Session (Android)
// Erzeugt bei jedem Aufruf eine NEUE, temporäre Paddle-Customer-Portal-Session
// für die bestehende Subscription des Nutzers. Es wird nichts gespeichert.
//
// Zuordnung identisch zu check-license: JWT user_id > installation_id > email.
// PADDLE_API_KEY wird ausschließlich serverseitig verwendet.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PADDLE_ENV = (Deno.env.get("PADDLE_ENV") || "production").toLowerCase();
const PADDLE_API_BASE = PADDLE_ENV === "sandbox"
  ? "https://sandbox-api.paddle.com"
  : "https://api.paddle.com";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { ok: false, error: "supabase_env_missing" });
  }

  let rawApiKey = Deno.env.get("PADDLE_API_KEY");
  if (!rawApiKey) return json(500, { ok: false, error: "paddle_api_key_missing" });
  let apiKey = rawApiKey.trim();
  if (/^["'].*["']$/.test(apiKey)) apiKey = apiKey.slice(1, -1).trim();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { body = {}; }

  const installationId = sanitize(body.installation_id);
  const email = sanitize(body.email).toLowerCase();

  // Optionaler JWT (Cloud-Konto) – nicht erforderlich.
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData } = await authClient.auth.getClaims(
        authHeader.slice("Bearer ".length),
      );
      if (claimsData?.claims?.sub) userId = claimsData.claims.sub as string;
    } catch (_) { /* anonym weiter */ }
  }

  if (!userId && !installationId && !email) {
    return json(400, { ok: false, error: "installation_id_email_or_auth_required" });
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const COLUMNS = "id,customer_id,subscription_id,source,updated_at";
  let lic: any = null;

  // Eine explizit übergebene E-Mail hat Vorrang (Nutzereingabe im Pro-Bereich).
  if (email) {
    const { data } = await service.from("licenses").select(COLUMNS)
      .ilike("email", email).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (data?.customer_id) lic = data;
  }
  if (!lic?.customer_id && userId) {
    const { data } = await service.from("licenses").select(COLUMNS)
      .eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (data?.customer_id) lic = data;
  }
  if (!lic?.customer_id && installationId) {
    const { data } = await service.from("licenses").select(COLUMNS)
      .eq("installation_id", installationId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (data?.customer_id) lic = data;
  }


  const customerId = lic?.customer_id || null;
  const subscriptionId = lic?.subscription_id || null;

  if (!customerId) {
    return json(200, { ok: false, reason: "no_paddle_subscription" });
  }

  const payload: Record<string, unknown> = {};
  if (subscriptionId) payload.subscription_ids = [subscriptionId];

  const res = await fetch(`${PADDLE_API_BASE}/customers/${customerId}/portal-sessions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Paddle-Version": "1",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text();
  let data: any = null;
  try { data = JSON.parse(rawText); } catch (_) { data = null; }

  if (!res.ok || !data?.data) {
    console.error("[paddle-portal-session] paddle api error", res.status, data ?? rawText);
    return json(502, { ok: false, error: "paddle_api_error", status: res.status });
  }

  const urls = data.data.urls || {};
  const overviewUrl = urls.general?.overview || null;
  const sub = Array.isArray(urls.subscriptions) ? urls.subscriptions[0] : null;

  if (!overviewUrl && !sub) {
    return json(502, { ok: false, error: "no_portal_url" });
  }

  // Nur temporäre URLs zurückgeben – nichts wird persistiert.
  return json(200, {
    ok: true,
    overviewUrl,
    cancelSubscriptionUrl: sub?.cancel_subscription || null,
    updatePaymentMethodUrl: sub?.update_subscription_payment_method || null,
  });
});
