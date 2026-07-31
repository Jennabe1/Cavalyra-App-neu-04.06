// Cavalyra – validate-ios-receipt
// Endgültiger StoreKit-Validator für cordova-plugin-purchase v13 (Apple).
//
// Ablauf:
//   1. App ruft diese Function im Validator-Hook auf (transactionId + installation_id).
//   2. Wir signieren ein ES256-JWT für die Apple App Store Server API.
//   3. GET /inApps/v1/subscriptions/{transactionId}  (Get All Subscription Statuses)
//      - Produktion zuerst, bei 4040010 (TransactionIdNotFound) Sandbox.
//   4. Aus lastTransactions[] wird die Transaktion für unsere Produkt-ID gelesen:
//      status, expiresDate, autoRenewStatus, revocationDate.
//   5. Ergebnis wird in public.licenses persistiert (source = "app_store").
//   6. Antwort im v13-ValidatorResponse-Format zurückgeben.
//
// Es gibt in dieser Function KEINE Fallbacks, die ohne Apple-Antwort ein
// Entitlement erteilen. Kein Apple-Urteil => ok:false.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PRODUCT_ID = "de.cavalyra.app.pro.monthly";
const APPLE_PROD = "https://api.storekit.itunes.apple.com";
const APPLE_SANDBOX = "https://api.storekit-sandbox.itunes.apple.com";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function decodeJwsPayload(jws: string): any {
  try {
    const part = jws.split(".")[1];
    const pad = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = pad + "=".repeat((4 - (pad.length % 4)) % 4);
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    return null;
  }
}

async function importP8(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const der = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) der[i] = raw.charCodeAt(i);
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function appleToken(): Promise<string> {
  const keyId = Deno.env.get("APPLE_KEY_ID");
  const issuerId = Deno.env.get("APPLE_ISSUER_ID");
  const bundleId = Deno.env.get("APPLE_BUNDLE_ID") || "de.cavalyra.app";
  const p8 = Deno.env.get("APPLE_PRIVATE_KEY");
  if (!keyId || !issuerId || !p8) throw new Error("apple_env_missing");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 1800,
    aud: "appstoreconnect-v1",
    bid: bundleId,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await importP8(p8);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${b64url(sig)}`;
}

type AppleLookup = {
  environment: "Production" | "Sandbox";
  status: number | null;
  expiresDate: number | null;
  autoRenewStatus: number | null;
  revoked: boolean;
  originalTransactionId: string;
  transactionId: string;
};

async function fetchSubscriptionStatus(
  base: string,
  transactionId: string,
  token: string,
): Promise<{ httpStatus: number; body: any }> {
  const res = await fetch(
    `${base}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = { raw: text };
  }
  return { httpStatus: res.status, body };
}

function pickFromStatuses(body: any, env: "Production" | "Sandbox"): AppleLookup | null {
  const groups = Array.isArray(body?.data) ? body.data : [];
  let best: AppleLookup | null = null;
  // Apple-Statuscodes: 1 = active, 2 = expired, 3 = billing retry,
  // 4 = grace period, 5 = revoked.
  const rank = (s: number | null) => (s === 1 || s === 4 ? 3 : s === 3 ? 2 : 1);

  for (const g of groups) {
    const txs = Array.isArray(g?.lastTransactions) ? g.lastTransactions : [];
    for (const t of txs) {
      const info = t?.signedTransactionInfo ? decodeJwsPayload(t.signedTransactionInfo) : null;
      const renew = t?.signedRenewalInfo ? decodeJwsPayload(t.signedRenewalInfo) : null;
      const productId = info?.productId || "";
      if (productId && productId !== PRODUCT_ID) continue;

      const candidate: AppleLookup = {
        environment: (info?.environment as any) || env,
        status: typeof t?.status === "number" ? t.status : null,
        expiresDate: typeof info?.expiresDate === "number" ? info.expiresDate : null,
        autoRenewStatus: typeof renew?.autoRenewStatus === "number" ? renew.autoRenewStatus : null,
        revoked: !!info?.revocationDate || t?.status === 5,
        originalTransactionId: String(
          info?.originalTransactionId || t?.originalTransactionId || "",
        ),
        transactionId: String(info?.transactionId || ""),
      };
      if (!best || rank(candidate.status) > rank(best.status)) best = candidate;
    }
  }
  return best;
}

function verdict(look: AppleLookup) {
  const expiresMs = look.expiresDate || 0;
  const notExpired = expiresMs > Date.now();
  // Aktiv ausschließlich bei Apple-Status 1 (active) oder 4 (grace period)
  // UND einem in der Zukunft liegenden Ablaufdatum. Widerruf schlägt alles.
  const active = !look.revoked && (look.status === 1 || look.status === 4) && notExpired;
  return {
    active,
    expiresAt: expiresMs ? new Date(expiresMs).toISOString() : null,
    isExpired: !active,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, code: 6778001, message: "method_not_allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { ok: false, code: 6778001, message: "supabase_env_missing" });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch (_) {
    return json(400, { ok: false, code: 6778001, message: "invalid_json" });
  }

  const transactionId = String(body?.transactionId || body?.transaction_id || "").trim();
  const installationId = String(body?.installation_id || body?.installationId || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();

  if (!transactionId) {
    return json(400, { ok: false, code: 6778001, message: "transaction_id_required" });
  }

  // Optionaler JWT (Cloud-Konto). Lizenz funktioniert auch ohne Konto.
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await authClient.auth.getClaims(authHeader.slice(7));
      if (data?.claims?.sub) userId = data.claims.sub as string;
    } catch (_) {}
  }

  // ---------- Apple App Store Server API ----------
  let token: string;
  try {
    token = await appleToken();
  } catch (e) {
    console.error("[validate-ios-receipt] apple token error", e);
    return json(500, { ok: false, code: 6778001, message: "apple_credentials_invalid" });
  }

  let env: "Production" | "Sandbox" = "Production";
  let res = await fetchSubscriptionStatus(APPLE_PROD, transactionId, token);
  if (res.httpStatus === 404 || res.body?.errorCode === 4040010) {
    env = "Sandbox";
    res = await fetchSubscriptionStatus(APPLE_SANDBOX, transactionId, token);
  }

  if (res.httpStatus !== 200) {
    console.error("[validate-ios-receipt] apple api error", res.httpStatus, res.body);
    // Kein Apple-Urteil => kein Entitlement, aber auch keine Falschaussage.
    return json(200, {
      ok: false,
      code: res.httpStatus === 404 ? 6778003 : 6778001,
      message: "apple_lookup_failed",
      appleStatus: res.httpStatus,
      appleError: res.body?.errorCode || null,
    });
  }

  const look = pickFromStatuses(res.body, env);
  if (!look) {
    return json(200, { ok: false, code: 6778003, message: "no_matching_transaction" });
  }

  const v = verdict(look);

  // ---------- Ergebnis in public.licenses persistieren ----------
  try {
    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const row: Record<string, unknown> = {
      source: "app_store",
      status: v.active ? "pro" : "expired",
      expires_at: v.expiresAt,
      subscription_id: look.originalTransactionId || null,
      data: {
        apple_status: look.status,
        auto_renew_status: look.autoRenewStatus,
        environment: look.environment,
        product_id: PRODUCT_ID,
        transaction_id: look.transactionId,
        revoked: look.revoked,
      },
      updated_at: new Date().toISOString(),
    };
    if (userId) row.user_id = userId;
    if (installationId) row.installation_id = installationId;
    if (email) row.email = email;

    // Bestehende Zeile suchen: originalTransactionId > user_id > installation_id
    let existingId: string | null = null;
    const tryFind = async (col: string, val: string) => {
      if (existingId || !val) return;
      const { data } = await service
        .from("licenses")
        .select("id")
        .eq(col, val)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.id) existingId = data.id;
    };
    await tryFind("subscription_id", look.originalTransactionId);
    if (userId) await tryFind("user_id", userId);
    if (installationId) await tryFind("installation_id", installationId);

    if (existingId) {
      await service.from("licenses").update(row).eq("id", existingId);
    } else {
      await service.from("licenses").insert(row);
    }
  } catch (e) {
    // Persistenz ist ein Nebeneffekt; das Apple-Urteil bleibt gültig.
    console.warn("[validate-ios-receipt] license persist failed", e);
  }

  if (!v.active) {
    return json(200, {
      ok: false,
      code: 6778003, // PURCHASE_EXPIRED
      message: "subscription_expired",
      status: "expired",
      expiresAt: v.expiresAt,
      environment: look.environment,
    });
  }

  // v13-ValidatorResponse (Success)
  return json(200, {
    ok: true,
    status: "pro",
    expiresAt: v.expiresAt,
    environment: look.environment,
    data: {
      id: Deno.env.get("APPLE_BUNDLE_ID") || "de.cavalyra.app",
      latest_receipt: true,
      transaction: { type: "ios-appstore", id: look.transactionId },
      collection: [
        {
          id: PRODUCT_ID,
          transactionId: look.transactionId,
          originalTransactionId: look.originalTransactionId,
          purchaseDate: undefined,
          expiryDate: v.expiresAt,
          isExpired: false,
          renewalIntent: look.autoRenewStatus === 1 ? "Renew" : "Lapse",
        },
      ],
    },
  });
});
