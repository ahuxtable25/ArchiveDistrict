/* /api/push.js — zero npm dependencies, pure Node.js built-ins only */
const crypto = require("crypto");
const https  = require("https");

/* ── Config ── */
const VAPID_PUBLIC_B64  = "Ftzca15Laz8qYt1ImPPFzxEIoIGpeKd7TAXJTjkXoBouEDez897zEyw-7xDjmluO3psIbunqaUHw1ki92oOb5w";
const VAPID_PRIVATE_B64 = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY      = process.env.VITE_SUPABASE_ANON_KEY;
const VAPID_SUBJECT     = "mailto:archivedistrict@gmail.com";

/* ── Base64url helpers ── */
const b64u = b => Buffer.from(b).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
const b64uDec = s => { s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="="; return Buffer.from(s,"base64"); };

/* ── Supabase REST (no SDK) ── */
async function supaFetch(path, opts={}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`,
               "Content-Type":"application/json", "Prefer":"return=representation", ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getGoals() {
  const rows = await supaFetch("app_state?id=eq.1&select=goals");
  return rows?.[0]?.goals || {};
}
async function saveGoals(goals) {
  await supaFetch("app_state?id=eq.1", { method:"PATCH", body: JSON.stringify({ goals }) });
}

/* ── VAPID JWT ── */
function makeVapidJwt(audience) {
  const now = Math.floor(Date.now()/1000);
  const hdr = b64u(JSON.stringify({ typ:"JWT", alg:"ES256" }));
  const pld = b64u(JSON.stringify({ aud: audience, exp: now+43200, sub: VAPID_SUBJECT }));
  const sig_input = `${hdr}.${pld}`;
  const privDer = b64uDec(VAPID_PRIVATE_B64);
  // Rebuild PKCS8 from raw private key + public key
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from("308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b020101042","hex"),
      privDer,
      Buffer.from("a144034200","hex"),
      b64uDec(VAPID_PUBLIC_B64),
    ]),
    format:"der", type:"pkcs8",
  });
  const sig = crypto.sign(null, Buffer.from(sig_input), { key:privKey, dsaEncoding:"ieee-p1363" });
  return `${hdr}.${pld}.${b64u(sig)}`;
}

/* ── Web Push encryption (RFC 8291 aesgcm) ── */
function encryptPayload(sub, body) {
  const clientPub = b64uDec(sub.keys.p256dh);
  const auth      = b64uDec(sub.keys.auth);
  const ecdh      = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const localPub  = ecdh.getPublicKey();
  const shared    = ecdh.computeSecret(clientPub);

  // IKM = HKDF(auth, shared || "Content-Encoding: auth\0")
  const prk = crypto.createHmac("sha256", auth).update(shared).digest();
  const ikmInfo = Buffer.concat([Buffer.from("Content-Encoding: auth\0")]);
  const ikm = crypto.createHmac("sha256", prk).update(Buffer.concat([ikmInfo, Buffer.from([1])])).digest();

  const salt = crypto.randomBytes(16);
  const keyPrk = crypto.createHmac("sha256", salt).update(ikm).digest();

  const buildInfo = (type) => Buffer.concat([
    Buffer.from(`Content-Encoding: ${type}\0`),
    Buffer.from([0x00, clientPub.length]), clientPub,
    Buffer.from([0x00, localPub.length]),  localPub,
  ]);

  const contentKey = crypto.createHmac("sha256", keyPrk)
    .update(Buffer.concat([buildInfo("aesgcm"), Buffer.from([1])])).digest().slice(0,16);
  const iv = crypto.createHmac("sha256", keyPrk)
    .update(Buffer.concat([buildInfo("nonce"), Buffer.from([1])])).digest().slice(0,12);

  const data   = Buffer.concat([Buffer.from([0,0]), Buffer.from(body)]);
  const cipher = crypto.createCipheriv("aes-128-gcm", contentKey, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);

  return { encrypted, salt, localPub };
}

/* ── Send one push ── */
async function sendOne(sub, payloadStr) {
  const { encrypted, salt, localPub } = encryptPayload(sub, payloadStr);
  const endpoint = new URL(sub.endpoint);
  const jwt = makeVapidJwt(`${endpoint.protocol}//${endpoint.host}`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: endpoint.hostname,
      path:     endpoint.pathname + endpoint.search,
      method:   "POST",
      headers: {
        "Content-Type":     "application/octet-stream",
        "Content-Encoding": "aesgcm",
        "Content-Length":   encrypted.length,
        "Encryption":       `salt=${b64u(salt)}`,
        "Crypto-Key":       `dh=${b64u(localPub)};p256ecdsa=${VAPID_PUBLIC_B64}`,
        "Authorization":    `vapid t=${jwt},k=${VAPID_PUBLIC_B64}`,
        "TTL":              "86400",
      },
    }, res => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.write(encrypted);
    req.end();
  });
}

/* ── Handler ── */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  /* GET — debug info */
  if (req.method === "GET") {
    try {
      const goals = await getGoals();
      const subs  = goals.pushSubs || [];
      return res.status(200).json({
        subsCount: subs.length,
        vapidOk:   !!VAPID_PRIVATE_B64,
        supabaseOk:!!SUPABASE_URL,
        endpoints: subs.map(s => s.endpoint.slice(0,60) + "..."),
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, subscription, payload } = req.body || {};

  /* Save subscription */
  if (action === "subscribe" && subscription) {
    try {
      const goals   = await getGoals();
      const deduped = [...(goals.pushSubs||[]).filter(s=>s.endpoint!==subscription.endpoint), subscription];
      await saveGoals({ ...goals, pushSubs: deduped });
      return res.status(200).json({ ok: true, total: deduped.length });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  /* Send push to all */
  if (action === "send" && payload) {
    if (!VAPID_PRIVATE_B64) return res.status(500).json({ error: "VAPID_PRIVATE_KEY not set" });
    try {
      const goals = await getGoals();
      const subs  = goals.pushSubs || [];
      if (!subs.length) return res.status(200).json({ sent:0, info:"No subscriptions" });

      const payloadStr = JSON.stringify(payload);
      const results    = await Promise.allSettled(subs.map(s => sendOne(s, payloadStr)));

      const expired = [];
      results.forEach((r,i) => {
        if (r.status==="fulfilled" && (r.value.status===410||r.value.status===404)) {
          expired.push(subs[i].endpoint);
        }
      });

      if (expired.length) {
        const cleaned = subs.filter(s=>!expired.includes(s.endpoint));
        await saveGoals({ ...goals, pushSubs: cleaned });
      }

      const sent   = results.filter(r=>r.status==="fulfilled"&&![404,410].includes(r.value?.status)).length;
      const failed = results.filter(r=>r.status==="rejected").length;
      return res.status(200).json({ sent, failed, expired:expired.length });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: "Unknown action" });
};
