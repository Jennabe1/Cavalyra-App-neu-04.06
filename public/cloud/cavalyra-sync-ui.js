/* Cavalyra Sync UI - Profil-Statusanzeige (additiv, greift nicht in App-Logik ein). */
(function(){
  "use strict";
  function fmt(ts){ if(!ts) return "noch nie"; try{ return new Date(ts).toLocaleString("de-DE"); }catch(_){ return String(ts); } }

  function render(){
    if(!window.CavalyraSync) return;
    let root = document.getElementById("cav-cloud-status");
    if(!root){
      // In den Profil-Screen einhaengen (Fallback: body).
      const profile = document.getElementById("screen-profile") || document.querySelector("[data-screen='profile']") || document.body;
      root = document.createElement("div");
      root.id = "cav-cloud-status";
      root.className = "card";
      root.style.cssText = "margin:12px;padding:16px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1)";
      profile.appendChild(root);
    }
    const s = window.CavalyraSync.getStatus();
    const enabled = window.CavalyraSync.isEnabled();
    const user = window.CavalyraSync.getUser();
    const statusLabel = { idle:"Bereit", syncing:"Synchronisiere...", restoring:"Wiederherstellen...", error:"Fehler" }[s.status] || s.status;
    const badge = enabled ? '<span style="color:#7fd18b">● aktiv</span>' : '<span style="color:#c9a86a">● deaktiviert</span>';
    root.innerHTML = `
      <h3 style="margin:0 0 8px">Cloud-Backup</h3>
      <div style="opacity:.8;margin-bottom:6px">Status: ${badge}</div>
      ${user ? `<div style="opacity:.7;font-size:.9em">Angemeldet als <b>${user.email||""}</b></div>` : ""}
      <div style="opacity:.7;font-size:.9em">Letzte Synchronisation: <b>${fmt(s.lastSync)}</b></div>
      <div style="opacity:.7;font-size:.9em">Zustand: <b>${statusLabel}</b></div>
      ${s.error ? `<div style="color:#ff8080;font-size:.85em;margin-top:6px">${s.error}</div>` : ""}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
        ${enabled ? `
          <button id="cav-sync-now" class="btn">Jetzt synchronisieren</button>
          <button id="cav-sync-restore" class="btn">Aus Cloud wiederherstellen</button>
          <button id="cav-sync-logout" class="btn">Abmelden</button>
        ` : `
          <button id="cav-sync-signup" class="btn">Cloud-Konto anlegen</button>
          <button id="cav-sync-signin" class="btn">Anmelden</button>
        `}
      </div>
    `;

    document.getElementById("cav-sync-now")?.addEventListener("click", () => window.CavalyraSync.syncNow());
    document.getElementById("cav-sync-restore")?.addEventListener("click", async () => {
      if(!confirm("Lokale Daten mit der Cloud überschreiben?")) return;
      try{ await window.CavalyraSync.restore(); alert("Wiederherstellung abgeschlossen. Die App wird neu geladen."); location.reload(); }
      catch(e){ alert("Fehler: "+e.message); }
    });
    document.getElementById("cav-sync-logout")?.addEventListener("click", async () => {
      if(!confirm("Vom Cloud-Konto abmelden? Lokale Daten bleiben erhalten.")) return;
      await window.CavalyraSync.signOut(); render();
    });
    document.getElementById("cav-sync-signup")?.addEventListener("click", () => promptAuth("signup"));
    document.getElementById("cav-sync-signin")?.addEventListener("click", () => promptAuth("signin"));
  }

  async function promptAuth(mode){
    const email = prompt("E-Mail-Adresse:"); if(!email) return;
    const pw = prompt("Passwort (min. 6 Zeichen):"); if(!pw) return;
    try{
      if(mode==="signup") await window.CavalyraSync.signUp(email, pw);
      else await window.CavalyraSync.signIn(email, pw);
      render();
    }catch(e){ alert("Fehler: "+e.message); }
  }

  window.addEventListener("cav-sync-status", render);
  window.addEventListener("DOMContentLoaded", () => setTimeout(render, 500));
  // Nachtraegliches Rendern falls Profil-Screen spaeter gebaut wird.
  setInterval(() => { if(!document.getElementById("cav-cloud-status")) render(); }, 3000);
})();
