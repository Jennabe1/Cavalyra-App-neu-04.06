/* =========================================================================
   Cavalyra Billing Abstraction
   -------------------------------------------------------------------------
   Web     -> Paddle (unverändert, via index.html Legacy-Flow)
   iOS     -> Apple StoreKit (cordova-plugin-purchase v13 / CdvPurchase)
   Android -> Supabase Edge Function `create-paddle-checkout` erzeugt eine
              Paddle-Transaction; die zurückgegebene checkout.url wird
              ausschließlich über den Capacitor `Browser`-Plugin geöffnet
              (KEIN window.Paddle.Checkout.open / kein WebView-Overlay).
              Rückkehr in die App via Deep-Link `cavalyra://return`.
              Nach der Rückkehr wird der Pro-Status über die
              Supabase-Edge-Function `check-license` (JWT) neu geladen.

   Produkt-IDs:
     - iOS (App Store): de.cavalyra.app.pro.monthly
     - Android:         Paddle Price ID pri_01ksnccs23fwwm0qctdydb93xz
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

  // Paddle Mobile-Checkout (Android) – ausschließlich über Supabase-Edge-Function
  // + Capacitor Browser Plugin. window.Paddle wird auf Android NICHT mehr geladen.
  var PADDLE_MONTHLY_PRICE_ID = "pri_01ksnccs23fwwm0qctdydb93xz";

  // Supabase / Lovable Cloud
  var SUPABASE_URL = "https://upbubifdcndfxbvmgwzg.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYnViaWZkY25kZnhidm1nd3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTg5MjEsImV4cCI6MjA5NTUzNDkyMX0.f3OQwrVb-mRrr045ia_jcduC8NlOFJghRJFjJkM1qzc";
  var CREATE_CHECKOUT_URL = SUPABASE_URL + "/functions/v1/create-paddle-checkout";
  var CHECK_LICENSE_URL   = SUPABASE_URL + "/functions/v1/check-license";
  // Legacy-Fallback (nur noch für Web-/Desktop-Flows mit E-Mail-Restore relevant)
  var LEGACY_LICENSE_CHECK_URL = "https://cavalyra.de/.netlify/functions/check-license";
  var LICENSE_EMAIL_STORAGE = "cavalyra:license:email";
  var INSTALLATION_ID_STORAGE = "cavalyra:installation_id";

  // Anonyme Installations-ID (UUID). Erlaubt Kauf/Test ohne Cloud-Konto.
  function generateUuidV4(){
    try {
      if(window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch(_){}
    var b = new Uint8Array(16);
    try { (window.crypto || window.msCrypto).getRandomValues(b); }
    catch(_){ for(var i=0;i<16;i++) b[i] = Math.floor(Math.random()*256); }
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = []; for(var j=0;j<16;j++) h.push(("0"+b[j].toString(16)).slice(-2));
    return h[0]+h[1]+h[2]+h[3]+"-"+h[4]+h[5]+"-"+h[6]+h[7]+"-"+h[8]+h[9]+"-"+h[10]+h[11]+h[12]+h[13]+h[14]+h[15];
  }
  function getInstallationId(){
    try {
      var id = localStorage.getItem(INSTALLATION_ID_STORAGE);
      if(id && /^[0-9a-f-]{32,}$/i.test(id)) return id;
      id = generateUuidV4();
      localStorage.setItem(INSTALLATION_ID_STORAGE, id);
      return id;
    } catch(_){ return generateUuidV4(); }
  }

  // Optionaler Zugriff auf Supabase-Access-Token (nur wenn Cloud-Konto aktiv).
  function getSupabaseAccessToken(){
    try {
      var eng = window.CavalyraSync || window.CavalyraSyncEngine;
      var tok = eng && eng._auth && typeof eng._auth.token === "function" ? eng._auth.token() : null;
      if(tok) return tok;
    } catch(_){}
    try {
      var raw = localStorage.getItem("cavalyra_sb_session_v2");
      if(raw){
        var s = JSON.parse(raw);
        if(s && s.access_token) return s.access_token;
      }
    } catch(_){}
    return null;
  }
  async function ensureFreshSupabaseToken(){
    try {
      var eng = window.CavalyraSync || window.CavalyraSyncEngine;
      if(eng && eng._auth && typeof eng._auth.ensureFresh === "function"){
        await eng._auth.ensureFresh();
      }
    } catch(_){}
    return getSupabaseAccessToken();
  }


  // -------------------- State-Helper --------------------
  var BILLING_DEBUG_KEY = "cavalyra:billing:debug";
  function safeDebugValue(value, depth){
    if(depth == null) depth = 0;
    if(depth > 4) return "[max-depth]";
    if(value == null) return value;
    var t = typeof value;
    if(t === "string" || t === "number" || t === "boolean") return value;
    if(t === "function") return "[function]";
    if(Array.isArray(value)) return value.slice(0, 20).map(function(v){ return safeDebugValue(v, depth + 1); });
    if(t === "object"){
      var out = {};
      Object.keys(value).slice(0, 40).forEach(function(k){
        if(/token|secret|password|authorization|receipt/i.test(k)) out[k] = "[redacted]";
        else out[k] = safeDebugValue(value[k], depth + 1);
      });
      return out;
    }
    return String(value);
  }
  function licenseSnapshot(){
    try {
      var l = (window.state && window.state.license) || {};
      return { status:l.status || "", pro:!!l.pro, source:l.source || "", checkedAt:l.checkedAt || "", productId:l.productId || "" };
    } catch(_){ return {}; }
  }
  function debug(event, data){
    try {
      var entry = { ts:new Date().toISOString(), event:event, data:safeDebugValue(data || {}) };
      console.log("[CavalyraBilling][Debug] " + event, entry.data);
      var list = [];
      try { list = JSON.parse(localStorage.getItem(BILLING_DEBUG_KEY) || "[]") || []; } catch(_){ list = []; }
      list.push(entry);
      if(list.length > 250) list = list.slice(list.length - 250);
      try { localStorage.setItem(BILLING_DEBUG_KEY, JSON.stringify(list)); } catch(_){ }
    } catch(_){ }
  }

  function applyProState(active, source, extra){
    try {
      debug("applyProState:called", { active:!!active, source:source || "", extra:extra || {}, before:licenseSnapshot() });
      if(active && source === "app_store" && !(extra && extra.entitlementConfirmed === true)){
        debug("license-change:blocked", { reason:"app_store_requires_confirmed_entitlement", active:!!active, source:source || "", extra:extra || {}, before:licenseSnapshot() });
        return;
      }
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
      debug("license-change:applied", { active:!!active, source:source || "", extra:extra || {}, after:licenseSnapshot() });
    } catch(e){ console.error("[CavalyraBilling] applyProState fehlgeschlagen", e); }
  }

  // -------------------- iOS StoreKit --------------------
  var iosBilling = { ready:false, initStarted:false, initError:null, lastApprovedAt:0, receiptsSeen:false };

  function getStore(){ return (window.CdvPurchase && window.CdvPurchase.store) || null; }
  function iosPlatform(){ var C=window.CdvPurchase; return C ? C.Platform.APPLE_APPSTORE : null; }

  function markIosApproved(){
    iosBilling.lastApprovedAt = Date.now();
    iosBilling.receiptsSeen = true;
    debug("storekit:purchase-approved", { productId: PRODUCT_ID_IOS });
  }

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
          try {
            markIosApproved();
            debug("storekit:purchase-approved-callback", { transaction:t });
            // StoreKit hat den Kauf bereits gegenüber Apple bestätigt, bevor
            // .approved() feuert. Pro sofort freischalten, damit der Nutzer
            // nicht auf .verified() warten muss (bei CdvPurchase v13 feuert
            // .verified() nur, wenn store.validator ein Success-Payload liefert).
            applyProState(true, "app_store", { productId: PRODUCT_ID_IOS, entitlementConfirmed:true, reason:"storekit_approved" });
            if(t && typeof t.verify === "function") { try { t.verify(); } catch(_){} }
            else { try { if(t && t.finish) t.finish(); } catch(_){} }
            setTimeout(syncIosStore, 2000);
          } catch(e){ debug("storekit:approved-handler-error", { message:e && e.message ? e.message : String(e) }); }
        })
        .verified(function(r){
          try{
            debug("storekit:purchase-verified-callback", { receipt:r });
            markIosApproved();
            applyProState(true, "app_store", { productId: PRODUCT_ID_IOS, entitlementConfirmed:true, reason:"storekit_verified" });
            try{ if(r && r.finish) r.finish(); }catch(_){ }
            setTimeout(syncIosStore, 4000);
          }catch(e){ debug("storekit:verified-handler-error", { message:e && e.message ? e.message : String(e) }); }
        })
        .productUpdated(function(p){ debug("storekit:product-updated", { product:p }); syncIosStore(); })
        .receiptUpdated(function(r){ iosBilling.receiptsSeen = true; debug("storekit:receipt-updated", { receipt:r, entitlement:hasValidatedIosEntitlement(r) }); syncIosStore(); })
        .receiptsReady(function(){ iosBilling.receiptsSeen = true; debug("storekit:receipts-ready", { entitlement:hasValidatedIosEntitlement() }); syncIosStore(); });
      store.validator = function(receipt, cb){
        // CdvPurchase v13 erwartet ein ValidatorResponse-Payload (Objekt),
        // kein Boolean. Ein `true`-Boolean führt dazu, dass der Transition
        // nach `verified` nie sauber durchläuft.
        debug("storekit:validator-called", { receipt:receipt, localValidator:true });
        try {
          var payload = { ok: true, data: { transaction: receipt || {} } };
          cb(payload);
        } catch(_){ try { cb({ ok:false, code: 6778003, message: "Local validator error" }); } catch(__){} }
      };
      store.initialize([iosPlatform()]).then(function(){
        iosBilling.ready = true;
        debug("storekit:initialized", { productId: PRODUCT_ID_IOS });
        try { if(typeof store.restorePurchases === "function") store.restorePurchases().catch(function(){}); } catch(_){}
        setTimeout(syncIosStore, 2000);
      }).catch(function(err){
        iosBilling.initError = (err && err.message) || String(err);
        debug("storekit:init-failed", { message: iosBilling.initError });
      });
    } catch(e){ iosBilling.initError = e && e.message ? e.message : String(e); }
  }

  function getIosProduct(){
    var store = getStore(); if(!store) return null;
    try { return store.get(PRODUCT_ID_IOS, iosPlatform()) || null; } catch(_){ return null; }
  }
  function hasIosReceipts(){
    var store = getStore(); if(!store) return false;
    try {
      var receipts = store.localReceipts || store.receipts || [];
      return !!(receipts && receipts.length);
    } catch(_){ return false; }
  }
  function transactionLooksActive(tx){
    if(!tx) return false;
    var state = String(tx.state || tx.transactionState || tx.status || "").toLowerCase();
    if(state === "initiated" || state === "pending" || state === "approved") return false;
    if(state && !(state === "owned" || state === "finished" || state === "verified")) return false;
    var expiry = tx.expirationDate || tx.expiryDate || tx.expiresDate || tx.expiresAt || tx.expirationTime || tx.expiryTime;
    var expiryMs = tx.expiresDateMs || tx.expirationDateMs || tx.expiryDateMs;
    var end = expiryMs ? new Date(Number(expiryMs)) : (expiry ? new Date(expiry) : null);
    if(end && !isNaN(end.getTime()) && end <= new Date()) return false;
    if(tx.isConsumed === true || tx.revoked === true || tx.isRevoked === true) return false;
    if(state === "owned" || state === "finished" || state === "verified" || tx.isAcknowledged === true) return true;
    // Je nach Plugin-Version enthalten echte StoreKit-Receipts keinen Status.
    // Dann akzeptieren wir nur persistente Receipt-/Transaktionsmerkmale und
    // niemals einen gerade gestarteten/approved Kaufdialog ohne Transaktion.
    var hasReceiptMarker = !!(tx.transactionId || tx.originalTransactionId || tx.purchaseDate || tx.lastRenewalDate || tx.expirationDate || tx.expiresDate || tx.expiresAt);
    var hasFutureExpiry = end && !isNaN(end.getTime()) && end > new Date();
    return !state && hasReceiptMarker && (hasFutureExpiry || (!tx.expirationDate && !tx.expiresDate && !tx.expiresAt));
  }
  function objectContainsActiveProduct(obj, depth){
    if(!obj || depth > 5) return false;
    if(Array.isArray(obj)){
      for(var i=0;i<obj.length;i++){ if(objectContainsActiveProduct(obj[i], depth + 1)) return true; }
      return false;
    }
    if(typeof obj !== "object") return false;
    var directId = obj.id || obj.productId || obj.product_id;
    if(directId === PRODUCT_ID_IOS && (obj.owned === true || transactionLooksActive(obj))) return true;
    var products = obj.products || obj.productIds || obj.product_ids;
    var hasProduct = false;
    if(Array.isArray(products)){
      for(var p=0;p<products.length;p++){
        var item = products[p];
        if(item === PRODUCT_ID_IOS || (item && (item.id === PRODUCT_ID_IOS || item.productId === PRODUCT_ID_IOS))){ hasProduct = true; break; }
      }
    }
    if(hasProduct && transactionLooksActive(obj)) return true;
    var keys = Object.keys(obj);
    for(var k=0;k<keys.length;k++){
      var key = keys[k];
      if(/token|secret|password|authorization/i.test(key)) continue;
      if(objectContainsActiveProduct(obj[key], depth + 1)) return true;
    }
    return false;
  }
  function hasValidatedIosEntitlement(sourceObj){
    var CdvPurchase = window.CdvPurchase; var store = getStore();
    var result = false;
    if(store && CdvPurchase){
      // store.owned/product.owned können während des Kauf-Flows optimistisch
      // gesetzt werden. Für Pro zählt nur ein bestätigtes Receipt/Transaction.
      try { if(!result && sourceObj && objectContainsActiveProduct(sourceObj, 0)) result = true; } catch(_){}
      try {
        if(!result){
          var receipts = store.localReceipts || store.receipts || [];
          result = objectContainsActiveProduct(receipts, 0);
        }
      } catch(_){}
    }
    debug(result ? "storekit:entitlement-found" : "storekit:entitlement-not-found", { result:!!result, productId:PRODUCT_ID_IOS });
    return !!result;
  }
  function isIosProductOwned(){
    var owned = hasValidatedIosEntitlement();
    debug("hasActiveIosEntitlement:return", { result:owned });
    return owned;
  }
  function syncIosStore(){
    if(!isIosApp()) return;
    debug("storekit:sync-start", { before:licenseSnapshot() });
    if(isIosProductOwned()){
      applyProState(true, "app_store", { productId: PRODUCT_ID_IOS, entitlementConfirmed:true, reason:"sync_active_entitlement" });
      return;
    }
    // Nicht demoten, wenn der Kauf gerade eben approved/verified wurde
    // (Receipt braucht auf StoreKit-Seite kurz, bis er lokal auftaucht).
    if(iosBilling.lastApprovedAt && (Date.now() - iosBilling.lastApprovedAt) < 60000){
      try { console.log("[CavalyraBilling][iOS] skip demotion – recent approval"); } catch(_){}
      return;
    }
    // Nicht demoten, solange wir noch keine Receipts von StoreKit erhalten haben
    // (verhindert False-Free direkt nach App-Start / vor restorePurchases).
    if(!iosBilling.receiptsSeen && !hasIosReceipts()){
      try { console.log("[CavalyraBilling][iOS] skip demotion – no receipts loaded yet"); } catch(_){}
      return;
    }
    // Abo abgelaufen / gekündigt / nie gekauft: nur zurückstufen,
    // wenn Pro zuvor über den App Store gesetzt wurde.
    try {
      var lic = (window.state && window.state.license) || {};
      if(lic.source === "app_store" && (lic.status === "pro" || lic.status === "trial")){
        debug("storekit:demoting-no-entitlement", { before:licenseSnapshot() });
        applyProState(false, "app_store", { productId: PRODUCT_ID_IOS });
      }
    } catch(_){}
  }

  // -------------------- Android (Paddle) --------------------
  function getKnownEmail(){
    try {
      var stored = localStorage.getItem(LICENSE_EMAIL_STORAGE);
      if(stored) return stored;
    } catch(_){}
    try {
      if(window.state && window.state.license && window.state.license.email) return window.state.license.email;
    } catch(_){}
    // Cloud-Account?
    try {
      var s = window.CavalyraSyncEngine && window.CavalyraSyncEngine.getSession && window.CavalyraSyncEngine.getSession();
      if(s && s.user && s.user.email) return s.user.email;
    } catch(_){}
    try {
      var s2 = window.CavalyraCloud && window.CavalyraCloud.getSession && window.CavalyraCloud.getSession();
      if(s2 && s2.user && s2.user.email) return s2.user.email;
    } catch(_){}
    return "";
  }
  function saveKnownEmail(email){
    try { if(email) localStorage.setItem(LICENSE_EMAIL_STORAGE, email); } catch(_){}
  }

  // Ruft die Supabase-Edge-Function `check-license` auf.
  // Funktioniert ohne Cavalyra-Cloud-Konto: falls kein JWT verfügbar ist,
  // wird die anonyme installation_id verwendet.
  async function refreshLicenseViaSupabase(){
    var jwt = await ensureFreshSupabaseToken();
    var installationId = getInstallationId();
    try {
      var headers = {
        "Accept": "application/json",
        "apikey": SUPABASE_ANON_KEY
      };
      if(jwt){
        headers["Authorization"] = "Bearer " + jwt;
      } else {
        // Anon-Aufruf braucht trotzdem einen Bearer (Supabase-Gateway) –
        // der Anon-Key ist dafür vorgesehen.
        headers["Authorization"] = "Bearer " + SUPABASE_ANON_KEY;
      }
      var url = CHECK_LICENSE_URL + "?installation_id=" + encodeURIComponent(installationId);
      var res = await fetch(url, { method: "GET", headers: headers });
      var data = await res.json().catch(function(){ return null; });
      if(!res.ok || !data || data.ok === false){
        debug("check-license:error", { status:res.status, data:data });
        return { ok:false, status:"free", reason:"network" };
      }
      var status = String(data.status || "free").toLowerCase();
      var isPro  = status === "pro" || status === "trial" || status === "active" || status === "trialing";
      applyProState(isPro, "paddle", {
        status: status,
        customerId: data.customerId || "",
        subscriptionId: data.subscriptionId || "",
        validUntil: data.expiresAt || "",
        source: data.source || "paddle",
        installationId: installationId,
        trial: status === "trial" || status === "trialing"
      });
      return { ok:true, status:status, active:isPro };
    } catch(e){
      return { ok:false, status:"free", reason:"exception", message:e && e.message };
    }
  }

  // Restore via E-Mail (Paddle) – für Nutzer ohne Cavalyra-Cloud-Konto.
  // Fragt `check-license` mit email + installation_id an. Server prüft,
  // ob eine AKTIVE Pro-Lizenz existiert, hängt die neue installation_id
  // an die Zeile und antwortet. Bei Erfolg wird Pro sofort freigeschaltet.
  async function restoreLicenseByEmail(rawEmail){
    var email = String(rawEmail || "").trim().toLowerCase();
    if(!email || email.indexOf("@") === -1){
      throw new Error("Bitte gib eine gültige E-Mail-Adresse ein.");
    }
    var installationId = getInstallationId();
    var headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + SUPABASE_ANON_KEY
    };
    var res, data;
    try {
      res = await fetch(CHECK_LICENSE_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ email: email, installation_id: installationId })
      });
      data = await res.json().catch(function(){ return null; });
    } catch(e){
      throw new Error("Verbindung zum Server fehlgeschlagen. Bitte prüfe deine Internetverbindung.");
    }
    if(!data){
      throw new Error("Unerwartete Serverantwort.");
    }
    if(data.ok === false){
      var msg = data.message || "Für diese E-Mail wurde keine aktive Pro-Lizenz gefunden.";
      throw new Error(msg);
    }
    var status = String(data.status || "free").toLowerCase();
    var isPro  = status === "pro" || status === "trial" || status === "active" || status === "trialing";
    if(!isPro){
      throw new Error("Für diese E-Mail wurde keine aktive Pro-Lizenz gefunden.");
    }
    saveKnownEmail(email);
    applyProState(true, "paddle", {
      email: email,
      status: status,
      customerId: data.customerId || "",
      subscriptionId: data.subscriptionId || "",
      validUntil: data.expiresAt || "",
      source: data.source || "paddle",
      installationId: installationId,
      trial: status === "trial" || status === "trialing",
      restored: true
    });
    return { ok:true, status:status, active:true };
  }

  // Legacy-Path (Web / E-Mail-Restore): fragt weiterhin die Netlify-Function ab.
  async function refreshLicenseFromServer(explicitEmail){
    // Android nutzt ausschließlich den anonymen/JWT-basierten Supabase-Endpunkt.
    if(isAndroidApp() && !explicitEmail){
      return await refreshLicenseViaSupabase();
    }
    var email = (explicitEmail || getKnownEmail() || "").trim().toLowerCase();
    if(!email || email.indexOf("@") === -1){
      return await refreshLicenseViaSupabase();
    }
    try {
      var res = await fetch(LEGACY_LICENSE_CHECK_URL + "?email=" + encodeURIComponent(email), {
        method:"GET",
        headers:{ "Accept":"application/json" }
      });
      var data = await res.json().catch(function(){ return null; });
      if(!res.ok || !data){
        return { ok:false, status:"free", reason:"network" };
      }
      var status = String(data.status || "free").toLowerCase();
      var isPro  = status === "pro" || status === "trial";
      saveKnownEmail(email);
      applyProState(isPro, "paddle", {
        email: email,
        status: status,
        customerId: data.customerId || "",
        subscriptionId: data.subscriptionId || "",
        validUntil: data.validUntil || "",
        trial: status === "trial"
      });
      return { ok:true, status:status, active:isPro };
    } catch(e){
      return { ok:false, status:"free", reason:"exception", message:e && e.message };
    }
  }

  // Fragt bei Bedarf nach einer E-Mail-Adresse für den Paddle-Beleg.
  // Rückgabe leerer String, wenn der Nutzer abbricht (Kauf wird abgebrochen).
  async function ensureCheckoutEmail(){
    var known = (getKnownEmail() || "").trim();
    if(known && known.indexOf("@") > 0) return known;
    var input = "";
    try {
      input = window.prompt(
        "Bitte gib deine E-Mail-Adresse für den Paddle-Kaufbeleg ein.\n\n" +
        "Diese Adresse wird ausschließlich für die Zahlungsabwicklung verwendet – " +
        "ein Cavalyra-Cloud-Konto ist nicht erforderlich.",
        ""
      ) || "";
    } catch(_){}
    input = input.trim().toLowerCase();
    if(!input || input.indexOf("@") === -1) return "";
    saveKnownEmail(input);
    return input;
  }

  // -------------------- Android Paddle-Checkout (Supabase + Capacitor Browser) --------------------
  // Läuft OHNE Cavalyra-Cloud-Konto. Ablauf:
  //   1. Anonyme installation_id + E-Mail an `create-paddle-checkout` senden.
  //   2. Rückgabe `checkoutUrl` in Capacitor Browser öffnen.
  //   3. Rückkehr via Deep-Link `cavalyra://return` (siehe attachAndroidResumeHook).
  //   4. Anschließend `check-license?installation_id=...` mehrfach abfragen.
  async function openPaddleCheckout(){
    if(!isAndroidApp()){
      throw new Error("Paddle-Checkout ist nur in der Android-App verfügbar.");
    }
    var installationId = getInstallationId();
    var email = await ensureCheckoutEmail();
    if(!email){
      throw new Error("Für den Kauf wird eine E-Mail-Adresse für den Paddle-Beleg benötigt.");
    }
    // JWT ist optional – nur mitschicken, falls Cloud-Konto aktiv ist.
    var jwt = null;
    try { jwt = await ensureFreshSupabaseToken(); } catch(_){}
    debug("android:create-checkout:start", { hasEmail:!!email, hasJwt:!!jwt, installationId:installationId });

    var res;
    try {
      res = await fetch(CREATE_CHECKOUT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + (jwt || SUPABASE_ANON_KEY)
        },
        body: JSON.stringify({
          installation_id: installationId,
          email: email
        })
      });
    } catch(e){
      throw new Error("Checkout konnte nicht gestartet werden (Netzwerkfehler). Bitte prüfe deine Verbindung.");
    }
    var data = await res.json().catch(function(){ return null; });
    if(!res.ok || !data || !data.checkoutUrl){
      debug("android:create-checkout:error", { status:res.status, data:data });
      var msg = (data && (data.error || data.message)) || ("HTTP " + res.status);
      throw new Error("Checkout konnte nicht gestartet werden: " + msg);
    }
    var checkoutUrl = data.checkoutUrl;
    debug("android:create-checkout:ok", { transactionId: data.transactionId || null });

    var Browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if(!Browser || typeof Browser.open !== "function"){
      throw new Error("Capacitor Browser Plugin ist nicht verfügbar.");
    }
    try {
      await Browser.open({ url: checkoutUrl, presentationStyle: "fullscreen" });
    } catch(e){
      throw new Error("Checkout konnte nicht geöffnet werden: " + (e && e.message ? e.message : "Unbekannter Fehler"));
    }

    // Lizenzstatus nach der Rückkehr mehrfach prüfen (der Paddle-Webhook
    // schreibt asynchron in die `licenses`-Tabelle).
    refreshLicenseViaSupabase().catch(function(){});
    [2000, 5000, 10000, 20000].forEach(function(ms){
      setTimeout(function(){ refreshLicenseViaSupabase().catch(function(){}); }, ms);
    });
    try { if(window.toast) window.toast("Nach Abschluss des Kaufs bitte zur App zurückkehren."); } catch(_){}
  }




  // Auto-Refresh nach Rückkehr in die App (Paddle-Kauf beendet)
  function attachAndroidResumeHook(){
    if(!isAndroidApp()) return;
    function refreshAll(){
      refreshLicenseViaSupabase().catch(function(){});
      try { if(typeof window.refreshLicenseSilently === "function") window.refreshLicenseSilently(); } catch(_){}
    }
    try {
      var App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if(App && App.addListener){
        App.addListener("appStateChange", function(state){
          if(state && state.isActive) refreshAll();
        });
        App.addListener("resume", refreshAll);
        // Deep Link Rückkehr aus Paddle (cavalyra://return oder https://cavalyra.de/return)
        App.addListener("appUrlOpen", function(data){
          try {
            var url = (data && data.url) || "";
            // Browser-View des Paddle-Checkouts schließen, falls noch offen
            try { window.Capacitor.Plugins.Browser && window.Capacitor.Plugins.Browser.close && window.Capacitor.Plugins.Browser.close(); } catch(_){}
            // Nach Rückkehr sofort mehrfach prüfen, bis der Webhook den Status gesetzt hat
            refreshAll();
            [1500, 4000, 8000, 15000].forEach(function(ms){ setTimeout(refreshAll, ms); });
          } catch(_){}
        });
      }
    } catch(_){}
    // Zusätzlich beim ersten Start
    setTimeout(refreshAll, 2000);
  }

  // -------------------- Public API --------------------
  async function checkProStatus(){
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
      var owned = isIosProductOwned();
      debug("checkProStatus:return", { platform:"ios", result:owned });
      return owned;
    }
    if(isAndroidApp()){
      var r = await refreshLicenseFromServer();
      return !!r.active;
    }
    return !!(window.state && window.state.license && window.state.license.pro);
  }

  async function startProPurchase(){
    debug("button:kostenlos-testen-pressed", { platform:getPlatform(), before:licenseSnapshot() });
    if(isAndroidApp()){
      await openPaddleCheckout();
      return true;
    }
    if(!isIosApp()){
      throw new Error("In-App-Käufe sind nur in der mobilen App verfügbar.");
    }
    // Bereits Pro? Dann keinen zweiten Kaufdialog öffnen.
    try {
      if(isIosProductOwned()){
        applyProState(true, "app_store", { productId: PRODUCT_ID_IOS, entitlementConfirmed:true, reason:"already_owned_before_purchase" });
        return true;
      }
    } catch(_){}
    // iOS StoreKit-Kauf
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
      debug("storekit:purchase-started", { productId:PRODUCT_ID_IOS, offer:offer });
      var order = offer.order ? offer.order() : getStore().order(offer);
      await order;
      debug("storekit:purchase-order-returned", { productId:PRODUCT_ID_IOS, entitlement:isIosProductOwned() });
      var tries = 0;
      while(tries < 25 && !isIosProductOwned()){
        await new Promise(function(r){ setTimeout(r, 400); });
        tries++;
      }
      syncIosStore();
      var ok = isIosProductOwned();
      debug(ok ? "storekit:purchase-success" : "storekit:purchase-not-completed-yet", { productId:PRODUCT_ID_IOS, tries:tries, entitlement:ok });
      return ok;
    } catch(e){
      debug("storekit:purchase-failed-or-cancelled", { message:e && e.message ? e.message : String(e) });
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

  function pickRecurringPrice(product){
    // StoreKit/CdvPurchase v13: Preise stehen in offers[].pricingPhases[].
    // Bei Angeboten mit Intro/Trial gilt:
    //   Phase 0 = z.B. 0,00 (Trial) oder Intro-Preis
    //   letzte Phase = tatsächlicher wiederkehrender Basispreis
    // Wir wählen deshalb die LETZTE Phase mit priceMicros > 0 (=
    // Basisabo-Preis, der nach dem Trial dauerhaft berechnet wird).
    if(!product) return { price:"", loading:true };
    var offers = (product.offers && product.offers.length) ? product.offers : [];
    if(!offers.length && product.pricing && product.pricing.price){
      return { price: product.pricing.price, loading:false };
    }
    var basePrice = "";
    var baseMicros = -1;
    var anyPrice = "";
    for(var i=0;i<offers.length;i++){
      var phases = (offers[i] && offers[i].pricingPhases) || [];
      // von hinten nach vorne: erste Phase mit micros>0 ist der Basispreis
      for(var j=phases.length-1;j>=0;j--){
        var ph = phases[j];
        var micros = ph.priceMicros != null ? ph.priceMicros : ph.price_amount_micros;
        var priceStr = ph.price || ph.formattedPrice || "";
        if(priceStr && !anyPrice) anyPrice = priceStr;
        if(micros != null && Number(micros) > 0 && priceStr){
          if(Number(micros) > baseMicros){
            baseMicros = Number(micros);
            basePrice = priceStr;
          }
          break;
        }
      }
    }
    if(basePrice) return { price: basePrice, loading:false };
    if(anyPrice) return { price: anyPrice, loading:false };
    return { price:"", loading:true };
  }

  function getProductInfo(){
    if(isIosApp()){
      var p = getIosProduct();
      if(!p) return { id: PRODUCT_ID_IOS, title:"Cavalyra Pro", description:"", priceString:"", loading:true, owned:false };
      var pr = pickRecurringPrice(p);
      return {
        id: p.id,
        title: p.title || "Cavalyra Pro",
        description: p.description || "",
        priceString: pr.price,
        loading: pr.loading,
        owned: !!p.owned
      };
    }
    // Android: Paddle-Preis statisch (Server ist Source of Truth)
    return { id:"paddle-pro-monthly", title:"Cavalyra Pro", description:"", priceString:"6,99 € / Monat", loading:false, owned:false };
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
    refreshLicenseViaSupabase: refreshLicenseViaSupabase,
    restoreLicenseByEmail: restoreLicenseByEmail,
    saveKnownEmail: saveKnownEmail,
    getProductInfo: getProductInfo
    ,hasActiveIosEntitlement: hasValidatedIosEntitlement
    ,getDebugLog: function(){ try { return JSON.parse(localStorage.getItem(BILLING_DEBUG_KEY) || "[]") || []; } catch(_){ return []; } }
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
      var ok = await window.CavalyraBilling.startProPurchase();
      if(isAndroid()){
        if(window.toast) window.toast("Nach Abschluss des Kaufs bitte zur App zurückkehren.");
      } else {
        if(window.toast) window.toast(ok ? "Kauf bestätigt – Pro ist freigeschaltet." : "Kauf gestartet – Pro wird erst nach App-Store-Bestätigung freigeschaltet.");
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
        // E-Mail-Restore via Supabase check-license (email + installation_id).
        // Server prüft aktive Pro-Lizenz und hängt die neue installation_id an.
        var known = "";
        try { known = localStorage.getItem("cavalyra:license:email") || ""; } catch(_){}
        var email = window.prompt("E-Mail-Adresse deines Paddle-Kaufs:", known || "");
        if(!email){ if(btn){ btn.disabled=false; btn.textContent="Käufe wiederherstellen"; } return false; }
        await window.CavalyraBilling.restoreLicenseByEmail(email);
        if(window.toast) window.toast("Pro-Abo gefunden und freigeschaltet.");
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

  var _proRerenderScheduled = false;
  function schedulePriceRerender(){
    if(_proRerenderScheduled) return;
    _proRerenderScheduled = true;
    var attempts = 0;
    var iv = setInterval(function(){
      attempts++;
      var info = window.CavalyraBilling.getProductInfo && window.CavalyraBilling.getProductInfo();
      var visible = document.getElementById("screen-pro") && document.getElementById("screen-pro").offsetParent !== null;
      if(info && !info.loading && info.priceString){
        clearInterval(iv); _proRerenderScheduled = false;
        if(visible) renderProNative();
      } else if(attempts > 60){
        clearInterval(iv); _proRerenderScheduled = false;
      }
    }, 500);
  }

  function renderProNative(){
    var statusLabel = (typeof window.licenseStatusLabel === "function") ? window.licenseStatusLabel() : "";
    var statusClass = (typeof window.licenseStatusClass === "function") ? window.licenseStatusClass() : "";
    var statusText  = (typeof window.licenseStatusText  === "function") ? window.licenseStatusText()  : "";
    var info = (window.CavalyraBilling.getProductInfo && window.CavalyraBilling.getProductInfo()) || null;
    var priceReady = !!(info && info.priceString && !info.loading);
    // Auf iOS niemals einen erfundenen Fallback-Preis anzeigen, wenn StoreKit
    // den echten Produktpreis noch nicht geliefert hat – sonst wird u.U. der
    // 0,00-Trial-Preis mit einem falschen Wert überschrieben oder umgekehrt.
    var priceText = priceReady
      ? info.priceString
      : (isIos() ? "wird geladen …" : "6,99 € / Monat");
    if(!priceReady && isIos()) schedulePriceRerender();
    var storeName = isIos() ? "App Store" : "Paddle";
    var manageHint = isIos()
      ? "Dein Pro-Abo wird über den App Store abgerechnet und kann jederzeit unter Einstellungen → Apple-ID → Abos gekündigt werden."
      : "Dein Pro-Abo wird sicher über Paddle abgerechnet und kann jederzeit über das Paddle-Kundenportal verwaltet oder gekündigt werden.";
    var priceLine = priceReady
      ? '<p class="small"><strong>Kostenlos testen</strong> – danach ' + esc(priceText) + '. Verlängert sich automatisch, jederzeit über ' + esc(storeName) + ' kündbar.</p>'
      : '<p class="small"><strong>Kostenlos testen</strong> – Preis wird vom ' + esc(storeName) + ' geladen …</p>';

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
