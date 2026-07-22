// Cavalyra – Paddle Mobile Checkout (Android)
// Erstellt serverseitig eine Paddle Transaction und gibt die checkout.url zurück.
// Der Paddle API Key wird ausschließlich hier serverseitig verwendet.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PADDLE_PRICE_ID = "pri_01ksnccs23fwwm0qctdydb93xz";
const PADDLE_ENV = (Deno.env.get("PADDLE_ENV") || "production").toLowerCase();

const PADDLE_API_BASE =
  PADDLE_ENV === "sandbox"
    ? "https://sandbox-api.paddle.com"
    : "https://api.paddle.com";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, {
      error: "method_not_allowed",
    });
  }

  const apiKey = Deno.env.get("PADDLE_API_KEY");

  if (!apiKey) {
    return json(500, {
      error: "paddle_api_key_missing",
    });
  }

  let installationId = "";
  let customerEmail = "";

  try {
    const body = await req.json().catch(() => ({}));

    installationId = String(body.installationId || "").trim();
    customerEmail = String(body.email || "")
      .trim()
      .toLowerCase();
  } catch (_) {
    return json(400, {
      error: "invalid_request",
    });
  }

  if (!installationId) {
    return json(400, {
      error: "installation_id_missing",
    });
  }

  const payload: Record<string, unknown> = {
    items: [
      {
        price_id: PADDLE_PRICE_ID,
        quantity: 1,
      },
    ],

    custom_data: {
      installation_id: installationId,
      email: customerEmail || null,
      source: "android_app",
    },

    checkout: {
      url: "https://cavalyra.de/return",
    },
  };

  if (customerEmail) {
    (payload as any).customer = {
      email: customerEmail,
    };
  }

  const res = await fetch(`${PADDLE_API_BASE}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.data) {
    console.error(
      "[create-paddle-checkout] Paddle API Fehler",
      res.status,
      data,
    );

    return json(502, {
      error: "paddle_api_error",
      status: res.status,
      details: data,
    });
  }

  const checkoutUrl = data.data?.checkout?.url;

  if (!checkoutUrl) {
    return json(502, {
      error: "no_checkout_url",
      details: data,
    });
  }

  return json(200, {
    checkoutUrl,
    transactionId: data.data.id,
  });
});
