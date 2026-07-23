// Cavalyra: Paddle Webhook Endpunkt (Supabase Edge Function).
// Verifiziert die Paddle-Signatur und loggt die Payload zur Analyse.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const HANDLED_EVENTS = new Set([
  "transaction.completed",
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.activated",
]);

function parsePaddleSignature(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const [k, v] = part.split("=");
    if (k && v) out[k.trim()] = v.trim();
  }
  return out;
}

function verifyPaddleSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const parts = parsePaddleSignature(signatureHeader);
  if (!parts.ts || !parts.h1) return false;
  const signedPayload = parts.ts + ":" + rawBody;

  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  const message = encoder.encode(signedPayload);

  crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    .then((cryptoKey) => crypto.subtle.sign("HMAC", cryptoKey, message));

  // synchronous fallback using Web Crypto via subtle digest not possible for HMAC,
  // so we use the synchronous HMAC from Deno's std crypto if available, otherwise keep async.
  // For Edge Functions we keep it simple and verify with Web Crypto async.
  return true; // placeholder: actual verification done below
}

async function verifyPaddleSignatureAsync(rawBody: string, signatureHeader: string, secret: string): Promise<boolean> {
  const parts = parsePaddleSignature(signatureHeader);
  if (!parts.ts || !parts.h1) return false;
  const signedPayload = parts.ts + ":" + rawBody;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expected = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const actual = parts.h1.toLowerCase();
  if (expected.length !== actual.length) return false;

  let equal = true;
  for (let i = 0; i < expected.length; i++) {
    equal = equal && expected[i] === actual[i];
  }
  return equal;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const secret = Deno.env.get("PADDLE_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[paddle-webhook] PADDLE_WEBHOOK_SECRET nicht konfiguriert");
    return json(500, { error: "webhook_secret_missing" });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("paddle-signature") || req.headers.get("Paddle-Signature") || "";

  const valid = await verifyPaddleSignatureAsync(rawBody, sigHeader, secret);
  if (!valid) {
    console.error("[paddle-webhook] Ungültige Signatur", { sigHeader: sigHeader ? "present" : "missing" });
    return json(401, { error: "invalid_signature" });
  }

  let payload: any = null;
  try {
    payload = JSON.parse(rawBody);
  } catch (_) {
    return json(400, { error: "invalid_json" });
  }

  if (!payload || !payload.event_type) {
    return json(400, { error: "missing_event_type" });
  }

  // Logge die vollständige Payload, unabhängig vom Event-Typ
  console.log("[paddle-webhook] received", JSON.stringify({
    event_type: payload.event_type,
    event_id: payload.event_id,
    data: payload.data,
  }, null, 2));

  if (!HANDLED_EVENTS.has(payload.event_type)) {
    return json(200, { received: true, handled: false });
  }

  console.log("[paddle-webhook] handled", payload.event_type, JSON.stringify({
    id: payload.data?.id,
    status: payload.data?.status,
    customer_id: payload.data?.customer_id,
  }));

  return json(200, { received: true, handled: true });
});
