/* =========================================================================
   Cavalyra Billing Abstraction
   -------------------------------------------------------------------------
   Web     -> Paddle (unverändert)
   Android -> Google Play Billing (cordova-plugin-purchase v13 / CdvPurchase)
   iOS     -> Apple StoreKit (cordova-plugin-purchase v13 / CdvPurchase)

   Pflicht für die Stores:
   - Keine externen Bezahllinks oder Paddle-Hinweise in den Native-Builds.
   - Digitale Abos laufen ausschließlich über die Store-eigene Bezahlung.

   Produkt-IDs (müssen 1:1 in den Store-Konsolen angelegt werden):
     - Android (Google Play):  cavalyra_pro_monthly
     - iOS (App Store):        de.cavalyra.app.pro.monthly
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
  var PRODUCT_ID_ANDROID = "cavalyra_pro_monthly";
  var PRODUCT_ID_IOS     = "de.cavalyra.app.pro.monthly";

  function currentProductId(){
    if(isIosApp()) return PRODUCT_ID_IOS;
    return PRODUCT_ID_ANDROID;
  }
  function currentStorePlatform(){
    var CdvPurchase = window.CdvPurchase;
    if(!CdvPurchase) return null;
    if(isIosApp()) return CdvPurchase.Platform.APPLE_APPSTORE;
    return CdvPurchase.Platform.GOOGLE_PLAY;
  }
  function currentSourceLabel(){
    return isIosApp() ? "app_store" : "google_play";
  }

  // -------------------- State-Helper --------------------
  function isReviewMode(){
    try { return !!(window.CAVALYRA_REVIEW_MODE); } catch(_){ return false; }
  }

  function applyProState(active, source, extra){
    try {
      if(!active && isReviewMode()){
        console.log("[CavalyraBilling] Review Mode aktiv – Pro-Status bleibt freigeschaltet.");
        return;
      }
      if(typeof window.state === "undefined" || !window.state){
        console.warn("[CavalyraBilling] window.state noch nicht verfügbar – warte auf cavalyra:ready, um Pro="+active+" zu setzen.");
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
      var storeSources = { google_play:1, app_store:1 };
      if(active){
        window.state.license.status = "pro";
        window.state.license.pro = true;
        window.state.license.source = source || currentSourceLabel();
        console.log("[CavalyraBilling] Pro-Status AKTIV gesetzt (source="+source+").");
      } else {
        if(storeSources[source]){
          window.state.license.status = "free";
          window.state.license.pro = false;
          window.state.license.source = source;
          console.log("[CavalyraBilling] Pro-Status auf free zurückgesetzt ("+source+").");
        }
      }
      if(extra && typeof extra === "object"){
        for(var k in extra){ if(Object.prototype.hasOwnProperty.call(extra,k)) window.state.license[k] = extra[k]; }
      }
      window.state.license.checkedAt = new Date().toISOString();
      if(typeof window.saveLicense === "function") window.saveLicense(true);
      if(typeof window.render === "function") window.render();
    } catch(e){ console.error("[CavalyraBilling] applyProState fehlgeschlagen", e); }
  }


  // -------------------- Native Billing (CdvPurchase / StoreKit + Play) --------------------
  var billing = {
    ready: false,
    initStarted: false,
    initError: null
  };

  function getStore(){
    return (window.CdvPurchase && window.CdvPurchase.store) || null;
  }

  function initNativeBilling(){
    if(billing.initStarted) return;
    if(!isAndroidApp() && !isIosApp()) return;
    billing.initStarted = true;

    var CdvPurchase = window.CdvPurchase;
    var store = getStore();
    if(!CdvPurchase || !store){
      billing.initError = "In-App-Käufe sind auf diesem Gerät nicht verfügbar.";
      console.warn("[CavalyraBilling] CdvPurchase nicht geladen – Billing wird nicht initialisiert.");
      return;
    }

    var platform = currentStorePlatform();
    var productId = currentProductId();

    try {
      store.verbosity = CdvPurchase.LogLevel ? CdvPurchase.LogLevel.WARNING : 2;

      store.register([{
        id: productId,
        type: CdvPurchase.ProductType.PAID_SUBSCRIPTION,
        platform: platform
      }]);

      store.when()
        .approved(function(transaction){
          try {
            console.log("[CavalyraBilling] approved-Event", transaction && transaction.transactionId, "products=", (transaction && transaction.products) || []);
            applyProState(true, currentSourceLabel(), { productId: productId });
            if(typeof transaction.finish === "function") transaction.finish();
          } catch(e){ console.error("[CavalyraBilling] approved/finish error", e); }
          syncFromStore();
        })
        .verified(function(receipt){
          try {
            console.log("[CavalyraBilling] verified-Event");
            if(typeof receipt.finish === "function") receipt.finish();
          } catch(_){}
          applyProState(true, currentSourceLabel(), { productId: productId });
          syncFromStore();
        })
        .finished(function(){ console.log("[CavalyraBilling] finished-Event"); syncFromStore(); })
        .productUpdated(function(p){ console.log("[CavalyraBilling] productUpdated", p && p.id, "owned=", p && p.owned); syncFromStore(); })
        .receiptUpdated(function(){ console.log("[CavalyraBilling] receiptUpdated"); syncFromStore(); })
        .receiptsReady(function(){ console.log("[CavalyraBilling] receiptsReady"); syncFromStore(); });

      // Dummy-Validator: ohne Backend einfach immer akzeptieren.
      store.validator = function(receipt, callback){
        try { callback(true); } catch(_){}
      };

      store.initialize([platform]).then(function(){
        billing.ready = true;
        try {
          var products = (typeof store.products !== "undefined") ? store.products : [];
          console.log("[CavalyraBilling] Store initialisiert (" + getPlatform() + "). Produkte:", products.map(function(p){ return { id:p.id, owned:p.owned, offers:(p.offers||[]).length }; }));
          var p = getProduct();
          console.log("[CavalyraBilling] " + productId + " gefunden?", !!p, p ? { id:p.id, owned:p.owned } : null);
        } catch(_){}
        try {
          if(typeof store.restorePurchases === "function"){
            store.restorePurchases().then(function(){ syncFromStore(); }).catch(function(){});
          }
        } catch(_){}
        syncFromStore();
      }).catch(function(err){
        billing.initError = (err && err.message) ? err.message : String(err);
        console.error("[CavalyraBilling] init failed", err);
      });
    } catch(e){
      billing.initError = e && e.message ? e.message : String(e);
      console.error("[CavalyraBilling] init exception", e);
    }
  }

  function getProduct(){
    var store = getStore();
    if(!store) return null;
    try {
      return store.get(currentProductId(), currentStorePlatform()) || null;
    } catch(_){ return null; }
  }

  function isProductOwned(){
    var CdvPurchase = window.CdvPurchase;
    var store = getStore();
    if(!store || !CdvPurchase) return false;
    var pid = currentProductId();
    try {
      if(typeof store.owned === "function" && store.owned(pid)) return true;
    } catch(_){}
    try {
      var p = getProduct();
      if(p && p.owned) return true;
    } catch(_){}
    try {
      var ACTIVE = { approved:1, finished:1, owned:1, initiated:1 };
      var receipts = store.localReceipts || store.receipts || [];
      for(var i=0; i<receipts.length; i++){
        var r = receipts[i];
        var txs = (r && r.transactions) || [];
        for(var j=0; j<txs.length; j++){
          var t = txs[j];
          var prods = t.products || [];
          for(var k=0; k<prods.length; k++){
            if(prods[k] && prods[k].id === pid){
              if(ACTIVE[t.state]) return true;
              if(t.isAcknowledged === true && t.isConsumed !== true) return true;
            }
          }
        }
      }
    } catch(_){}
    return false;
  }

  function syncFromStore(){
    if(!isAndroidApp() && !isIosApp()) return;
    var owned = isProductOwned();
    if(owned){
      applyProState(true, currentSourceLabel(), { productId: currentProductId() });
    }
    // Hinweis: keinen vorhandenen Pro-Status downgraden, solange Receipts noch laden.
  }

  // -------------------- Public API --------------------

  async function checkProStatus(){
    if(isReviewMode()) return true;
    if(isAndroidApp() || isIosApp()){
      if(!billing.initStarted) initNativeBilling();
      var waited = 0;
      while(!billing.ready && !billing.initError && waited < 5000){
        await new Promise(function(r){ setTimeout(r, 200); });
        waited += 200;
      }
      if(billing.initError) throw new Error(billing.initError);
      var store = getStore();
      if(store && typeof store.restorePurchases === "function"){
        try { await store.restorePurchases(); } catch(e){ /* ignore */ }
      }
      syncFromStore();
      return isProductOwned();
    }
    return !!(window.state && window.state.license && window.state.license.pro);
  }

  async function startProPurchase(){
    if(!isAndroidApp() && !isIosApp()){
      throw new Error("In-App-Käufe sind nur in der mobilen App verfügbar.");
    }
    if(!billing.initStarted) initNativeBilling();
    if(billing.initError) throw new Error(billing.initError);
    var waited = 0;
    while(!billing.ready && waited < 8000){
      await new Promise(function(r){ setTimeout(r, 200); });
      waited += 200;
    }
    var product = getProduct();
    if(!product){
      throw new Error("Das Pro-Abo ist auf diesem Gerät noch nicht verfügbar. Bitte stelle sicher, dass du mit deinem Store-Konto angemeldet bist und das Produkt aktiv ist.");
    }
    var offers = (product.offers && product.offers.length) ? product.offers : [];
    var offer = null;
    function offerHasFreeTrial(o){
      if(!o) return false;
      var idStr = ((o.id || "") + " " + (o.offerId || "") + " " + (o.offerToken || "")).toLowerCase();
      if(idStr.indexOf("free-trial") !== -1 || idStr.indexOf("free_trial") !== -1 || idStr.indexOf("trial") !== -1) return true;
      var phases = o.pricingPhases || [];
      for(var i=0; i<phases.length; i++){
        var p = phases[i];
        var micros = p.priceMicros != null ? p.priceMicros : (p.price_amount_micros != null ? p.price_amount_micros : null);
        if(micros === 0 || micros === "0") return true;
      }
      return false;
    }
    for(var i=0; i<offers.length; i++){ if(offerHasFreeTrial(offers[i])){ offer = offers[i]; break; } }
    if(!offer){
      offer = (typeof product.getOffer === "function") ? product.getOffer() : offers[0];
    }
    if(!offer){
      throw new Error("Es ist aktuell kein Angebot für das Pro-Abo verfügbar.");
    }
    try {
      var order = offer.order ? offer.order() : getStore().order(offer);
      await order;
      var tries = 0;
      while(tries < 25 && !isProductOwned()){
        await new Promise(function(r){ setTimeout(r, 400); });
        try {
          var st = getStore();
          if(st && tries % 5 === 4 && typeof st.restorePurchases === "function"){
            try { await st.restorePurchases(); } catch(_){}
          }
        } catch(_){}
        tries++;
      }
      syncFromStore();
      return true;
    } catch(e){
      throw new Error((e && e.message) ? e.message : "Kauf konnte nicht gestartet werden.");
    }
  }

  async function restorePurchases(){
    if(!isAndroidApp() && !isIosApp()){
      throw new Error("Käufe wiederherstellen ist nur in der mobilen App nötig.");
    }
    if(!billing.initStarted) initNativeBilling();
    var waited = 0;
    while(!billing.ready && !billing.initError && waited < 5000){
      await new Promise(function(r){ setTimeout(r, 200); });
      waited += 200;
    }
    var store = getStore();
    if(!store) throw new Error("In-App-Käufe sind nicht verfügbar.");
    try {
      if(typeof store.restorePurchases === "function") await store.restorePurchases();
    } catch(e){
      throw new Error((e && e.message) ? e.message : "Wiederherstellen fehlgeschlagen.");
    }
    syncFromStore();
    return isProductOwned();
  }

  function getProductInfo(){
    var p = getProduct();
    if(!p) return null;
    var offer = (typeof p.getOffer === "function") ? p.getOffer() : (p.offers && p.offers[0]);
    var pricing = offer && offer.pricingPhases && offer.pricingPhases[0];
    return {
      id: p.id,
      title: p.title || "Cavalyra Pro",
      description: p.description || "",
      priceString: pricing ? pricing.price : (p.pricing && p.pricing.price) || "",
      owned: !!p.owned
    };
  }

  function init(){
    if(isAndroidApp() || isIosApp()){
      var attempts = 0;
      var iv = setInterval(function(){
        attempts++;
        if(window.CdvPurchase && getStore()){
          clearInterval(iv);
          initNativeBilling();
        } else if(attempts > 50){
          clearInterval(iv);
          console.warn("[CavalyraBilling] CdvPurchase wurde nicht innerhalb von 10s gefunden.");
        }
      }, 200);
    }
  }

  window.CavalyraBilling = {
    PRODUCT_ID_ANDROID: PRODUCT_ID_ANDROID,
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
   Web/Paddle-Flow bleibt unverändert.
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

  window.cavalyraNativeBuyPro = async function(){
    var btn = document.getElementById("nativeBuyProBtn");
    if(btn){ btn.disabled = true; btn.textContent = "Kauf wird gestartet…"; }
    try {
      await window.CavalyraBilling.startProPurchase();
      if(window.toast) window.toast("Kauf abgeschlossen – Pro wird freigeschaltet.");
    } catch(e){
      console.error(e);
      if(window.toast) window.toast(e && e.message ? e.message : "Kauf fehlgeschlagen.");
      var msg = document.getElementById("nativeBillingMessage");
      if(msg) msg.textContent = e && e.message ? e.message : "Kauf fehlgeschlagen.";
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = "3 Tage kostenlos testen"; }
    }
    return false;
  };

  window.cavalyraNativeRestore = async function(){
    var btn = document.getElementById("nativeRestoreProBtn");
    if(btn){ btn.disabled = true; btn.textContent = "Wird wiederhergestellt…"; }
    try {
      var ok = await window.CavalyraBilling.restorePurchases();
      if(window.toast) window.toast(ok ? "Pro-Abo gefunden und freigeschaltet." : "Kein aktives Pro-Abo gefunden.");
    } catch(e){
      console.error(e);
      if(window.toast) window.toast(e && e.message ? e.message : "Wiederherstellen fehlgeschlagen.");
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = "Käufe wiederherstellen"; }
    }
    return false;
  };

  // Rückwärtskompatibilität (Android-Buttons aus älteren Builds)
  window.cavalyraAndroidBuyPro = window.cavalyraNativeBuyPro;
  window.cavalyraAndroidRestore = window.cavalyraNativeRestore;

  function renderProNative(){
    var statusLabel = (typeof window.licenseStatusLabel === "function") ? window.licenseStatusLabel() : "";
    var statusClass = (typeof window.licenseStatusClass === "function") ? window.licenseStatusClass() : "";
    var statusText  = (typeof window.licenseStatusText  === "function") ? window.licenseStatusText()  : "";
    var info = (window.CavalyraBilling.getProductInfo && window.CavalyraBilling.getProductInfo()) || null;
    var FALLBACK_PRICE = "6,99 € / Monat";
    var priceText = (info && info.priceString) ? info.priceString : FALLBACK_PRICE;
    var storeName = isIos() ? "App Store" : "Google Play";
    var manageHint = isIos()
      ? "Dein Pro-Abo wird über den App Store abgerechnet und kann jederzeit unter Einstellungen → Apple-ID → Abos gekündigt werden."
      : "Dein Pro-Abo wird über Google Play abgerechnet und kann jederzeit im Play Store gekündigt werden.";
    var priceLine = '<p class="small"><strong>3 Tage kostenlos testen</strong> – danach ' + esc(priceText) + '. Verlängert sich automatisch, jederzeit im ' + esc(storeName) + ' kündbar.</p>';

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
      +     priceLine
      +     '<div class="license-check-actions">'
      +       '<button class="btn" id="nativeBuyProBtn" onclick="return cavalyraNativeBuyPro()">3 Tage kostenlos testen</button>'
      +       '<button class="btn secondary" id="nativeRestoreProBtn" onclick="return cavalyraNativeRestore()">Käufe wiederherstellen</button>'
      +     '</div>'
      +     '<div class="license-check-message" id="nativeBillingMessage">'
      +       esc(manageHint)
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="grid grid-2 section">'
      +   '<div class="card"><h2>Free</h2><div class="features"><span>1 Pferd</span><span>Pferdebuch</span><span>Kalender</span><span>Grundfunktionen</span></div></div>'
      +   '<div class="card"><h2>Pro</h2><div class="features"><span>Alle Kurse</span><span>Cavalyra Body Scanner</span><span>GPS-Ausritte</span><span>Mehrere Pferde</span><span>Premium-Inhalte</span></div></div>'
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
        catch(e){ console.error("renderProNative failed, fallback to web UI", e); return _orig.apply(this, arguments); }
      };
    }

    // Externe Paddle-Links in Native-Builds unterdrücken
    window.openCavalyraPricing = function(){
      if(window.navigate) window.navigate("pro");
      return false;
    };
    window.openCavalyraCustomerPortal = function(){
      if(window.toast) window.toast(isIos()
        ? "Abo verwalten: Einstellungen → Apple-ID → Abos"
        : "Abo verwalten: Google Play → Konto → Abos");
      return false;
    };

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
