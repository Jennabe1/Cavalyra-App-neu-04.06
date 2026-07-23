// Cavalyra - Paddle Webhook (Supabase Edge Function)
// Verifiziert Paddle-Signaturen und aktualisiert die Tabelle "licenses"

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const HANDLED_EVENTS = new Set([
  "transaction.completed",
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.canceled",
  "subscription.past_due",
]);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function parseSignature(header: string) {
  const result: Record<string, string> = {};

  for (const part of header.split(";")) {
    const [k, v] = part.split("=");

    if (k && v) {
      result[k.trim()] = v.trim();
    }
  }

  return result;
}

async function verifySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
) {
  const sig = parseSignature(signatureHeader);

  if (!sig.ts || !sig.h1) {
    return false;
  }

  const signedPayload = `${sig.ts}:${rawBody}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );

  const expected = Array
    .from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expected.toLowerCase() === sig.h1.toLowerCase();
}

Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return json(405, {
      error: "method_not_allowed",
    });
  }

  const secret = Deno.env.get("PADDLE_WEBHOOK_SECRET");

  if (!secret) {
    return json(500, {
      error: "webhook_secret_missing",
    });
  }

  const rawBody = await req.text();

  const signature =
    req.headers.get("paddle-signature") ||
    req.headers.get("Paddle-Signature") ||
    "";

  const valid = await verifySignature(
    rawBody,
    signature,
    secret,
  );

  if (!valid) {
    return json(401, {
      error: "invalid_signature",
    });
  }

  let payload: any;

  try {
    payload = JSON.parse(rawBody);
  } catch (_) {
    return json(400, {
      error: "invalid_json",
    });
  }

  if (!HANDLED_EVENTS.has(payload.event_type)) {
    return json(200, {
      ok: true,
      ignored: true,
    });
  }

  const data = payload.data ?? {};

  const customData =
    typeof data.custom_data === "object" &&
    data.custom_data !== null
      ? data.custom_data
      : {};

  const userId = String(
    customData.user_id || ""
  ).trim();

  if (!userId) {
    console.error("user_id fehlt im custom_data");

    return json(200, {
      ok: true,
      ignored: true,
    });
  }

  let status = "free";

  switch (payload.event_type) {

    case "transaction.completed":
    case "subscription.created":
    case "subscription.updated":
    case "subscription.activated":
      status = "pro";
      break;

    case "subscription.past_due":
      status = "past_due";
      break;

    case "subscription.canceled":
      status = "expired";
      break;
  }

  const expiresAt =
    data.current_billing_period?.ends_at ??
    null;

  const record = {

    user_id: userId,

    status,

    expires_at: expiresAt,

    customer_id:
      data.customer_id ?? null,

    subscription_id:
      String(data.id ?? ""),

    email:
      customData.email ?? null,

    source:
      customData.source ?? "android",

    data,

    updated_at:
      new Date().toISOString(),
  };

  const { error } = await supabase
    .from("licenses")
    .upsert(record, {
      onConflict: "user_id",
    });

  if (error) {

    console.error(error);

    return json(500, {
      error: error.message,
    });

  }

  console.log(
    "Lizenz aktualisiert:",
    userId,
    status,
  );

  return json(200, {
    ok: true,
    status,
  });

});
