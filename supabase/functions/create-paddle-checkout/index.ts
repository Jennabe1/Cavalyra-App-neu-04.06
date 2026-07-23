// Cavalyra – Paddle Mobile Checkout (Android)
// Erstellt serverseitig eine Paddle Transaction und gibt die checkout.url zurück.
// Läuft ohne Cavalyra-Cloud-Konto: der Client identifiziert sich über eine
// lokal erzeugte `installation_id` (UUID) + optionale E-Mail für den
// Paddle-Beleg. Ein Supabase-JWT ist optional – wenn vorhanden, wird die
// user_id zusätzlich mitgegeben.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PADDLE_PRICE_ID = "pri_01ksnccs23fwwm0qctdydb93xz";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const apiKey = Deno.env.get("PADDLE_API_KEY");
  if (!apiKey) return json(500, { error: "paddle_api_key_missing" });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { body = {}; }

  const installationId = typeof body.installation_id === "string"
    ? body.installation_id.trim()
    : "";
  const requestEmailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  // Optionaler JWT (Cloud-Konto): NICHT erforderlich.
  let userId: string | null = null;
  let claimEmail = "";
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData } = await supabase.auth.getClaims(token);
      if (claimsData?.claims?.sub) {
        userId = claimsData.claims.sub as string;
        claimEmail = (claimsData.claims.email as string | undefined) || "";
      }
    } catch (_) { /* anonym weiter */ }
  }

  // Ohne Cloud-Konto brauchen wir wenigstens installation_id, damit der
  // Webhook das anonyme Recht später zuordnen kann.
  if (!userId && !installationId) {
    return json(400, { error: "installation_id_required" });
  }

  const customerEmail = requestEmailRaw || claimEmail;

  const customData: Record<string, unknown> = {
    source: "android_app",
  };
  if (userId) customData.user_id = userId;
  if (installationId) customData.installation_id = installationId;
  if (customerEmail) customData.email = customerEmail;

  const payload: Record<string, unknown> = {
    items: [{ price_id: PADDLE_PRICE_ID, quantity: 1 }],
    custom_data: customData,
    checkout: {
      url: "https://cavalyra.de/return",
    },
  };
  if (customerEmail) {
    (payload as any).customer = { email: customerEmail };
  }

  const res = await fetch(`${PADDLE_API_BASE}/transactions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.data) {
    console.error("[create-paddle-checkout] Paddle-API-Fehler", res.status, data);
    return json(502, {
      error: "paddle_api_error",
      status: res.status,
      details: data,
    });
  }

  const checkoutUrl = data.data?.checkout?.url;
  if (!checkoutUrl) {
    return json(502, { error: "no_checkout_url", details: data });
  }

  return json(200, {
    checkoutUrl,
    transactionId: data.data.id,
  });
});
