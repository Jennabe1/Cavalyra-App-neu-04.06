/* =========================================================================
   Cavalyra Billing Abstraction
   -------------------------------------------------------------------------
   Web     -> Paddle (unverändert, via index.html Legacy-Flow)
   iOS     -> Apple StoreKit (cordova-plugin-purchase v13 / CdvPurchase)
   Android -> Paddle Web-Checkout (Capacitor Browser Plugin) + serverseitige
              Lizenzprüfung über /.netlify/functions/check-license.
              KEIN Google Play Billing – die APK wird direkt über die Website
              (cavalyra.com) verteilt und ist damit unabhängig vom Play Store.

   Produkt-IDs:
     - iOS (App Store): de.cavalyra.app.pro.monthly
     - Android:         nicht mehr relevant, Paddle verwaltet Abo serverseitig.
   ========================================================================= */
(function(){
  "use strict";

  // -------------------- Plattform-Erkennung --------------------
  function isNativeApp(){
    try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
    catch(_){ return false; }
  }
  function getPlatform(){
    try { return (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || "web"; }
    catch(_){ return "web"; }
  }
  function isAndroidApp(){ return isNativeApp() && getPlatform() === "android"; }
  function isIosApp(){ return isNativeApp() && getPlatform() === "ios"; }
  function isWeb(){ return !isNativeApp(); }

  // -------------------- Konstanten --------------------
  var PRODUCT_ID_IOS = "de.cavalyra.app.pro.monthly";

  // Paddle Web-Checkout (Android)
  // Direkter Paddle-Checkout ohne Umweg über die Website.
  // Wenn PADDLE_CLIENT_TOKEN gesetzt ist, öffnet die App Paddle.Checkout
  // direkt in einem eingebetteten Overlay. Ansonsten wird als Fallback
  // die bestehende Paddle-Preisseite genutzt.
  // Token wird ausschließlich aus /config/cavalyra-config.js gelesen.
  // Er darf NICHT fest im Quellcode hinterlegt sein.
  function getPaddleToken(){ return (window.CAVALYRA_PADDLE_CLIENT_TOKEN || "").trim(); }
  function getPaddleEnv(){ return (window.CAVALYRA_PADDLE_ENV || "production").trim(); }
  var PADDLE_MONTHLY_PRICE_ID = "pri_01ksnccs23fwwm0qctdydb93xz";
  // Grobe Form-Prüfung: Paddle-Client-Tokens beginnen mit "live_" oder "test_".
  function isValidPaddleToken(t){ return /^(live|test)_[A-Za-z0-9_\-]{10,}$/.test(t || ""); }
  var LICENSE_CHECK_URL   = "https://cavalyra.de/.netlify/functions/check-license";
  var LICENSE_EMAIL_STORAGE = "cavalyra:license:email";

  // -------------------- State-Helper --------------------
  function applyProState(active, source, extra){
    try {
      if(typeof window.state === "undefined" || !window.state){
        console.warn("[CavalyraBilling] window.state noch nicht verfügbar – warte auf cavalyra:ready.");
        var retry = function(){ applyProState(active, source, extra); };
        window.addEventListener("cavalyra:ready", retry, { once: true });
        var tries = 0;
        var iv = setInterval(function(){
          tries++;
          if(window.state){ clearInterval(iv); applyProState(active, source, extra); }
          else if(tries > 50){ clearInterval(iv); }
        }, 200);
        return;
      }
      window.state.license = window.state.license || {};
      var storeSources = { app_store:1, paddle:1 };
      if(active){
        window.state.license.status = "pro";
        window.state.license.pro = true;
        window.state.license.source = source || "paddle";
      } else if(storeSources[source]){
        window.state.license.status = "free";
        window.state.license.pro = false;
        window.state.license.source = source;
      }
      if(extra && typeof extra === "object"){
        for(var k in extra){ if(Object.prototype.hasOwnProperty.call(extra,k)) window.state.license[k] = extra[k]; }
      }
      window.state.license.checkedAt = new Date().toISOString();
      if(typeof window.saveLicense === "function") window.saveLicense(true);
      if(typeof window.render === "function") window.render();
    } catch(e){ console.error("[CavalyraBilling] applyProState fehlgeschlagen", e); }
  }

  // -------------------- iOS StoreKit --------------------
  var iosBilling = { ready:false, initStarted:false, initError:null };

  function getStore(){ return (window.CdvPurchase && window.CdvPurchase.store) || null; }
  function iosPlatform(){ var C=window.CdvPurchase; return C ? C.Platform.APPLE_APPSTORE : null; }

  function initIosBilling(){
    if(iosBilling.initStarted || !isIosApp()) return;
    iosBilling.initStarted = true;
    var CdvPurchase = window.CdvPurchase;
    var store = getStore();
    if(!CdvPurchase || !store){
      iosBilling.initError = "In-App-Käufe sind auf diesem Gerät nicht verfügbar.";
      return;
    }
    try {
      store.verbosity = CdvPurchase.LogLevel ? CdvPurchase.LogLevel.WARNING : 2;
      store.register([{
        id: PRODUCT_ID_IOS,
        type: CdvPurchase.ProductType.PAID_SUBSCRIPTION,
        platform: iosPlatform()
      }]);
      store.when()
        .approved(function(t){
          try { applyProState(true, "app_store", { productId: PRODUCT_ID_IOS }); if(t.finish) t.finish(); } catch(_){ }
          syncIosStore();
        })
        .verified(function(r){ try{ if(r.finish) r.finish(); }catch(_){ } applyProState(true, "app_store", { productId: PRODUCT_ID_IOS }); syncIosStore(); })
        .productUpdated(syncIosStore)
        .receiptUpdated(syncIosStore)
        .receiptsReady(syncIosStore);
      store.validator = function(receipt, cb){ try{ cb(true); }catch(_){ } };
      store.initialize([iosPlatform()]).then(function(){
        iosBilling.ready = true;
        try { if(typeof store.restorePurchases === "function") store.restorePurchases().catch(function(){}); } catch(_){}
        syncIosStore();
      }).catch(function(err){
        iosBilling.initError = (err && err.message) || String(err);
      });
    } catch(e){ iosBilling.initError = e && e.message ? e.message : String(e); }
  }

  function getIosProduct(){
    var store = getStore(); if(!store) return null;
    try { return store.get(PRODUCT_ID_IOS, iosPlatform()) || null; } catch(_){ return null; }
  }
  function isIosProductOwned(){
    var CdvPurchase = window.CdvPurchase; var store = getStore();
    if(!store || !CdvPurchase) return false;
    try { if(typeof store.owned === "function" && store.owned(PRODUCT_ID_IOS)) return true; } catch(_){}
    try { var p = getIosProduct(); if(p && p.owned) return true; } catch(_){}
    try {
      var ACTIVE = { approved:1, finished:1, owned:1, initiated:1 };
      var receipts = store.localReceipts || store.receipts || [];
      for(var i=0;i<receipts.length;i++){
        var txs = (receipts[i] && receipts[i].transactions) || [];
        for(var j=0;j<txs.length;j++){
          var prods = txs[j].products || [];
          for(var k=0;k<prods.length;k++){
            if(prods[k] && prods[k].id === PRODUCT_ID_IOS){
              if(ACTIVE[txs[j].state]) return true;
              if(txs[j].isAcknowledged === true && txs[j].isConsumed !== true) return true;
            }
          }
        }
      }
    } catch(_){}
    return false;
  }
  function syncIosStore(){
    if(!isIosApp()) return;
    if(isIosProductOwned()){
      applyProState(true, "app_store", { productId: PRODUCT_ID_IOS });
    } else {
      // Abo abgelaufen / gekündigt / nie gekauft: nur zurückstufen,
      // wenn Pro zuvor über den App Store gesetzt wurde.
      try {
        var lic = (window.state && window.state.license) || {};
        if(lic.source === "app_store" && (lic.status === "pro" || lic.status === "trial")){
          applyProState(false, "app_store", { productId: PRODUCT_ID_IOS });
        }
      } catch(_){}
    }
  }

  // -------------------- Android (Paddle) --------------------
function getInstallationId() {
  try {
    var id = localStorage.getItem("cavalyra_installation_id");

    if (!id) {
      if (window.crypto && window.crypto.randomUUID) {
        id = window.crypto.randomUUID();
      } else {
        id = "id_" + Date.now() + "_" + Math.random().toString(36).substring(2, 12);
      }

      localStorage.setItem("cavalyra_installation_id", id);
    }

    return id;
  } catch (_) {
    return "id_" + Date.now();
  }
}

function getKnownEmail() {
  try {
    return (
      localStorage.getItem(LICENSE_EMAIL_STORAGE) ||
      ""
    ).trim().toLowerCase();
  } catch (_) {
    return "";
  }
}

function saveKnownEmail(email) {
  try {
    if (email) {
      localStorage.setItem(LICENSE_EMAIL_STORAGE, email.trim().toLowerCase());
    }
  } catch (_) {}
}

async function refreshLicenseFromServer() {

  var installationId = getInstallationId();

  try {

    var res = await fetch(
      LICENSE_CHECK_URL +
      "?installationId=" +
      encodeURIComponent(installationId),
      {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      }
    );

    var data = await res.json().catch(function () {
      return null;
    });

    if (!res.ok || !data) {
      return {
        ok: false,
        status: "free",
        reason: "network"
     async function openPaddleCheckout() {

  var installationId = getInstallationId();
  var email = getKnownEmail();

  var res = await fetch(
    "https://cavalyra.de/.netlify/functions/create-paddle-checkout",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        installationId: installationId,
        email: email || null
      })
    }
  );

  var data = await res.json().catch(function () {
    return null;
  });

  if (!res.ok || !data || !data.checkoutUrl) {
    throw new Error(
      (data && data.error) ||
      "Checkout konnte nicht erstellt werden."
    );
  }

  if (
    window.Capacitor &&
    window.Capacitor.Plugins &&
    window.Capacitor.Plugins.Browser
  ) {

    await window.Capacitor.Plugins.Browser.open({
      url: data.checkoutUrl
    });

  } else {

    window.open(data.checkoutUrl, "_blank");

  }

}
      }
      var opts = {
        items: [{ priceId: PADDLE_MONTHLY_PRICE_ID, quantity: 1 }],
        settings: {
          displayMode: "overlay",
          theme: "light",
          locale: "de",
          allowLogout: false
        },
        successCallback: function(){
          refreshLicenseFromServer(email).catch(function(){});
          [1500, 4000, 8000, 15000].forEach(function(ms){
            setTimeout(function(){ refreshLicenseFromServer(email).catch(function(){}); }, ms);
          });
          done("Kauf abgeschlossen – Pro wird gleich freigeschaltet.");
        },
        closeCallback: function(){
          // Nutzer hat den Checkout geschlossen bzw. abgebrochen.
          // Sicherheitshalber trotzdem einmal Lizenzstatus prüfen.
          refreshLicenseFromServer(email).catch(function(){});
          done("Checkout geschlossen. Kein Kauf abgeschlossen.");
        }
      };
      if(email) opts.customer = { email: email };
      try {
        window.Paddle.Checkout.open(opts);
      } catch(e){
        settled = true;
        reject(new Error("Paddle-Checkout konnte nicht geöffnet werden: " + (e && e.message ? e.message : "Unbekannter Fehler")));
      }
    });
  }

  // Auto-Refresh nach Rückkehr in die App (Paddle-Kauf beendet)
  function attachAndroidResumeHook(){
    if(!isAndroidApp()) return;
    function refreshAll(){
      function attachAndroidResumeHook() {

  if (!isAndroidApp()) return;

  function refreshAll() {
    refreshLicenseFromServer().catch(function(){});
    try {
      if (typeof window.refreshLicenseSilently === "function") {
        window.refreshLicenseSilently();
      }
    } catch (_) {}
  }

  try {

    var App =
      window.Capacitor &&
      window.Capacitor.Plugins &&
      window.Capacitor.Plugins.App;

    if (App && App.addListener) {

      App.addListener("appStateChange", function(state) {
        if (state && state.isActive) {
          refreshAll();
        }
      });

      App.addListener("resume", refreshAll);

      App.addListener("appUrlOpen", function() {

        try {

          try {
            if (
              window.Capacitor &&
              window.Capacitor.Plugins &&
              window.Capacitor.Plugins.Browser
            ) {
              window.Capacitor.Plugins.Browser.close();
            }
          } catch (_) {}

          refreshAll();

          [1500, 4000, 8000, 15000].forEach(function(ms) {
            setTimeout(refreshAll, ms);
          });

        } catch (_) {}

      });

    }

  } catch (_) {}

  setTimeout(refreshAll, 2000);

}
    if(isIosApp()){
      if(!iosBilling.initStarted) initIosBilling();
      var waited = 0;
      while(!iosBilling.ready && !iosBilling.initError && waited < 5000){
        await new Promise(function(r){ setTimeout(r, 200); });
        waited += 200;
      }
      if(iosBilling.initError) throw new Error(iosBilling.initError);
      var store = getStore();
      if(store && typeof store.restorePurchases === "function"){
        try { await store.restorePurchases(); } catch(_){}
      }
      syncIosStore();
      return isIosProductOwned();
    }
    if(isAndroidApp()){
      var r = await refreshLicenseFromServer();
      return !!r.active;
    }
    return !!(window.state && window.state.license && window.state.license.pro);
  }

  async function startProPurchase(){
    if(isAndroidApp()){
      await openPaddleCheckout();
      return true;
    }
    if(!isIosApp()){
      throw new Error("In-App-Käufe sind nur in der mobilen App verfügbar.");
    }
    // iOS StoreKit-Kauf (unverändert)
    if(!iosBilling.initStarted) initIosBilling();
    if(iosBilling.initError) throw new Error(iosBilling.initError);
    var waited = 0;
    while(!iosBilling.ready && !iosBilling.initError && waited < 15000){
      await new Promise(function(r){ setTimeout(r, 200); });
      waited += 200;
    }
    if(iosBilling.initError) throw new Error(iosBilling.initError);
    var product = getIosProduct();
    var productWait = 0;
    while(!product && productWait < 15000){
      await new Promise(function(r){ setTimeout(r, 250); });
      productWait += 250;
      product = getIosProduct();
    }
    if(!product) throw new Error("Das Pro-Abo (" + PRODUCT_ID_IOS + ") konnte nicht vom App Store geladen werden.");
    var offers = (product.offers && product.offers.length) ? product.offers : [];
    function hasTrial(o){
      if(!o) return false;
      var idStr = ((o.id||"") + " " + (o.offerId||"") + " " + (o.offerToken||"")).toLowerCase();
      if(idStr.indexOf("trial") !== -1) return true;
      var phases = o.pricingPhases || [];
      for(var i=0;i<phases.length;i++){
        var m = phases[i].priceMicros != null ? phases[i].priceMicros : phases[i].price_amount_micros;
        if(m === 0 || m === "0") return true;
      }
      return false;
    }
    var offer = null;
    for(var i=0;i<offers.length;i++){ if(hasTrial(offers[i])){ offer = offers[i]; break; } }
    if(!offer) offer = (typeof product.getOffer === "function") ? product.getOffer() : offers[0];
    if(!offer) throw new Error("Es ist aktuell kein Angebot für das Pro-Abo verfügbar.");
    try {
      var order = offer.order ? offer.order() : getStore().order(offer);
      await order;
      var tries = 0;
      while(tries < 25 && !isIosProductOwned()){
        await new Promise(function(r){ setTimeout(r, 400); });
        tries++;
      }
      syncIosStore();
      return true;
    } catch(e){
      throw new Error((e && e.message) ? e.message : "Kauf konnte nicht gestartet werden.");
    }
  }

  async function restorePurchases(){
    if(isAndroidApp()){
      var r = await refreshLicenseFromServer();
      return !!r.active;
    }
    if(!isIosApp()) throw new Error("Käufe wiederherstellen ist nur in der mobilen App nötig.");
    if(!iosBilling.initStarted) initIosBilling();
    var waited = 0;
    while(!iosBilling.ready && !iosBilling.initError && waited < 5000){
      await new Promise(function(r){ setTimeout(r, 200); });
      waited += 200;
    }
    var store = getStore();
    if(!store) throw new Error("In-App-Käufe sind nicht verfügbar.");
    try { if(typeof store.restorePurchases === "function") await store.restorePurchases(); }
    catch(e){ throw new Error((e && e.message) ? e.message : "Wiederherstellen fehlgeschlagen."); }
    syncIosStore();
    return isIosProductOwned();
  }

  function getProductInfo(){
    if(isIosApp()){
      var p = getIosProduct();
      if(!p) return null;
      var offer = (typeof p.getOffer === "function") ? p.getOffer() : (p.offers && p.offers[0]);
      var pricing = offer && offer.pricingPhases && offer.pricingPhases[0];
      return {
        id: p.id,
        title: p.title || "Cavalyra Pro",
        description: p.description || "",
        priceString: pricing ? pricing.price : ((p.pricing && p.pricing.price) || ""),
        owned: !!p.owned
      };
    }
    // Android: Paddle-Preis statisch (Server ist Source of Truth)
    return { id:"paddle-pro-monthly", title:"Cavalyra Pro", description:"", priceString:"6,99 € / Monat", owned:false };
  }

  function init(){
    if(isIosApp()){
      var attempts = 0;
      var iv = setInterval(function(){
        attempts++;
        if(window.CdvPurchase && getStore()){
          clearInterval(iv);
          initIosBilling();
        } else if(attempts > 50){
          clearInterval(iv);
        }
      }, 200);
    } else if(isAndroidApp()){
      attachAndroidResumeHook();
    }
  }

  window.CavalyraBilling = {
    PRODUCT_ID_IOS: PRODUCT_ID_IOS,
    isNativeApp: isNativeApp,
    isAndroidApp: isAndroidApp,
    isIosApp: isIosApp,
    isWeb: isWeb,
    getPlatform: getPlatform,
    init: init,
    checkProStatus: checkProStatus,
    startProPurchase: startProPurchase,
    restorePurchases: restorePurchases,
    refreshLicenseFromServer: refreshLicenseFromServer,
    saveKnownEmail: saveKnownEmail,
    getProductInfo: getProductInfo
  };

  if(document.readyState === "complete" || document.readyState === "interactive"){
    setTimeout(init, 0);
  } else {
    window.addEventListener("DOMContentLoaded", init);
  }
})();


/* =========================================================================
   UI-Bridge: Pro-Bereich in den Native-Builds umstellen.
   Web/Paddle-Flow bleibt im index.html unverändert.
   ========================================================================= */
(function(){
  "use strict";

  function ready(fn){
    if(document.readyState === "complete") setTimeout(fn, 50);
    else window.addEventListener("load", function(){ setTimeout(fn, 50); });
  }
  function esc(s){
    var fn = window.esc;
    if(typeof fn === "function") return fn(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(m){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[m];
    });
  }
  function isNative(){ return window.CavalyraBilling && (window.CavalyraBilling.isAndroidApp() || window.CavalyraBilling.isIosApp()); }
  function isIos(){ return window.CavalyraBilling && window.CavalyraBilling.isIosApp(); }
  function isAndroid(){ return window.CavalyraBilling && window.CavalyraBilling.isAndroidApp(); }

  window.cavalyraNativeBuyPro = async function(){
    var btn = document.getElementById("nativeBuyProBtn");
    if(btn){ btn.disabled = true; btn.textContent = isAndroid() ? "Öffne Paddle-Checkout…" : "Kauf wird gestartet…"; }
    try {
      await window.CavalyraBilling.startProPurchase();
      if(isAndroid()){
        if(window.toast) window.toast("Nach Abschluss des Kaufs bitte zur App zurückkehren.");
      } else {
        if(window.toast) window.toast("Kauf abgeschlossen – Pro wird freigeschaltet.");
      }
    } catch(e){
      console.error(e);
      if(window.toast) window.toast(e && e.message ? e.message : "Kauf fehlgeschlagen.");
      var msg = document.getElementById("nativeBillingMessage");
      if(msg) msg.textContent = e && e.message ? e.message : "Kauf fehlgeschlagen.";
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = "Kostenlos testen"; }
    }
    return false;
  };

  window.cavalyraNativeRestore = async function(){
    var btn = document.getElementById("nativeRestoreProBtn");
    if(btn){ btn.disabled = true; btn.textContent = "Wird geprüft…"; }
    try {
      if(isAndroid()){
        // Auf Android E-Mail-Prompt anzeigen, wenn keine bekannt ist
        var known = "";
        try { known = localStorage.getItem("cavalyra:license:email") || ""; } catch(_){}
        var email = known || window.prompt("E-Mail-Adresse deines Paddle-Kaufs:", "");
        if(!email){ if(btn){ btn.disabled=false; btn.textContent="Käufe wiederherstellen"; } return false; }
        var r = await window.CavalyraBilling.refreshLicenseFromServer(email);
        if(window.toast) window.toast(r.active ? "Pro-Abo gefunden und freigeschaltet." : "Kein aktives Pro-Abo für diese E-Mail gefunden.");
      } else {
        var ok = await window.CavalyraBilling.restorePurchases();
        if(window.toast) window.toast(ok ? "Pro-Abo gefunden und freigeschaltet." : "Kein aktives Pro-Abo gefunden.");
      }
    } catch(e){
      console.error(e);
      if(window.toast) window.toast(e && e.message ? e.message : "Wiederherstellen fehlgeschlagen.");
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = "Käufe wiederherstellen"; }
    }
    return false;
  };

  window.cavalyraAndroidBuyPro = window.cavalyraNativeBuyPro;
  window.cavalyraAndroidRestore = window.cavalyraNativeRestore;

  function renderProNative(){
    var statusLabel = (typeof window.licenseStatusLabel === "function") ? window.licenseStatusLabel() : "";
    var statusClass = (typeof window.licenseStatusClass === "function") ? window.licenseStatusClass() : "";
    var statusText  = (typeof window.licenseStatusText  === "function") ? window.licenseStatusText()  : "";
    var info = (window.CavalyraBilling.getProductInfo && window.CavalyraBilling.getProductInfo()) || null;
    var FALLBACK_PRICE = "6,99 € / Monat";
    var priceText = (info && info.priceString) ? info.priceString : FALLBACK_PRICE;
    var storeName = isIos() ? "App Store" : "Paddle";
    var manageHint = isIos()
      ? "Dein Pro-Abo wird über den App Store abgerechnet und kann jederzeit unter Einstellungen → Apple-ID → Abos gekündigt werden."
      : "Dein Pro-Abo wird sicher über Paddle abgerechnet und kann jederzeit über das Paddle-Kundenportal verwaltet oder gekündigt werden.";
    var priceLine = '<p class="small"><strong>Kostenlos testen</strong> – danach ' + esc(priceText) + '. Verlängert sich automatisch, jederzeit über ' + esc(storeName) + ' kündbar.</p>';

    var subscriptionDetails = ''
      + '<div class="card" style="margin-bottom:12px;">'
      +   '<h3 style="margin:0 0 8px 0;font-size:20px;">Cavalyra Pro</h3>'
      +   '<p class="small" style="margin:0 0 6px 0;"><strong>Laufzeit:</strong> 1 Monat</p>'
      +   '<p class="small" style="margin:0;"><strong>Preis:</strong> ' + esc(priceText) + '</p>'
      + '</div>';

    // Legal-Links (Datenschutz/AGB) sind bereits im Profil-Bereich vorhanden.
    // Auf iOS bleibt nur die Apple-Compliance-Zeile (Privacy Policy + Apple EULA).
    var legalLinks = isIos()
      ? ('<div class="legal-link-list" style="margin:14px 0;">'
          + '<a href="https://cavalyra.de/datenschutz" target="_blank" rel="noopener">Privacy Policy</a>'
          + '<a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener">Terms of Use (Apple Standard EULA)</a>'
          + '</div>')
      : '';

    var manageBtn = isAndroid()
      ? '<button class="btn secondary" onclick="return openCavalyraCustomerPortal()">Abo verwalten</button>'
      : '';

    var html = ''
      + '<div class="hero">'
      +   '<h1>Cavalyra Pro</h1>'
      +   '<p>Schalte alle Kurse, den Cavalyra Body Scanner, mehrere Pferde und Premium-Inhalte frei.</p>'
      + '</div>'
      + '<div class="license-check-box">'
      +   '<div class="license-status-row">'
      +     '<div>'
      +       '<h2>Pro-Zugang</h2>'
      +       '<p>' + esc(statusText) + '</p>'
      +     '</div>'
      +     '<div class="license-status-pill ' + esc(statusClass) + '">' + esc(statusLabel) + '</div>'
      +   '</div>'
      +   '<div class="form section">'
      +     subscriptionDetails
      +     priceLine
      +     legalLinks
      +     '<div class="license-check-actions">'
      +       '<button class="btn" id="nativeBuyProBtn" onclick="return cavalyraNativeBuyPro()">Kostenlos testen</button>'
      +       '<button class="btn secondary" id="nativeRestoreProBtn" onclick="return cavalyraNativeRestore()">Käufe wiederherstellen</button>'
      +       manageBtn
      +     '</div>'
      +     '<div class="license-check-message" id="nativeBillingMessage">'
      +       esc(manageHint)
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="grid grid-2 section">'
      +   '<div class="card"><h2>Free</h2><div class="features"><span>1 Pferd</span><span>Pferdebuch</span><span>Kalender</span><span>GPS-Ausritte</span><span>Grundfunktionen</span></div></div>'
      +   '<div class="card"><h2>Pro</h2><div class="features"><span>Alle Kurse</span><span>Cavalyra Body Scanner</span><span>Mehrere Pferde</span><span>Premium-Inhalte</span></div></div>'
      + '</div>';

    var el = document.getElementById("screen-pro");
    if(el) el.innerHTML = html;
  }

  function patch(){
    if(!isNative()) return;

    if(typeof window.renderPro === "function"){
      var _orig = window.renderPro;
      window.renderPro = function(){
        try { return renderProNative(); }
        catch(e){ console.error("renderProNative failed, fallback", e); return _orig.apply(this, arguments); }
      };
    }

    if(isIos()){
      // Externe Bezahllinks in iOS unterdrücken (Apple-Compliance)
      window.openCavalyraPricing = function(){ if(window.navigate) window.navigate("pro"); return false; };
      window.openCavalyraCustomerPortal = function(){
        if(window.toast) window.toast("Abo verwalten: Einstellungen → Apple-ID → Abos");
        return false;
      };
    } else if(isAndroid()){
      // Android: Paddle-Portal ist erlaubt und gewünscht
      window.openCavalyraPricing = function(){
        try {
          if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser){
            window.Capacitor.Plugins.Browser.open({ url: "https://cavalyra.de/#preise" });
          } else {
            window.open("https://cavalyra.de/#preise", "_blank", "noopener");
          }
        } catch(_){ window.open("https://cavalyra.de/#preise", "_blank", "noopener"); }
        return false;
      };
      window.openCavalyraCustomerPortal = function(){
        var url = "https://customer-portal.paddle.com/cpl_01ksj34k26v4xebfvgtnb3xbf9";
        try {
          if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser){
            window.Capacitor.Plugins.Browser.open({ url: url });
          } else {
            window.open(url, "_blank", "noopener");
          }
        } catch(_){ window.open(url, "_blank", "noopener"); }
        return false;
      };
    }

    setTimeout(function(){
      try {
        window.CavalyraBilling.checkProStatus().catch(function(e){
          console.warn("Initial pro check failed", e);
        });
      } catch(e){ console.warn(e); }
    }, 1500);
  }

  ready(patch);
})();
