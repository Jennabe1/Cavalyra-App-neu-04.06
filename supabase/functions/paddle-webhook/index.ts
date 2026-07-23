// Cavalyra - Paddle Webhook (Supabase Edge Function)
// Empfängt Paddle Events und aktualisiert die Tabelle "licenses"

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

const HANDLED_EVENTS = new Set([
  "transaction.completed",
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
  "subscription.past_due",
]);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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

  let payload: any;

  try {
    payload = await req.json();
  } catch (_) {
    return json(400, {
      error: "invalid_json",
    });
  }

  if (!payload?.event_type) {
    return json(400, {
      error: "missing_event_type",
    });
  }

  if (!HANDLED_EVENTS.has(payload.event_type)) {
    return json(200, {
      ok: true,
      ignored: true,
    });
  }

  try {

    console.log(
      "Paddle Event:",
      payload.event_type
    );

    console.log(
      JSON.stringify(payload, null, 2)
    );

    const data = payload.data || {};

    const customData =
      data.custom_data ||
      {};

    const installationId =
      String(
        customData.installation_id || ""
      ).trim();

    const email =
      String(
        customData.email || ""
      )
      .trim()
      .toLowerCase();

    const customerId =
      String(
        data.customer_id || ""
      );

    const subscriptionId =
      String(
        data.id || ""
      );

    let status = "free";

    switch (payload.event_type) {

      case "transaction.completed":
      case "subscription.created":
      case "subscription.updated":
        status = "pro";
        break;

      case "subscription.past_due":
        status = "past_due";
        break;

      case "subscription.canceled":
        status = "expired";
        break;

    }

    let expiresAt: string | null = null;

    if (
      data.current_billing_period &&
      data.current_billing_period.ends_at
    ) {
      expiresAt =
        data.current_billing_period.ends_at;
    }

    if (!installationId) {

      console.error(
        "installation_id fehlt im Paddle Event"
      );

      return json(200, {
        ok: true,
        ignored: true,
      });

    }

    const { error } =
      await supabase
        .from("licenses")
        .upsert(
          {
            installation_id: installationId,

            source: "android",

            status: status,

            expires_at: expiresAt,

            customer_id: customerId,

            subscription_id: subscriptionId,

            email: email,

            updated_at:
              new Date().toISOString()
          },
          {
            onConflict:
              "installation_id"
          }
        );

    if (error) {

      console.error(error);

      return json(500, {
        error:
          error.message
      });

    }

    console.log(
      "Lizenz gespeichert:",
      installationId
    );

    return json(200, {
      ok: true,
      status: status,
      installationId: installationId,
    });

  } catch (err) {

    console.error("Webhook Fehler:", err);

    return json(500, {
      error: err instanceof Error
        ? err.message
        : "unknown_error",
    });

  }

});