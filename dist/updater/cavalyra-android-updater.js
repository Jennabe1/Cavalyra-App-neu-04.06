/* =========================================================================
   Cavalyra Android Auto-Updater
   -------------------------------------------------------------------------
   Prüft beim App-Start und danach periodisch eine version.json auf
   cavalyra.de. Findet er eine neuere versionCode, blendet er einen Hinweis
   ein und öffnet auf Klick die passende APK-URL im System-Browser, damit
   der Nutzer sie herunterladen und installieren kann (Sideload).

   Erwartete Struktur von https://cavalyra.de/download/version.json:
   {
     "versionCode": 12,
     "versionName": "2.1",
     "apkUrl": "https://cavalyra.de/download/cavalyra-2.1.apk",
     "changelog": "Neue Body-Scanner-Optimierungen, Bugfixes."
   }
   ========================================================================= */
(function(){
  "use strict";

  var VERSION_URL = "https://cavalyra.de/download/version.json";
  var CURRENT_VERSION_CODE = 11;    // Synchron zu android/app/build.gradle -> versionCode
  var CURRENT_VERSION_NAME = "2.0"; // Anzeige-Version
  var CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // alle 6 Stunden
  var STORAGE_DISMISS = "cavalyra:updater:dismissedVersion";

  function isAndroidApp(){
    try {
      return !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === "android"
        && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch(_){ return false; }
  }

  async function fetchVersion(){
    try {
      var res = await fetch(VERSION_URL + "?t=" + Date.now(), { headers:{ "Accept":"application/json" }, cache:"no-store" });
      if(!res.ok) return null;
      return await res.json();
    } catch(_){ return null; }
  }

  function openUrl(url){
    try {
      if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser){
        return window.Capacitor.Plugins.Browser.open({ url: url });
      }
    } catch(_){}
    try { window.open(url, "_blank", "noopener"); } catch(_){}
  }

  function ensureBannerStyles(){
    if(document.getElementById("cav-updater-styles")) return;
    var s = document.createElement("style");
    s.id = "cav-updater-styles";
    s.textContent = ''
      + '#cavalyraUpdateBanner{position:fixed;left:12px;right:12px;bottom:calc(70px + env(safe-area-inset-bottom));'
      + 'z-index:99999;background:#5c3540;color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.35);'
      + 'font-family:inherit;display:flex;flex-direction:column;gap:8px}'
      + '#cavalyraUpdateBanner h4{margin:0;font-size:15px}'
      + '#cavalyraUpdateBanner p{margin:0;font-size:13px;opacity:.9;white-space:pre-line}'
      + '#cavalyraUpdateBanner .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}'
      + '#cavalyraUpdateBanner button{border:0;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer}'
      + '#cavalyraUpdateBanner .primary{background:#f4c37a;color:#3a1f26}'
      + '#cavalyraUpdateBanner .ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4)}';
    document.head.appendChild(s);
  }

  function showBanner(info){
    ensureBannerStyles();
    var old = document.getElementById("cavalyraUpdateBanner");
    if(old) old.remove();
    var el = document.createElement("div");
    el.id = "cavalyraUpdateBanner";
    el.innerHTML = ''
      + '<h4>Neue Version verfügbar</h4>'
      + '<p><b>Version ' + escapeHtml(info.versionName || "") + '</b></p>'
      + (info.changelog ? '<p>' + escapeHtml(info.changelog) + '</p>' : '')
      + '<div class="row">'
      +   '<button class="primary" id="cavUpdateNow">Jetzt herunterladen</button>'
      +   '<button class="ghost" id="cavUpdateLater">Später</button>'
      + '</div>';
    document.body.appendChild(el);
    document.getElementById("cavUpdateNow").onclick = function(){
      if(!info.apkUrl) return;
      showInstallGuide(function(){ openUrl(info.apkUrl); });
    };
    document.getElementById("cavUpdateLater").onclick = function(){
      try { localStorage.setItem(STORAGE_DISMISS, String(info.versionCode)); } catch(_){}
      el.remove();
    };
  }

  function showInstallGuide(onContinue){
    var KEY = "cavalyra:updater:installGuideSeen";
    try { if(localStorage.getItem(KEY) === "1"){ onContinue(); return; } } catch(_){}
    var w = document.createElement("div");
    w.style.cssText = "position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;";
    w.innerHTML = ''
      + '<div style="max-width:440px;width:100%;background:#f7ecd6;color:#3a1f26;border-radius:16px;padding:22px 20px;box-shadow:0 20px 60px rgba(0,0,0,.4);">'
      +   '<h2 style="margin:0 0 10px 0;font-size:19px;">Update installieren</h2>'
      +   '<p style="margin:0 0 10px 0;font-size:14px;line-height:1.5;">Cavalyra wird außerhalb des Play Stores aktualisiert. Android fragt einmalig nach der Berechtigung, APKs aus dieser App zu installieren.</p>'
      +   '<ol style="margin:0 0 14px 18px;padding:0;font-size:14px;line-height:1.55;">'
      +     '<li>Auf <b>Jetzt herunterladen</b> tippen.</li>'
      +     '<li>Nach dem Download die Datei über die Benachrichtigung öffnen.</li>'
      +     '<li>Falls Android fragt: <b>„Aus dieser Quelle installieren"</b> zulassen und zurück gehen.</li>'
      +     '<li><b>Installieren</b> antippen und die App neu öffnen.</li>'
      +   '</ol>'
      +   '<div style="display:flex;gap:8px;">'
      +     '<button id="cavGuideOk" style="flex:1;border:0;border-radius:10px;padding:11px;background:#5c3540;color:#fff;font-weight:600;cursor:pointer;">Jetzt herunterladen</button>'
      +     '<button id="cavGuideCancel" style="border:1px solid #5c3540;background:transparent;color:#5c3540;border-radius:10px;padding:11px 14px;font-weight:600;cursor:pointer;">Abbrechen</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(w);
    document.getElementById("cavGuideOk").onclick = function(){
      try { localStorage.setItem(KEY, "1"); } catch(_){}
      w.remove();
      onContinue();
    };
    document.getElementById("cavGuideCancel").onclick = function(){ w.remove(); };
  }

  function escapeHtml(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(m){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[m];
    });
  }

  async function check(){
    if(!isAndroidApp()) return;
    var info = await fetchVersion();
    if(!info || typeof info.versionCode !== "number") return;
    if(info.versionCode <= CURRENT_VERSION_CODE) return;
    var dismissed = 0;
    try { dismissed = parseInt(localStorage.getItem(STORAGE_DISMISS) || "0", 10) || 0; } catch(_){}
    if(dismissed >= info.versionCode) return;
    showBanner(info);
  }

  function init(){
    if(!isAndroidApp()) return;
    setTimeout(check, 4000);
    setInterval(check, CHECK_INTERVAL_MS);
    try {
      var App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if(App && App.addListener){
        App.addListener("resume", function(){ check(); });
      }
    } catch(_){}
  }

  window.CavalyraUpdater = {
    check: check,
    currentVersionCode: CURRENT_VERSION_CODE,
    currentVersionName: CURRENT_VERSION_NAME
  };

  if(document.readyState === "complete" || document.readyState === "interactive"){
    setTimeout(init, 0);
  } else {
    window.addEventListener("DOMContentLoaded", init);
  }
})();
