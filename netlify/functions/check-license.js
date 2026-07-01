// Cavalyra: Pro-Status serverseitig bei Paddle prüfen.
// Erwartet ENV: PADDLE_API_KEY (live oder sandbox), optional PADDLE_API_BASE.
// Liefert immer JSON { ok:true, status:"pro"|"trial"|"free"|"expired"|"past_due" }.

const MONTHLY_PRICE_ID = "pri_01ksnccs23fwwm0qctdydb93xz";
const YEARLY_PRICE_ID  = "pri_01ksncrwd2eza9njhn22ah20mc";
const ALLOWED_PRICE_IDS = new Set([MONTHLY_PRICE_ID, YEARLY_PRICE_ID]);

const PADDLE_API_BASE = process.env.PADDLE_API_BASE || "https://api.paddle.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Content-Type": "application/json"
};

function json(statusCode, body){
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

async function paddleFetch(path, apiKey){
  const res = await fetch(PADDLE_API_BASE + path, {
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json"
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch(_){ data = null; }
  if(!res.ok){
    const msg = data && data.error && data.error.detail ? data.error.detail : ("Paddle API " + res.status);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function pickStatusFromSubscriptions(subs){
  // Reihenfolge: aktive Pro-Abos haben Vorrang.
  let best = "free";
  let validUntil = "";
  let subscriptionId = "";
  let customerId = "";

  const rank = s => ({ "pro": 5, "trial": 4, "past_due": 3, "expired": 2, "canceled": 1, "free": 0 }[s] ?? 0);

  for(const sub of subs){
    const items = Array.isArray(sub.items) ? sub.items : [];
    const matchesPrice = items.some(it => it && it.price && ALLOWED_PRICE_IDS.has(it.price.id));
    if(!matchesPrice) continue;

    let mapped = "free";
    switch(sub.status){
      case "active":   mapped = "pro"; break;
      case "trialing": mapped = "trial"; break;
      case "past_due": mapped = "past_due"; break;
      case "paused":   mapped = "expired"; break;
      case "canceled": {
        // Canceled, aber evtl. noch im bezahlten Zeitraum -> pro bis Ende
        const end = sub.current_billing_period && sub.current_billing_period.ends_at;
        if(end && new Date(end) > new Date()) mapped = "pro";
        else mapped = "expired";
        break;
      }
      default: mapped = "free";
    }

    if(rank(mapped) > rank(best)){
      best = mapped;
      validUntil = (sub.current_billing_period && sub.current_billing_period.ends_at) || sub.next_billed_at || "";
      subscriptionId = sub.id || "";
      customerId = sub.customer_id || "";
    }
  }

  return { status: best, validUntil, subscriptionId, customerId };
}

exports.handler = async function(event){
  if(event.httpMethod === "OPTIONS"){
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try{
    const apiKey = process.env.PADDLE_API_KEY;
    if(!apiKey){
      return json(500, { ok:false, status:"free", message:"PADDLE_API_KEY ist nicht konfiguriert." });
    }

    let email = "";
    if(event.httpMethod === "GET"){
      email = (event.queryStringParameters && event.queryStringParameters.email) || "";
    } else if(event.httpMethod === "POST"){
      try{
        const body = JSON.parse(event.body || "{}");
        email = body.email || "";
      }catch(_){}
    } else {
      return json(405, { ok:false, status:"free", message:"Methode nicht erlaubt." });
    }

    email = String(email || "").trim().toLowerCase();
    if(!email || !email.includes("@")){
      return json(400, { ok:false, status:"free", message:"Ungültige E-Mail." });
    }

    // 1) Kunden über E-Mail finden
    const customers = await paddleFetch("/customers?email=" + encodeURIComponent(email), apiKey);
    const customerList = (customers && customers.data) || [];
    if(customerList.length === 0){
      return json(200, { ok:true, status:"free" });
    }

    // 2) Subscriptions je Kunde laden
    let allSubs = [];
    for(const c of customerList){
      try{
        const subs = await paddleFetch("/subscriptions?customer_id=" + encodeURIComponent(c.id) + "&per_page=50", apiKey);
        if(subs && Array.isArray(subs.data)) allSubs = allSubs.concat(subs.data);
      }catch(e){
        // Einzelne Fehler überspringen, weitere Kunden weiter prüfen
      }
    }

    if(allSubs.length === 0){
      return json(200, { ok:true, status:"free" });
    }

    const result = pickStatusFromSubscriptions(allSubs);
    return json(200, { ok:true, ...result });
  }catch(err){
    return json(200, {
      ok:false,
      status:"free",
      message: (err && err.message) || "Unbekannter Fehler bei der Paddle-Prüfung."
    });
  }
};
