"use strict";
const crypto = require("crypto");
const https  = require("https");

const VAPID_PUB_B64  = "BHFo6yRAIcu7lZLAM649tvf8KqNsGYqb6zJbHL8I6xrHW1QbDt0PZKEn2xPbX68WAOZlCdVrx9VNf16KKTLgbp4";
const VAPID_PRIV_B64 = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL   = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY   = process.env.VITE_SUPABASE_ANON_KEY;
const SUBJECT        = "mailto:archivedistrict@gmail.com";

const b64u    = b  => Buffer.from(b).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
const b64uDec = s  => { s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="="; return Buffer.from(s,"base64"); };

/* ── Supabase REST — push_subscriptions table ── */
async function subsFetch(method, body, query) {
  const url = `${SUPABASE_URL}/rest/v1/push_subscriptions${query||""}`;
  const res = await fetch(url, {
    method,
    headers: {
      "apikey":        SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type":  "application/json",
      "Prefer":        method === "GET" ? "" : "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function getAllSubs() {
  const rows = await subsFetch("GET", null, "?select=subscription");
  return Array.isArray(rows) ? rows.map(r => r.subscription) : [];
}

async function upsertSub(subscription) {
  // Upsert by endpoint (unique constraint)
  await subsFetch("POST", { endpoint: subscription.endpoint, subscription }, 
    "?on_conflict=endpoint");
}

async function deleteSub(endpoint) {
  await subsFetch("DELETE", null, `?endpoint=eq.${encodeURIComponent(endpoint)}`);
}

/* ── VAPID JWT ── */
function makeVapidJwt(audience) {
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const pld = b64u(JSON.stringify({ aud: audience, exp: now + 43200, sub: SUBJECT }));
  const msg = `${hdr}.${pld}`;
  const pubBytes = b64uDec(VAPID_PUB_B64);
  const jwk = {
    kty:"EC", crv:"P-256",
    d: b64u(b64uDec(VAPID_PRIV_B64)),
    x: b64u(pubBytes.slice(1, 33)),
    y: b64u(pubBytes.slice(33, 65)),
  };
  const key = crypto.createPrivateKey({ key: jwk, format: "jwk" });
  const sig = crypto.sign(null, Buffer.from(msg), { key, dsaEncoding: "ieee-p1363" });
  return `${msg}.${b64u(sig)}`;
}

/* ── Encrypt payload (aesgcm) ── */
function encryptPayload(sub, bodyStr) {
  const clientPub = b64uDec(sub.keys.p256dh);
  const authBytes = b64uDec(sub.keys.auth);
  const sender    = crypto.createECDH("prime256v1");
  sender.generateKeys();
  const senderPub = sender.getPublicKey();
  const shared    = sender.computeSecret(clientPub);
  const prk       = crypto.createHmac("sha256", authBytes).update(shared).digest();
  const ikm       = crypto.createHmac("sha256", prk)
    .update(Buffer.concat([Buffer.from("Content-Encoding: auth\0"), Buffer.from([1])]))
    .digest();
  const salt   = crypto.randomBytes(16);
  const keyPrk = crypto.createHmac("sha256", salt).update(ikm).digest();
  const ctx = Buffer.concat([
    Buffer.alloc(1),
    Buffer.from([0x00, clientPub.length]), clientPub,
    Buffer.from([0x00, senderPub.length]), senderPub,
  ]);
  const ck = crypto.createHmac("sha256", keyPrk)
    .update(Buffer.concat([Buffer.from("Content-Encoding: aesgcm\0"), ctx, Buffer.from([1])]))
    .digest().slice(0, 16);
  const nonce = crypto.createHmac("sha256", keyPrk)
    .update(Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), ctx, Buffer.from([1])]))
    .digest().slice(0, 12);
  const padded  = Buffer.concat([Buffer.alloc(2), Buffer.from(bodyStr)]);
  const cipher  = crypto.createCipheriv("aes-128-gcm", ck, nonce);
  const ct      = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  return { ct, salt, senderPub };
}

/* ── Send one push ── */
function sendOne(sub, payloadObj) {
  return new Promise((resolve, reject) => {
    const { ct, salt, senderPub } = encryptPayload(sub, JSON.stringify(payloadObj));
    const ep  = new URL(sub.endpoint);
    const jwt = makeVapidJwt(`${ep.protocol}//${ep.host}`);
    const req = https.request({
      hostname: ep.hostname, port: ep.port || 443,
      path: ep.pathname + (ep.search || ""), method: "POST",
      headers: {
        "Authorization":    `vapid t=${jwt},k=${VAPID_PUB_B64}`,
        "Content-Type":     "application/octet-stream",
        "Content-Encoding": "aesgcm",
        "Content-Length":   ct.length,
        "Encryption":       `salt=${b64u(salt)}`,
        "Crypto-Key":       `dh=${b64u(senderPub)};p256ecdsa=${VAPID_PUB_B64}`,
        "TTL":              "86400",
      },
    }, res => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.write(ct);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  /* GET — debug */
  if (req.method === "GET") {
    try {
      const subs = await getAllSubs();
      return res.status(200).json({
        ok: true, subsCount: subs.length,
        vapidOk: !!VAPID_PRIV_B64, supabaseOk: !!SUPABASE_URL,
        endpoints: subs.map(s => s.endpoint.slice(0, 50) + "..."),
      });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method !== "POST") return res.status(405).end();
  const { action, subscription, payload } = req.body || {};

  /* Save subscription */
  if (action === "subscribe" && subscription) {
    try {
      await upsertSub(subscription);
      const subs = await getAllSubs();
      return res.status(200).json({ ok: true, total: subs.length });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  /* Send to all */
  if (action === "send" && payload) {
    if (!VAPID_PRIV_B64) return res.status(500).json({ error: "VAPID_PRIVATE_KEY not set" });
    try {
      const subs = await getAllSubs();
      if (!subs.length) return res.status(200).json({ sent: 0, info: "No subscriptions" });
      const results = await Promise.allSettled(subs.map(s => sendOne(s, payload)));
      // Clean expired
      const expired = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && [404, 410].includes(r.value?.status)) {
          expired.push(subs[i].endpoint);
        }
      });
      await Promise.all(expired.map(ep => deleteSub(ep).catch(() => {})));
      const sent   = results.filter((r, i) => r.status === "fulfilled" && ![404,410].includes(r.value?.status)).length;
      const failed = results.filter(r => r.status === "rejected").length;
      return res.status(200).json({ sent, failed, expired: expired.length });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(400).json({ error: "Unknown action" });
};
