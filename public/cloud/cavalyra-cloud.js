/* DEPRECATED: v1 Snapshot-MVP wird von cavalyra-sync-engine.js (v2) abgeloest.
   Diese Datei bleibt aus Kompatibilitaetsgruenden erhalten, ist aber ein No-Op. */
/*
(function () {
  "use strict";

  var SUPABASE_URL = "https://upbubifdcndfxbvmgwzg.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYnViaWZkY25kZnhidm1nd3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTg5MjEsImV4cCI6MjA5NTUzNDkyMX0.f3OQwrVb-mRrr045ia_jcduC8NlOFJghRJFjJkM1qzc";

  // Alle Local-Storage-Schlüssel, die für Backup/Sync relevant sind.
  // Werden über den bestehenden save/load-Wrapper mit Prefix "cavalyra_" geschrieben.
  var BACKUP_KEYS = [
    "horses",
    "activeHorseId",
    "events",
    "rides",
    "bodyScans",
    "horsebook",
    "courseProgressByHorse",
    "calendarSelected"
  ];

  var supabase = null;
  var currentUser = null;
  var syncInFlight = false;
  var syncTimer = null;

  function log() {
    try { console.log.apply(console, ["[CavalyraCloud]"].concat([].slice.call(arguments))); } catch(_) {}
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Konnte Supabase-SDK nicht laden")); };
      document.head.appendChild(s);
    });
  }

  async function ensureClient() {
    if (supabase) return supabase;
    if (!window.supabase || !window.supabase.createClient) {
      await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js");
    }
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "cavalyra_supabase_auth",
        storage: window.localStorage
      }
    });
    supabase.auth.onAuthStateChange(function (_evt, session) {
      currentUser = session ? session.user : null;
      renderCard();
    });
    var sess = await supabase.auth.getSession();
    currentUser = sess && sess.data && sess.data.session ? sess.data.session.user : null;
    return supabase;
  }

  function readLocalKey(k) {
    try { return JSON.parse(localStorage.getItem("cavalyra_" + k)); } catch (_) { return null; }
  }
  function writeLocalKey(k, v) {
    try { localStorage.setItem("cavalyra_" + k, JSON.stringify(v)); } catch (_) {}
  }

  async function pushAll() {
    if (!currentUser) return { ok: false, reason: "not_signed_in" };
    if (syncInFlight) return { ok: false, reason: "busy" };
    syncInFlight = true;
    try {
      var rows = BACKUP_KEYS.map(function (k) {
        var v = readLocalKey(k);
        return { user_id: currentUser.id, key: k, data: v == null ? {} : { v: v } };
      });
      var res = await supabase.from("cloud_backup").upsert(rows, { onConflict: "user_id,key" });
      if (res.error) { log("push error", res.error); return { ok: false, error: res.error }; }
      try { localStorage.setItem("cavalyra_cloud_lastSync", String(Date.now())); } catch(_) {}
      renderCard();
      return { ok: true, count: rows.length };
    } finally {
      syncInFlight = false;
    }
  }

  async function pullAll(opts) {
    opts = opts || {};
    if (!currentUser) return { ok: false, reason: "not_signed_in" };
    var res = await supabase.from("cloud_backup").select("key,data,updated_at").eq("user_id", currentUser.id);
    if (res.error) return { ok: false, error: res.error };
    var applied = 0;
    (res.data || []).forEach(function (row) {
      if (BACKUP_KEYS.indexOf(row.key) === -1) return;
      var payload = row.data && Object.prototype.hasOwnProperty.call(row.data, "v") ? row.data.v : row.data;
      if (payload == null || (Array.isArray(payload) && !payload.length) || (typeof payload === "object" && !Array.isArray(payload) && !Object.keys(payload).length)) {
        // Cloud-Wert ist leer -> nur überschreiben wenn explizit gewünscht
        if (opts.overwriteEmpty) writeLocalKey(row.key, payload);
        return;
      }
      writeLocalKey(row.key, payload);
      applied++;
    });
    try { localStorage.setItem("cavalyra_cloud_lastSync", String(Date.now())); } catch(_) {}
    return { ok: true, applied: applied };
  }

  function scheduleAutoSync() {
    if (syncTimer) return;
    syncTimer = setInterval(function () {
      if (!currentUser) return;
      if (document.hidden) return;
      pushAll().catch(function (e) { log("autosync error", e); });
    }, 60000); // 1 Minute
  }

  // Öffentliche API
  var API = {
    async init() {
      await ensureClient();
      if (currentUser) scheduleAutoSync();
      return currentUser;
    },
    async signUp(email, password) {
      await ensureClient();
      var res = await supabase.auth.signUp({
        email: email,
        password: password,
        options: { emailRedirectTo: window.location.origin }
      });
      if (res.error) throw res.error;
      currentUser = res.data.user;
      if (currentUser) {
        // Erst-Backup einmalig hochladen
        try { await pushAll(); } catch(_) {}
        scheduleAutoSync();
      }
      renderCard();
      return res.data;
    },
    async signIn(email, password) {
      await ensureClient();
      var res = await supabase.auth.signInWithPassword({ email: email, password: password });
      if (res.error) throw res.error;
      currentUser = res.data.user;
      // Nach Login: erst pullen (Wiederherstellung), dann pushen (Merge)
      try { await pullAll(); } catch(_) {}
      try { await pushAll(); } catch(_) {}
      scheduleAutoSync();
      renderCard();
      return res.data;
    },
    async signOut() {
      await ensureClient();
      await supabase.auth.signOut();
      currentUser = null;
      renderCard();
    },
    async resetPassword(email) {
      await ensureClient();
      var res = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });
      if (res.error) throw res.error;
      return res.data;
    },
    async deleteAccount(alsoLocal) {
      await ensureClient();
      if (!currentUser) return;
      // Cloud-Daten löschen
      await supabase.from("cloud_backup").delete().eq("user_id", currentUser.id);
      // Optional lokale Daten löschen
      if (alsoLocal) {
        BACKUP_KEYS.forEach(function (k) {
          try { localStorage.removeItem("cavalyra_" + k); } catch(_) {}
        });
      }
      // Sign-Out (echtes Löschen des Auth-Users braucht Service-Role -> Session beenden)
      await supabase.auth.signOut();
      currentUser = null;
      renderCard();
      // Nachricht an Nutzer wird vom Aufrufer geregelt.
    },
    async backupNow() { return pushAll(); },
    async restoreNow() { return pullAll(); },
    getUser() { return currentUser; },
    getLastSync() {
      var t = 0;
      try { t = parseInt(localStorage.getItem("cavalyra_cloud_lastSync") || "0", 10) || 0; } catch(_) {}
      return t;
    }
  };

  window.CavalyraCloud = API;

  // ============================================================
  // UI – wird in #screen-profile injiziert, ohne renderProfile zu
  // überschreiben. Wir hängen eine Karte an das Grid an.
  // ============================================================
  var CARD_ID = "cavalyra-cloud-card";

  function fmtLastSync(t) {
    if (!t) return "noch nie";
    try {
      var d = new Date(t);
      return d.toLocaleString();
    } catch(_) { return "unbekannt"; }
  }

  function cardHTML() {
    var user = currentUser;
    var last = fmtLastSync(API.getLastSync());
    if (!user) {
      return (
        '<div class="card" id="' + CARD_ID + '">' +
          '<h2>☁️ Cloud-Backup</h2>' +
          '<p><strong>Nur lokal gespeichert.</strong> Deine Daten befinden sich aktuell ausschließlich auf diesem Gerät.</p>' +
          '<p>Mit einem kostenlosen Cavalyra-Konto kannst du deine Daten sichern und auf mehreren Geräten synchronisieren. Die App bleibt vollständig offline-fähig.</p>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
            '<button class="btn" type="button" data-cav-cloud="open-signup">Cloud-Backup aktivieren</button>' +
            '<button class="btn secondary" type="button" data-cav-cloud="open-signin">Ich habe bereits ein Konto</button>' +
          '</div>' +
        '</div>'
      );
    }
    return (
      '<div class="card" id="' + CARD_ID + '">' +
        '<h2>☁️ Cloud-Backup aktiv</h2>' +
        '<p>Angemeldet als <strong>' + escapeHtml(user.email || "") + '</strong></p>' +
        '<p style="opacity:.75;font-size:14px">Letzte Synchronisation: ' + last + '</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
          '<button class="btn" type="button" data-cav-cloud="backup">Jetzt sichern</button>' +
          '<button class="btn secondary" type="button" data-cav-cloud="restore">Aus Cloud wiederherstellen</button>' +
          '<button class="btn secondary" type="button" data-cav-cloud="signout">Abmelden</button>' +
          '<button class="btn" style="background:#a12727;color:#fff" type="button" data-cav-cloud="delete">Konto löschen</button>' +
        '</div>' +
      '</div>'
    );
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }

  function renderCard() {
    var screen = document.getElementById("screen-profile");
    if (!screen) return;
    var grid = screen.querySelector(".grid");
    if (!grid) return;
    var existing = screen.querySelector("#" + CARD_ID);
    if (existing) existing.remove();
    var wrap = document.createElement("div");
    wrap.innerHTML = cardHTML();
    grid.appendChild(wrap.firstChild);
    bindCardEvents();
  }

  function bindCardEvents() {
    document.querySelectorAll('[data-cav-cloud]').forEach(function (btn) {
      if (btn.__cavBound) return;
      btn.__cavBound = true;
      btn.addEventListener("click", async function () {
        var action = btn.getAttribute("data-cav-cloud");
        try {
          if (action === "open-signup") return openAuthDialog("signup");
          if (action === "open-signin") return openAuthDialog("signin");
          if (action === "backup") {
            btn.disabled = true; btn.textContent = "Sichere…";
            var r = await API.backupNow();
            btn.disabled = false; btn.textContent = "Jetzt sichern";
            toast(r && r.ok ? "Cloud-Backup gespeichert" : "Sicherung fehlgeschlagen");
            return;
          }
          if (action === "restore") {
            if (!(await confirmAsync("Cloud-Daten laden und lokale Daten mit dem Cloud-Stand aktualisieren?"))) return;
            btn.disabled = true; btn.textContent = "Lade…";
            var r2 = await API.restoreNow();
            btn.disabled = false; btn.textContent = "Aus Cloud wiederherstellen";
            if (r2 && r2.ok) {
              toast("Wiederherstellung abgeschlossen – App wird neu geladen");
              setTimeout(function(){ location.reload(); }, 800);
            } else {
              toast("Wiederherstellung fehlgeschlagen");
            }
            return;
          }
          if (action === "signout") {
            if (!(await confirmAsync("Vom Cloud-Backup abmelden? Deine lokalen Daten bleiben erhalten."))) return;
            await API.signOut();
            toast("Abgemeldet");
            return;
          }
          if (action === "delete") {
            if (!(await confirmAsync("Cloud-Konto und alle Cloud-Daten unwiderruflich löschen? Deine lokalen Daten auf diesem Gerät bleiben erhalten."))) return;
            await API.deleteAccount(false);
            toast("Cloud-Konto gelöscht");
            return;
          }
        } catch (e) {
          console.error(e);
          toast(e && e.message ? e.message : "Fehler");
        }
      });
    });
  }

  function toast(msg) {
    if (typeof window.toast === "function") { try { window.toast(msg); return; } catch(_) {} }
    try { alert(msg); } catch(_) {}
  }
  function confirmAsync(msg) {
    if (typeof window.cavConfirm === "function") { try { return Promise.resolve(window.cavConfirm(msg)); } catch(_){} }
    return Promise.resolve(window.confirm(msg));
  }

  // ---------- Auth-Dialog ----------
  function openAuthDialog(mode) {
    closeAuthDialog();
    var back = document.createElement("div");
    back.id = "cav-auth-backdrop";
    back.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px";
    back.innerHTML =
      '<div role="dialog" aria-modal="true" style="background:var(--bg,#fff);color:var(--text,#000);max-width:420px;width:100%;border-radius:16px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.25)">' +
        '<h2 style="margin:0 0 8px">' + (mode==="signup"?"Cloud-Backup aktivieren":"Anmelden") + '</h2>' +
        '<p style="margin:0 0 12px;opacity:.8">' + (mode==="signup"?"Erstelle ein kostenloses Cavalyra-Konto für Backup & Sync.":"Melde dich mit deinem Cavalyra-Konto an.") + '</p>' +
        '<label style="display:block;font-size:13px;margin-bottom:4px">E-Mail</label>' +
        '<input id="cav-auth-email" type="email" autocomplete="email" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin-bottom:10px">' +
        '<label style="display:block;font-size:13px;margin-bottom:4px">Passwort</label>' +
        '<input id="cav-auth-pass" type="password" autocomplete="' + (mode==="signup"?"new-password":"current-password") + '" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin-bottom:12px">' +
        '<div id="cav-auth-msg" style="min-height:20px;color:#a12727;font-size:13px;margin-bottom:8px"></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn" id="cav-auth-submit" type="button">' + (mode==="signup"?"Konto erstellen":"Anmelden") + '</button>' +
          '<button class="btn secondary" id="cav-auth-cancel" type="button">Abbrechen</button>' +
        '</div>' +
        (mode==="signin"?'<p style="margin:12px 0 0"><a href="#" id="cav-auth-forgot" style="color:var(--brand,#5C3540)">Passwort vergessen?</a></p>':"") +
        (mode==="signup"?'<p style="margin:12px 0 0;font-size:13px;opacity:.75">Bereits ein Konto? <a href="#" id="cav-auth-switch" style="color:var(--brand,#5C3540)">Anmelden</a></p>':'<p style="margin:12px 0 0;font-size:13px;opacity:.75">Noch kein Konto? <a href="#" id="cav-auth-switch" style="color:var(--brand,#5C3540)">Registrieren</a></p>') +
      '</div>';
    document.body.appendChild(back);

    back.addEventListener("click", function (e) { if (e.target === back) closeAuthDialog(); });
    document.getElementById("cav-auth-cancel").onclick = closeAuthDialog;
    var sw = document.getElementById("cav-auth-switch");
    if (sw) sw.onclick = function (e) { e.preventDefault(); openAuthDialog(mode==="signup"?"signin":"signup"); };
    var fg = document.getElementById("cav-auth-forgot");
    if (fg) fg.onclick = async function (e) {
      e.preventDefault();
      var em = (document.getElementById("cav-auth-email").value||"").trim();
      if (!em) { setMsg("Bitte E-Mail eingeben"); return; }
      try { await API.resetPassword(em); setMsg("E-Mail zum Zurücksetzen versendet.","#0a7a2a"); }
      catch(err){ setMsg(err.message||"Fehler"); }
    };
    document.getElementById("cav-auth-submit").onclick = async function () {
      var em = (document.getElementById("cav-auth-email").value||"").trim();
      var pw = document.getElementById("cav-auth-pass").value||"";
      if (!em || !pw) { setMsg("Bitte E-Mail und Passwort ausfüllen"); return; }
      if (pw.length < 6) { setMsg("Passwort muss mindestens 6 Zeichen haben"); return; }
      var btn = document.getElementById("cav-auth-submit");
      btn.disabled = true; var oldTxt = btn.textContent; btn.textContent = "Bitte warten…";
      try {
        if (mode === "signup") await API.signUp(em, pw);
        else await API.signIn(em, pw);
        closeAuthDialog();
        toast(mode==="signup"?"Cloud-Backup aktiviert":"Angemeldet");
      } catch (err) {
        setMsg(err && err.message ? err.message : "Fehler");
        btn.disabled = false; btn.textContent = oldTxt;
      }
    };

    setTimeout(function(){ try{ document.getElementById("cav-auth-email").focus(); }catch(_){} }, 30);

    function setMsg(m, color){
      var el = document.getElementById("cav-auth-msg");
      if (el) { el.textContent = m; el.style.color = color || "#a12727"; }
    }
  }
  function closeAuthDialog() {
    var b = document.getElementById("cav-auth-backdrop");
    if (b) b.remove();
  }

  // Hook: nach jedem Rendern von renderProfile die Karte injizieren.
  function hookRenderProfile() {
    if (typeof window.renderProfile === "function" && !window.renderProfile.__cavCloudHooked) {
      var orig = window.renderProfile;
      var wrapped = function () {
        var r = orig.apply(this, arguments);
        try { renderCard(); } catch (e) { log("renderCard err", e); }
        return r;
      };
      wrapped.__cavCloudHooked = true;
      window.renderProfile = wrapped;
    }
  }

  function boot() {
    hookRenderProfile();
    // Falls Profil bereits sichtbar
    try { renderCard(); } catch(_) {}
    API.init().then(function(){
      renderCard();
    }).catch(function(e){ log("init error", e); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Wenn renderProfile später zugewiesen wird (Reihenfolge im HTML), kurz nochmal versuchen.
  setTimeout(hookRenderProfile, 500);
  setTimeout(hookRenderProfile, 2000);
})();
*/
