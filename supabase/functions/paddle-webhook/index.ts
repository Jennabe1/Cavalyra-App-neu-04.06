// Cavalyra – Paddle Webhook (Supabase Edge Function)
// Verifiziert die Paddle-Signatur, mappt Events auf Lizenzstatus und
// schreibt in public.licenses. Idempotent, robust, ohne installation_id.
//
// Konfiguriert in supabase/config.toml mit verify_jwt = false, damit
// Paddle die Function ohne Supabase-JWT aufrufen kann.

import { createClient } from "npm:@supabase/supabase-js@2";

const HANDLED_EVENTS = new Set([
  "transaction.completed",
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.canceled",
  "subscription.past_due",
]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parsePaddleSignature(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k && v) out[k] = v;
    }
  }
  return out;
}

async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const parts = parsePaddleSignature(signatureHeader);
  if (!parts.ts || !parts.h1) return false;
  const signedPayload = `${parts.ts}:${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const actual = parts.h1.toLowerCase();
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}

type LicenseStatus = "pro" | "past_due" | "expired";

function mapSubscriptionStatus(paddleStatus: string, endsAt?: string | null): LicenseStatus {
  switch (paddleStatus) {
    case "active":
    case "trialing":
      return "pro";
    case "past_due":
      return "past_due";
    case "canceled": {
      // Noch im bezahlten Zeitraum? -> pro bis Ende.
      if (endsAt && new Date(endsAt).getTime() > Date.now()) return "pro";
      return "expired";
    }
    case "paused":
    case "expired":
    default:
      return "expired";
  }
}

interface LicenseUpsert {
  user_id: string;
  status: LicenseStatus;
  expires_at: string | null;
  customer_id: string | null;
  subscription_id: string | null;
  email: string | null;
  source: string;
  data: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const secret = Deno.env.get("PADDLE_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[paddle-webhook] PADDLE_WEBHOOK_SECRET missing");
    return json(500, { error: "webhook_secret_missing" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("[paddle-webhook] Supabase env vars missing");
    return json(500, { error: "supabase_env_missing" });
  }

  const rawBody = await req.text();
  const sigHeader =
    req.headers.get("paddle-signature") ||
    req.headers.get("Paddle-Signature") ||
    "";

  const valid = await verifyPaddleSignature(rawBody, sigHeader, secret);
  if (!valid) {
    console.error("[paddle-webhook] invalid signature");
    return json(401, { error: "invalid_signature" });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (_) {
    return json(400, { error: "invalid_json" });
  }
  if (!payload?.event_type) return json(400, { error: "missing_event_type" });

  const eventType: string = payload.event_type;
  if (!HANDLED_EVENTS.has(eventType)) {
    return json(200, { received: true, handled: false });
  }

  const data = payload.data ?? {};
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Zuordnung: subscription_id + custom_data
  const isSubscriptionEvent = eventType.startsWith("subscription.");
  const isTransactionEvent = eventType === "transaction.completed";

  const subscriptionId: string | null =
    (isSubscriptionEvent ? data.id : data.subscription_id) || null;
  const customerId: string | null = data.customer_id || null;
  const customData = (data.custom_data ?? {}) as Record<string, unknown>;

  let userId = typeof customData.user_id === "string" ? customData.user_id : null;
  let email = typeof customData.email === "string" ? customData.email : null;

  // Fallback: user_id via bestehende Lizenz per subscription_id oder customer_id auflösen.
  if (!userId && (subscriptionId || customerId)) {
    let query = supabase.from("licenses").select("user_id,email").limit(1);
    if (subscriptionId) query = query.eq("subscription_id", subscriptionId);
    else if (customerId) query = query.eq("customer_id", customerId);
    const { data: existing, error: lookupErr } = await query.maybeSingle();
    if (lookupErr) {
      console.error("[paddle-webhook] lookup error", lookupErr);
    }
    if (existing?.user_id) {
      userId = existing.user_id as string;
      if (!email && existing.email) email = existing.email as string;
    }
  }

  if (!userId) {
    console.warn("[paddle-webhook] no user_id resolvable", {
      event_type: eventType,
      subscription_id: subscriptionId,
      customer_id: customerId,
    });
    // 200, damit Paddle nicht endlos retryt – Event wurde akzeptiert, aber nicht zugeordnet.
    return json(200, { received: true, handled: false, reason: "no_user_id" });
  }

  // Status + expires_at bestimmen.
  let status: LicenseStatus = "pro";
  let expiresAt: string | null = null;

  if (isSubscriptionEvent) {
    const paddleStatus: string = data.status || "";
    const endsAt: string | null =
      data.current_billing_period?.ends_at ||
      data.next_billed_at ||
      data.scheduled_change?.effective_at ||
      null;
    status = mapSubscriptionStatus(paddleStatus, endsAt);
    expiresAt = endsAt;
    if (eventType === "subscription.canceled" && status === "expired") {
      expiresAt = data.canceled_at || endsAt;
    }
  } else if (isTransactionEvent) {
    // Einmalige Bestätigung eines abgeschlossenen Kaufs.
    status = "pro";
    expiresAt = data.billed_at || null;
    // Wenn zur Transaktion eine Subscription existiert, kann sie das Ende präziser liefern –
    // die subscription.* Events überschreiben das ohnehin.
  }

  const row: LicenseUpsert = {
    user_id: userId,
    status,
    expires_at: expiresAt,
    customer_id: customerId,
    subscription_id: subscriptionId,
    email: email,
    source: "paddle",
    data: payload,
  };

  // Idempotenz: user_id ist PK. Wir mergen manuell, damit spätere Events ohne custom_data
  // keine Felder mit NULL überschreiben.
  const { data: current, error: curErr } = await supabase
    .from("licenses")
    .select("email,customer_id,subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (curErr) console.error("[paddle-webhook] current fetch error", curErr);

  if (current) {
    if (!row.email && current.email) row.email = current.email as string;
    if (!row.customer_id && current.customer_id) row.customer_id = current.customer_id as string;
    if (!row.subscription_id && current.subscription_id) {
      row.subscription_id = current.subscription_id as string;
    }
  }

  const { error: upsertErr } = await supabase
    .from("licenses")
    .upsert(
      {
        ...row,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (upsertErr) {
    console.error("[paddle-webhook] upsert error", upsertErr);
    return json(500, { error: "db_upsert_failed" });
  }

  console.log("[paddle-webhook] applied", {
    event_type: eventType,
    user_id: userId,
    status,
    subscription_id: subscriptionId,
    expires_at: expiresAt,
  });

  return json(200, { received: true, handled: true });
});
