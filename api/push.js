/* /api/push.js — Vercel serverless function to send web push notifications */

const VAPID_PUBLIC_KEY  = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT     = "mailto:archivedistrict@gmail.com";

/* Minimal web-push implementation without npm dependency */
/* Uses Node's built-in crypto + fetch */

function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}

function base64urlEncode(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function signVapid(audience) {
  const crypto = require("crypto");
  const now    = Math.floor(Date.now() / 1000);

  const header  = base64urlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64urlEncode(JSON.stringify({
    aud: audience, exp: now + 43200, sub: VAPID_SUBJECT,
  }));

  const sigInput = `${header}.${payload}`;
  const privDer  = base64urlDecode(VAPID_PRIVATE_KEY);

  // Reconstruct private key as PKCS8
  const pkcs8Header = Buffer.from("308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420", "hex");
  const pkcs8       = Buffer.concat([pkcs8Header, privDer, Buffer.from("a144034200", "hex"), base64urlDecode(VAPID_PUBLIC_KEY)]);

  const privKey = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const sig     = crypto.sign(null, Buffer.from(sigInput), { key: privKey, dsaEncoding: "ieee-p1363" });

  return `vapid t=${header}.${payload}.${base64urlEncode(sig)},k=${VAPID_PUBLIC_KEY}`;
}

async function sendPush(subscription, payload) {
  const { endpoint, keys } = subscription;
  const { p256dh, auth }   = keys;

  const crypto = require("crypto");

  // Generate ephemeral key pair
  const ecdh  = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const localPub  = ecdh.getPublicKey();
  const remotePub = base64urlDecode(p256dh);
  const authBytes = base64urlDecode(auth);
  const sharedKey = ecdh.computeSecret(remotePub);

  // HKDF to derive encryption keys
  const prk = crypto.createHmac("sha256", authBytes).update(sharedKey).digest();
  const info = Buffer.concat([
    Buffer.from("Content-Encoding: auth\x00"),
  ]);
  const ikm = crypto.createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest();

  const salt   = crypto.randomBytes(16);
  const keyPrk = crypto.createHmac("sha256", salt).update(ikm).digest();

  const keyInfo = Buffer.concat([
    Buffer.from("Content-Encoding: aesgcm\x00"), Buffer.from([0x00, p256dh.length]),
    remotePub, Buffer.from([0x00, localPub.length]), localPub,
  ]);
  const contentKey = crypto.createHmac("sha256", keyPrk)
    .update(Buffer.concat([keyInfo, Buffer.from([1])])).digest().slice(0, 16);

  const ivInfo = Buffer.concat([
    Buffer.from("Content-Encoding: nonce\x00"), Buffer.from([0x00, p256dh.length]),
    remotePub, Buffer.from([0x00, localPub.length]), localPub,
  ]);
  const iv = crypto.createHmac("sha256", keyPrk)
    .update(Buffer.concat([ivInfo, Buffer.from([1])])).digest().slice(0, 12);

  const paddedPayload = Buffer.concat([Buffer.from([0, 0]), Buffer.from(JSON.stringify(payload))]);
  const cipher = crypto.createCipheriv("aes-128-gcm", contentKey, iv);
  const encrypted = Buffer.concat([cipher.update(paddedPayload), cipher.final(), cipher.getAuthTag()]);

  const audience   = new URL(endpoint).origin;
  const authHeader = await signVapid(audience);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type":  "application/octet-stream",
      "Content-Encoding": "aesgcm",
      "Encryption":    `salt=${base64urlEncode(salt)}`,
      "Crypto-Key":    `dh=${base64urlEncode(localPub)};${authHeader.split(",k=")[0].replace("vapid t=","keyid=").replace("vapid ","")};p256ecdsa=${VAPID_PUBLIC_KEY}`,
      "Authorization": authHeader,
      "TTL": "86400",
    },
    body: encrypted,
  });
  return res.status;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { subscriptions, payload } = req.body;
  if (!subscriptions?.length || !payload) {
    return res.status(400).json({ error: "Missing subscriptions or payload" });
  }

  const results = await Promise.allSettled(
    subscriptions.map(sub => sendPush(sub, payload))
  );

  const sent   = results.filter(r => r.status === "fulfilled").length;
  const failed = results.filter(r => r.status === "rejected").length;

  return res.status(200).json({ sent, failed });
};
