// Cavalyra – DSGVO account deletion
// Deletes: all entity rows, all storage objects under {user_id}/..., the auth user itself.
// Requires service_role (only available inside edge functions).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ENTITY_TABLES = [
  "horses",
  "calendar_events",
  "rides",
  "body_scan_history",
  "horse_journal",
  "course_progress",
  "profile_values",
  "horse_members",
  "sync_conflicts",
  "cloud_backup",
];

const STORAGE_BUCKETS = ["horse-media", "body-scan-media"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Verify the caller's JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return json({ error: "unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    // 2) Admin client (service role) — used only server-side
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 3) Delete storage objects under {user_id}/...
    for (const bucket of STORAGE_BUCKETS) {
      await deleteFolderRecursive(admin, bucket, userId);
    }

    // 4) Delete entity rows
    for (const table of ENTITY_TABLES) {
      await admin.from(table).delete().eq("user_id", userId);
    }

    // 5) Delete the auth user
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      // Rows and storage are already gone; report but don't fail the whole response.
      return json({ ok: true, warning: "auth_user_delete_failed", detail: delErr.message });
    }

    return json({ ok: true });
  } catch (e) {
    console.error("delete-account error", e);
    return json({ error: "internal_error", detail: String(e?.message || e) }, 500);
  }
});

async function deleteFolderRecursive(admin: any, bucket: string, prefix: string) {
  // Storage list returns files + folders; we recurse folders and batch-delete files.
  const stack: string[] = [prefix];
  while (stack.length) {
    const current = stack.pop()!;
    const { data, error } = await admin.storage.from(bucket).list(current, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      console.warn("storage list error", bucket, current, error.message);
      continue;
    }
    const files: string[] = [];
    for (const item of data || []) {
      // Folders have null metadata; files have metadata object.
      if ((item as any).id === null || (item as any).metadata == null) {
        stack.push(`${current}/${item.name}`);
      } else {
        files.push(`${current}/${item.name}`);
      }
    }
    if (files.length) {
      const { error: rmErr } = await admin.storage.from(bucket).remove(files);
      if (rmErr) console.warn("storage remove error", bucket, rmErr.message);
    }
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
