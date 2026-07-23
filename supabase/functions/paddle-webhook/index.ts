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

  // Zuordnung: user_id (Cloud-Konto) ODER installation_id (anonymer Offline-Kauf).
  const isSubscriptionEvent = eventType.startsWith("subscription.");
  const isTransactionEvent = eventType === "transaction.completed";

  const subscriptionId: string | null =
    (isSubscriptionEvent ? data.id : data.subscription_id) || null;
  const customerId: string | null = data.customer_id || null;
  const customData = (data.custom_data ?? {}) as Record<string, unknown>;

  let userId = typeof customData.user_id === "string" && customData.user_id ? customData.user_id : null;
  let installationId = typeof customData.installation_id === "string" && customData.installation_id
    ? customData.installation_id
    : null;
  let email = typeof customData.email === "string" ? customData.email : null;

  // Fallback: bestehende Lizenz per subscription_id / customer_id auflösen.
  if (!userId && !installationId && (subscriptionId || customerId)) {
    let query = supabase.from("licenses").select("user_id,installation_id,email").limit(1);
    if (subscriptionId) query = query.eq("subscription_id", subscriptionId);
    else if (customerId) query = query.eq("customer_id", customerId);
    const { data: existing, error: lookupErr } = await query.maybeSingle();
    if (lookupErr) console.error("[paddle-webhook] lookup error", lookupErr);
    if (existing) {
      if (existing.user_id) userId = existing.user_id as string;
      if (existing.installation_id) installationId = existing.installation_id as string;
      if (!email && existing.email) email = existing.email as string;
    }
  }

  if (!userId && !installationId) {
    console.warn("[paddle-webhook] no identifier resolvable", {
      event_type: eventType,
      subscription_id: subscriptionId,
      customer_id: customerId,
    });
    return json(200, { received: true, handled: false, reason: "no_identifier" });
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
    status = "pro";
    expiresAt = data.billed_at || null;
  }

  // Bestehende Zeile finden (user_id bevorzugt, sonst installation_id).
  let existingRow: any = null;
  if (userId) {
    const { data: r } = await supabase
      .from("licenses")
      .select("id,email,customer_id,subscription_id,installation_id")
      .eq("user_id", userId)
      .maybeSingle();
    existingRow = r;
  }
  if (!existingRow && installationId) {
    const { data: r } = await supabase
      .from("licenses")
      .select("id,email,customer_id,subscription_id,installation_id,user_id")
      .eq("installation_id", installationId)
      .maybeSingle();
    existingRow = r;
  }

  const row: any = {
    user_id: userId,
    installation_id: installationId,
    status,
    expires_at: expiresAt,
    customer_id: customerId,
    subscription_id: subscriptionId,
    email,
    source: "paddle",
    data: payload,
    updated_at: new Date().toISOString(),
  };

  if (existingRow) {
    if (!row.email && existingRow.email) row.email = existingRow.email;
    if (!row.customer_id && existingRow.customer_id) row.customer_id = existingRow.customer_id;
    if (!row.subscription_id && existingRow.subscription_id) row.subscription_id = existingRow.subscription_id;
    if (!row.user_id && existingRow.user_id) row.user_id = existingRow.user_id;
    if (!row.installation_id && existingRow.installation_id) row.installation_id = existingRow.installation_id;

    const { error: updErr } = await supabase
      .from("licenses")
      .update(row)
      .eq("id", existingRow.id);
    if (updErr) {
      console.error("[paddle-webhook] update error", updErr);
      return json(500, { error: "db_update_failed" });
    }
  } else {
    const { error: insErr } = await supabase.from("licenses").insert(row);
    if (insErr) {
      console.error("[paddle-webhook] insert error", insErr);
      return json(500, { error: "db_insert_failed" });
    }
  }

  console.log("[paddle-webhook] applied", {
    event_type: eventType,
    user_id: userId,
    installation_id: installationId,
    status,
    subscription_id: subscriptionId,
    expires_at: expiresAt,
  });

  return json(200, { received: true, handled: true });
});
