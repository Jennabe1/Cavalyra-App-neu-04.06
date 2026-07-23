// Cavalyra – Check License (Supabase Edge Function)
// Liest ausschließlich aus public.licenses.
//
// Drei Modi:
//   1) Mit JWT (Cavalyra-Cloud-Konto): Lookup per user_id (auth.uid()).
//   2) Ohne JWT (Offline-Kauf): Lookup per installation_id (Query oder Body).
//   3) Restore per E-Mail: Lookup per email (case-insensitive). Bei Erfolg
//      wird die aktuelle installation_id auf der Zeile persistiert, damit
//      künftige stille Checks ohne E-Mail funktionieren.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ACTIVE_STATUSES = new Set(["pro", "trial", "trialing", "active"]);

function isActive(status: string | null, expiresAt: string | null): boolean {
  if (!status) return false;
  if (!ACTIVE_STATUSES.has(status.toLowerCase())) return false;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { ok: false, error: "supabase_env_missing" });
  }

  // installation_id + email können in Query oder JSON-Body kommen.
  let installationId = "";
  let email = "";
  try {
    const url = new URL(req.url);
    installationId = (url.searchParams.get("installation_id") || "").trim();
    email = (url.searchParams.get("email") || "").trim().toLowerCase();
  } catch (_) {}
  if (req.method === "POST") {
    try {
      const b = await req.json();
      if (b && typeof b.installation_id === "string" && !installationId) {
        installationId = b.installation_id.trim();
      }
      if (b && typeof b.email === "string" && !email) {
        email = b.email.trim().toLowerCase();
      }
    } catch (_) {}
  }

  // Optionaler JWT
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.slice("Bearer ".length);
    const { data: claimsData } = await authClient.auth.getClaims(token);
    if (claimsData?.claims?.sub) userId = claimsData.claims.sub as string;
  }

  if (!userId && !installationId && !email) {
    return json(400, { ok: false, error: "installation_id_email_or_auth_required" });
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const COLUMNS = "id,status,expires_at,customer_id,subscription_id,source,updated_at,installation_id,user_id,email";

  // ---------- Modus 3: Restore per E-Mail ----------
  if (email && !userId) {
    // Case-insensitive Vergleich; wir suchen die jüngste aktive Zeile.
    const { data: rows, error: qErr } = await service
      .from("licenses")
      .select(COLUMNS)
      .ilike("email", email)
      .order("expires_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(10);

    if (qErr) {
      console.error("[check-license] email lookup error", qErr);
      return json(500, { ok: false, error: "db_error" });
    }

    const active = (rows || []).find((r: any) => isActive(r.status, r.expires_at));
    if (!active) {
      return json(200, {
        ok: false,
        status: "free",
        error: "no_active_license_for_email",
        message: "Für diese E-Mail wurde keine aktive Pro-Lizenz gefunden.",
      });
    }

    // Neue installation_id an die Lizenzzeile hängen (überschreibt eine alte
    // Geräte-ID – Restore heißt: dieses Gerät ist ab jetzt maßgeblich).
    if (installationId && active.installation_id !== installationId) {
      const { error: uErr } = await service
        .from("licenses")
        .update({ installation_id: installationId })
        .eq("id", active.id);
      if (uErr) {
        console.warn("[check-license] could not persist installation_id", uErr);
      }
    }

    return json(200, {
      ok: true,
      status: (active.status || "pro").toLowerCase(),
      expiresAt: active.expires_at || null,
      customerId: active.customer_id || null,
      subscriptionId: active.subscription_id || null,
      source: active.source || "paddle",
      updatedAt: active.updated_at || null,
      restored: true,
    });
  }

  // ---------- Modus 1/2: user_id oder installation_id ----------
  let query = service.from("licenses").select(COLUMNS).limit(1);
  if (userId) {
    query = query.eq("user_id", userId);
  } else {
    query = query.eq("installation_id", installationId);
  }

  const { data: lic, error } = await query.maybeSingle();

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

  let status = (lic.status || "free").toLowerCase();
  const expiresAt = lic.expires_at || null;
  if (status === "pro" && expiresAt && new Date(expiresAt).getTime() < Date.now()) {
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
