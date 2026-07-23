// Cavalyra: Paddle Webhook Endpunkt.
// Verifiziert die Paddle-Signatur (Header "paddle-signature") mit PADDLE_WEBHOOK_SECRET.
// Aktuell wird der komplette Payload geloggt, damit wir den exakten Aufbau
// der Paddle-Events analysieren können.

const crypto = require("crypto");

const HANDLED_EVENTS = new Set([
  "transaction.completed",
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
  "subscription.past_due"
]);

function parsePaddleSignature(header){
  const out = {};
  if(!header) return out;

  for(const part of String(header).split(";")){
    const [k, v] = part.split("=");
    if(k && v){
      out[k.trim()] = v.trim();
    }
  }

  return out;
}

function verifyPaddleSignature(rawBody, signatureHeader, secret){
  const parts = parsePaddleSignature(signatureHeader);

  if(!parts.ts || !parts.h1){
    return false;
  }

  const signedPayload = parts.ts + ":" + rawBody;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  try{
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(parts.h1, "hex");

    if(a.length !== b.length){
      return false;
    }

    return crypto.timingSafeEqual(a, b);

  }catch(_){
    return false;
  }
}

exports.handler = async function(event){

  if(event.httpMethod !== "POST"){
    return {
      statusCode: 405,
      body: "Method Not Allowed"
    };
  }

  const secret = process.env.PADDLE_WEBHOOK_SECRET;

  if(!secret){
    return {
      statusCode: 500,
      body: "PADDLE_WEBHOOK_SECRET nicht konfiguriert"
    };
  }

  const rawBody = event.body || "";

  const sigHeader =
    (event.headers &&
      (event.headers["paddle-signature"] ||
       event.headers["Paddle-Signature"])) || "";

  if(!verifyPaddleSignature(rawBody, sigHeader, secret)){
    return {
      statusCode: 401,
      body: "Invalid signature"
    };
  }

  let payload = null;

  try{
    payload = JSON.parse(rawBody);
  }catch(_){
    payload = null;
  }

  if(!payload || !payload.event_type){
    return {
      statusCode: 400,
      body: "Invalid payload"
    };
  }

  if(!HANDLED_EVENTS.has(payload.event_type)){
    return {
      statusCode: 200,
      body: "ignored"
    };
  }

  try{

    console.log("======================================");
    console.log("PADDLE WEBHOOK EVENT");
    console.log("======================================");
    console.log("Event:", payload.event_type);
    console.log(JSON.stringify(payload, null, 2));
    console.log("======================================");

  }catch(e){

    console.error("[paddle-webhook] processing error", e);

  }

  return {
    statusCode: 200,
    body: "ok"
  };
};
