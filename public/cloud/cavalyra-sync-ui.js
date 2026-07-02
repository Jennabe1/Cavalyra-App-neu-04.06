/* Cavalyra Sync UI - Profil-Statusanzeige und Auth-Dialog (additiv).
   - Zeigt Status im Profil-Screen.
   - Registrierung/Login mit sauberer, deutscher Fehlerbehandlung.
   - Dialog bleibt bei Fehlern offen, E-Mail bleibt erhalten.
*/
(function(){
  "use strict";

  function fmt(ts){ if(!ts) return "noch nie"; try{ return new Date(ts).toLocaleString("de-DE"); }catch(_){ return String(ts); } }

  // --- Fehlerübersetzung (Supabase -> Deutsch) --------------------------------
  function translateError(err, ctx){
    // Netzwerkfehler
    if(!err || (err instanceof TypeError) || /NetworkError|Failed to fetch|Load failed/i.test(err.message||"")){
      return { type:"network", title:"Keine Verbindung", msg:"Es konnte keine Verbindung hergestellt werden.\n\nBitte überprüfe deine Internetverbindung." };
    }
    const status = err.status || 0;
    const code = (err.code || "").toString().toLowerCase();
    const raw = (err.message_raw || err.message || "").toLowerCase();

    // Passwort zu schwach
    if(status === 422 && (code.includes("weak_password") || raw.includes("weak password") || raw.includes("password should be") || raw.includes("password is too weak"))){
      return { type:"weak_password", title:"Passwort zu schwach",
        msg:"Das gewählte Passwort ist zu schwach.\n\nBitte verwende mindestens:\n• 8 Zeichen\n• Groß- und Kleinbuchstaben\n• mindestens eine Zahl\n• idealerweise ein Sonderzeichen" };
    }
    // Ungültige E-Mail-Adresse
    if(raw.includes("invalid email") || code.includes("invalid_email") || raw.includes("unable to validate email")){
      return { type:"invalid_email", title:"Ungültige E-Mail-Adresse", msg:"Bitte gib eine gültige E-Mail-Adresse ein." };
    }
    // Nutzer bereits vorhanden
    if(code.includes("user_already_exists") || raw.includes("already registered") || raw.includes("user already registered") || raw.includes("email address is already")){
      return { type:"exists", title:"E-Mail bereits registriert", msg:"Diese E-Mail-Adresse ist bereits registriert.\n\nBitte melde dich an oder verwende eine andere E-Mail-Adresse." };
    }
    // E-Mail nicht bestätigt
    if(code.includes("email_not_confirmed") || raw.includes("email not confirmed")){
      return { type:"not_confirmed", title:"E-Mail nicht bestätigt", msg:"Bitte bestätige zunächst deine E-Mail-Adresse.\n\nFalls du keine E-Mail erhalten hast, kannst du sie erneut anfordern." };
    }
    // Falsche Zugangsdaten
    if(code.includes("invalid_credentials") || raw.includes("invalid login") || raw.includes("invalid credentials") || (status===400 && ctx==="signin")){
      return { type:"invalid_credentials", title:"Anmeldung fehlgeschlagen", msg:"E-Mail oder Passwort ist nicht korrekt.\n\nBitte überprüfe deine Eingaben." };
    }
    // Rate limit
    if(status === 429 || raw.includes("rate limit") || code.includes("over_email_send_rate_limit")){
      return { type:"rate_limit", title:"Zu viele Versuche", msg:"Zu viele Versuche in kurzer Zeit.\n\nBitte warte einen Moment und versuche es erneut." };
    }
    // Passwort-Format (min length client-seitig)
    if(raw.includes("password should be at least") || raw.includes("password length")){
      return { type:"weak_password", title:"Passwort zu kurz", msg:"Das Passwort muss mindestens 6 Zeichen lang sein.\n\nEmpfohlen: 8+ Zeichen mit Groß-/Kleinbuchstaben und Zahlen." };
    }
    // Fallback (nie technische Rohmeldung zeigen)
    return { type:"unknown", title:"Es ist ein Fehler aufgetreten", msg:"Bitte versuche es später erneut." };
  }

  // --- Toast / Info-Dialog ----------------------------------------------------
  function showInfo(title, message, buttons){
    return new Promise(resolve => {
      const bg = document.createElement("div");
      bg.style.cssText = "position:fixed;inset:0;background:rgba(28,14,20,.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit";
      bg.innerHTML = `
        <div style="background:#fff;color:#2d1b13;max-width:420px;width:100%;border-radius:18px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.35)">
          <div style="font-family:var(--serif,Georgia,serif);font-size:22px;font-weight:700;margin-bottom:10px">${title}</div>
          <div style="white-space:pre-line;line-height:1.5;font-size:15px;color:#4b3238;margin-bottom:18px">${message}</div>
          <div class="btnrow" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end"></div>
        </div>`;
      const row = bg.querySelector(".btnrow");
      (buttons||[{label:"OK", value:"ok", primary:true}]).forEach(b => {
        const btn = document.createElement("button");
        btn.textContent = b.label;
        btn.style.cssText = "padding:10px 16px;border-radius:12px;border:1px solid rgba(98,62,50,.2);background:"+(b.primary?"#5C3540":"#f5efec")+";color:"+(b.primary?"#fff":"#2d1b13")+";font-weight:600;cursor:pointer;font-size:14px";
        btn.onclick = () => { document.body.removeChild(bg); resolve(b.value); };
        row.appendChild(btn);
      });
      document.body.appendChild(bg);
    });
  }

  // --- Auth-Dialog (bleibt bei Fehler offen) ---------------------------------
  function openAuthDialog(mode){
    // "signup" | "signin"
    return new Promise(resolve => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;inset:0;background:rgba(28,14,20,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit";
      const isSignup = () => wrap._mode === "signup";
      wrap._mode = mode;

      wrap.innerHTML = `
        <div style="background:#fff;color:#2d1b13;max-width:420px;width:100%;border-radius:18px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35)">
          <div id="cavAuthTitle" style="font-family:var(--serif,Georgia,serif);font-size:24px;font-weight:700;margin-bottom:6px"></div>
          <div id="cavAuthSub" style="font-size:14px;color:#7b5960;margin-bottom:16px"></div>
          <label style="display:block;font-size:13px;color:#4b3238;margin-bottom:4px">E-Mail-Adresse</label>
          <input id="cavAuthEmail" type="email" autocomplete="email" style="width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid rgba(98,62,50,.25);border-radius:11px;font-size:15px;margin-bottom:12px" />
          <label style="display:block;font-size:13px;color:#4b3238;margin-bottom:4px">Passwort</label>
          <input id="cavAuthPassword" type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid rgba(98,62,50,.25);border-radius:11px;font-size:15px;margin-bottom:6px" />
          <div id="cavAuthHint" style="font-size:12px;color:#7b5960;line-height:1.4;margin-bottom:14px"></div>
          <div id="cavAuthError" style="display:none;background:#fdecec;color:#a02b2b;border:1px solid #f2c9c9;border-radius:10px;padding:10px 12px;font-size:13.5px;white-space:pre-line;line-height:1.45;margin-bottom:12px"></div>
          <div id="cavAuthExtra" style="display:none;margin-bottom:12px"></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">
            <button id="cavAuthSwitch" type="button" style="background:none;border:none;color:#5C3540;text-decoration:underline;font-size:13px;cursor:pointer;padding:6px 0"></button>
            <div style="display:flex;gap:8px">
              <button id="cavAuthCancel" type="button" style="padding:10px 14px;border-radius:12px;border:1px solid rgba(98,62,50,.2);background:#f5efec;color:#2d1b13;font-weight:600;cursor:pointer;font-size:14px">Abbrechen</button>
              <button id="cavAuthSubmit" type="button" style="padding:10px 16px;border-radius:12px;border:none;background:#5C3540;color:#fff;font-weight:600;cursor:pointer;font-size:14px"></button>
            </div>
          </div>
        </div>`;

      const emailInput = wrap.querySelector("#cavAuthEmail");
      const pwInput = wrap.querySelector("#cavAuthPassword");
      const titleEl = wrap.querySelector("#cavAuthTitle");
      const subEl = wrap.querySelector("#cavAuthSub");
      const hintEl = wrap.querySelector("#cavAuthHint");
      const errEl = wrap.querySelector("#cavAuthError");
      const extraEl = wrap.querySelector("#cavAuthExtra");
      const submitBtn = wrap.querySelector("#cavAuthSubmit");
      const switchBtn = wrap.querySelector("#cavAuthSwitch");
      const cancelBtn = wrap.querySelector("#cavAuthCancel");

      function renderMode(){
        if(isSignup()){
          titleEl.textContent = "Cloud-Konto anlegen";
          subEl.textContent = "Erstelle ein kostenloses Cavalyra-Konto für Cloud-Backup und Synchronisation.";
          hintEl.textContent = "Mindestens 8 Zeichen. Empfohlen: Groß-/Kleinbuchstaben, Zahl und Sonderzeichen.";
          submitBtn.textContent = "Konto erstellen";
          switchBtn.textContent = "Bereits registriert? Anmelden";
          pwInput.autocomplete = "new-password";
        } else {
          titleEl.textContent = "Anmelden";
          subEl.textContent = "Melde dich mit deinem Cavalyra-Konto an, um Cloud-Backup zu nutzen.";
          hintEl.textContent = "";
          submitBtn.textContent = "Anmelden";
          switchBtn.textContent = "Noch kein Konto? Jetzt registrieren";
          pwInput.autocomplete = "current-password";
        }
        errEl.style.display = "none";
        extraEl.style.display = "none";
        extraEl.innerHTML = "";
      }
      renderMode();

      function showError(t, extraButtons){
        errEl.textContent = (t.title ? t.title + "\n\n" : "") + t.msg;
        errEl.style.display = "block";
        // Passwort leeren, Cursor zurück ins Passwortfeld
        pwInput.value = "";
        setTimeout(()=>pwInput.focus(), 50);
        extraEl.innerHTML = "";
        if(extraButtons && extraButtons.length){
          extraEl.style.display = "flex";
          extraEl.style.gap = "8px";
          extraEl.style.flexWrap = "wrap";
          extraButtons.forEach(b => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = b.label;
            btn.style.cssText = "padding:9px 12px;border-radius:10px;border:1px solid rgba(92,53,64,.4);background:#fff;color:#5C3540;font-weight:600;cursor:pointer;font-size:13px";
            btn.onclick = b.onClick;
            extraEl.appendChild(btn);
          });
        } else {
          extraEl.style.display = "none";
        }
      }

      async function resendConfirm(){
        const email = emailInput.value.trim();
        if(!email) return;
        submitBtn.disabled = true;
        try{
          await window.CavalyraSync.resendConfirmation(email);
          await showInfo("E-Mail gesendet", "Wir haben dir die Bestätigungs-E-Mail erneut zugeschickt.\n\nBitte prüfe auch deinen Spam-Ordner.");
        }catch(e){
          const t = translateError(e, "resend");
          await showInfo(t.title, t.msg);
        }finally{
          submitBtn.disabled = false;
        }
      }

      async function submit(){
        const email = emailInput.value.trim();
        const pw = pwInput.value;
        if(!email){ showError({title:"E-Mail fehlt", msg:"Bitte gib eine E-Mail-Adresse ein."}); return; }
        if(!pw){ showError({title:"Passwort fehlt", msg:"Bitte gib ein Passwort ein."}); return; }
        if(isSignup() && pw.length < 8){
          showError({title:"Passwort zu kurz", msg:"Das Passwort muss mindestens 8 Zeichen lang sein.\n\nEmpfohlen: Groß-/Kleinbuchstaben, Zahl und Sonderzeichen."});
          return;
        }
        submitBtn.disabled = true;
        const originalLabel = submitBtn.textContent;
        submitBtn.textContent = isSignup() ? "Konto wird erstellt…" : "Anmeldung läuft…";
        try{
          if(isSignup()){
            const res = await window.CavalyraSync.signUp(email, pw);
            close("ok");
            if(res?.confirmed){
              await showInfo("Konto erfolgreich erstellt", "Dein Cavalyra-Konto ist aktiv.\n\nDie Cloud-Synchronisation ist jetzt aktiviert.");
            } else {
              await showInfo("Konto erfolgreich erstellt",
                "Wir haben dir eine Bestätigungs-E-Mail gesendet.\n\nBitte bestätige deine E-Mail über den Link in der Nachricht.\n\nDanach kannst du dich anmelden und die Cloud-Synchronisation nutzen.");
            }
          } else {
            await window.CavalyraSync.signIn(email, pw);
            close("ok");
          }
        }catch(err){
          const t = translateError(err, isSignup() ? "signup" : "signin");
          submitBtn.textContent = originalLabel;
          submitBtn.disabled = false;
          if(t.type === "not_confirmed"){
            showError(t, [
              { label:"Bestätigungs-E-Mail erneut senden", onClick: resendConfirm }
            ]);
          } else if(t.type === "exists"){
            showError(t, [
              { label:"Zur Anmeldung wechseln", onClick: () => { wrap._mode = "signin"; renderMode(); emailInput.value = email; setTimeout(()=>pwInput.focus(),50); } }
            ]);
          } else {
            showError(t);
          }
          return;
        }
      }

      function close(v){
        try{ document.body.removeChild(wrap); }catch(_){}
        resolve(v);
      }

      submitBtn.onclick = submit;
      switchBtn.onclick = () => { wrap._mode = isSignup() ? "signin" : "signup"; renderMode(); };
      cancelBtn.onclick = () => close("cancel");
      pwInput.addEventListener("keydown", e => { if(e.key === "Enter") submit(); });
      emailInput.addEventListener("keydown", e => { if(e.key === "Enter") pwInput.focus(); });

      document.body.appendChild(wrap);
      setTimeout(()=>emailInput.focus(), 60);
    });
  }

  // --- Status-Karte im Profil -------------------------------------------------
  function render(){
    if(!window.CavalyraSync) return;
    let root = document.getElementById("cav-cloud-status");
    if(!root){
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
    const statusLabel = { idle:"Bereit", syncing:"Synchronisiere…", restoring:"Wiederherstellen…", error:"Fehler" }[s.status] || s.status;
    const badge = enabled ? '<span style="color:#7fd18b">● aktiv</span>' : '<span style="color:#c9a86a">● deaktiviert</span>';
    root.innerHTML = `
      <h3 style="margin:0 0 8px">Cloud-Backup</h3>
      <div style="opacity:.8;margin-bottom:6px">Status: ${badge}</div>
      ${user ? `<div style="opacity:.7;font-size:.9em">Angemeldet als <b>${user.email||""}</b></div>` : ""}
      <div style="opacity:.7;font-size:.9em">Letzte Synchronisation: <b>${fmt(s.lastSync)}</b></div>
      <div style="opacity:.7;font-size:.9em">Zustand: <b>${statusLabel}</b></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
        ${enabled ? `
          <button id="cav-sync-now" class="btn">Jetzt synchronisieren</button>
          <button id="cav-sync-restore" class="btn">Aus Cloud wiederherstellen</button>
          <button id="cav-sync-logout" class="btn">Abmelden</button>
        ` : `
          <button id="cav-sync-signup" class="btn">Cloud-Konto anlegen</button>
          <button id="cav-sync-signin" class="btn">Anmelden</button>
          <button id="cav-sync-reset" class="btn" style="opacity:.85">Passwort vergessen</button>
        `}
      </div>
    `;

    document.getElementById("cav-sync-now")?.addEventListener("click", async () => {
      try{ await window.CavalyraSync.syncNow(); }
      catch(e){ const t = translateError(e); await showInfo(t.title, t.msg); }
    });
    document.getElementById("cav-sync-restore")?.addEventListener("click", async () => {
      const v = await showInfo("Aus Cloud wiederherstellen", "Möchtest du die lokalen Daten mit den Cloud-Daten überschreiben?\n\nDieser Vorgang kann nicht rückgängig gemacht werden.", [
        {label:"Abbrechen", value:"cancel"},
        {label:"Wiederherstellen", value:"ok", primary:true}
      ]);
      if(v !== "ok") return;
      try{
        await window.CavalyraSync.restore();
        await showInfo("Wiederherstellung abgeschlossen", "Die App wird jetzt neu geladen.");
        location.reload();
      }catch(e){ const t = translateError(e); await showInfo(t.title, t.msg); }
    });
    document.getElementById("cav-sync-logout")?.addEventListener("click", async () => {
      const v = await showInfo("Abmelden", "Vom Cloud-Konto abmelden?\n\nDeine lokalen Daten bleiben erhalten.", [
        {label:"Abbrechen", value:"cancel"},
        {label:"Abmelden", value:"ok", primary:true}
      ]);
      if(v !== "ok") return;
      await window.CavalyraSync.signOut();
      render();
    });
    document.getElementById("cav-sync-signup")?.addEventListener("click", async () => {
      const r = await openAuthDialog("signup"); if(r === "ok") render();
    });
    document.getElementById("cav-sync-signin")?.addEventListener("click", async () => {
      const r = await openAuthDialog("signin"); if(r === "ok") render();
    });
    document.getElementById("cav-sync-reset")?.addEventListener("click", async () => {
      const email = prompt("Bitte gib deine E-Mail-Adresse ein, um dein Passwort zurückzusetzen:");
      if(!email) return;
      try{
        await window.CavalyraSync.resetPassword(email.trim());
        await showInfo("E-Mail gesendet", "Wir haben dir eine E-Mail zum Zurücksetzen des Passworts gesendet.\n\nBitte prüfe auch deinen Spam-Ordner.");
      }catch(e){ const t = translateError(e, "reset"); await showInfo(t.title, t.msg); }
    });
  }

  window.addEventListener("cav-sync-status", render);
  window.addEventListener("DOMContentLoaded", () => setTimeout(render, 500));
  setInterval(() => { if(!document.getElementById("cav-cloud-status")) render(); }, 3000);
})();
