/* /api/push.js — Vercel serverless function (CommonJS) */
const webpush = require("web-push");
const { createClient } = require("@supabase/supabase-js");

// VAPID public key is public — safe to hardcode
const VAPID_PUBLIC_KEY  = "Ftzca15Laz8qYt1ImPPFzxEIoIGpeKd7TAXJTjkXoBouEDez897zEyw-7xDjmluO3psIbunqaUHw1ki92oOb5w";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;   // only secret key needs env var
const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY      = process.env.VITE_SUPABASE_ANON_KEY;

if (!VAPID_PRIVATE_KEY) console.error("[push] VAPID_PRIVATE_KEY env var is missing!");
if (!SUPABASE_URL)      console.error("[push] VITE_SUPABASE_URL env var is missing!");

webpush.setVapidDetails(
  "mailto:archivedistrict@gmail.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY || "placeholder" // prevents crash on startup; sends will still fail if missing
);

const supabase = createClient(SUPABASE_URL || "", SUPABASE_KEY || "");

async function getGoals() {
  const { data, error } = await supabase
    .from("app_state").select("goals").eq("id", 1).single();
  if (error) console.error("[push] Supabase read error:", error.message);
  return data?.goals || {};
}

async function setGoals(goals) {
  const { error } = await supabase
    .from("app_state").update({ goals }).eq("id", 1);
  if (error) console.error("[push] Supabase write error:", error.message);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  /* GET — debug: show stored subscription count */
  if (req.method === "GET") {
    const goals = await getGoals();
    const subs  = goals.pushSubs || [];
    return res.status(200).json({
      subsCount: subs.length,
      vapidOk:   !!VAPID_PRIVATE_KEY,
      supabaseOk:!!SUPABASE_URL,
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, subscription, payload } = req.body || {};

  /* Save a subscription */
  if (action === "subscribe" && subscription) {
    const goals   = await getGoals();
    const existing = goals.pushSubs || [];
    const deduped  = [
      ...existing.filter(s => s.endpoint !== subscription.endpoint),
      subscription,
    ];
    await setGoals({ ...goals, pushSubs: deduped });
    console.log(`[push] Subscription saved. Total: ${deduped.length}`);
    return res.status(200).json({ ok: true, total: deduped.length });
  }

  /* Send push to all subscriptions */
  if (action === "send" && payload) {
    if (!VAPID_PRIVATE_KEY) {
      console.error("[push] Cannot send — VAPID_PRIVATE_KEY not set");
      return res.status(500).json({ error: "VAPID_PRIVATE_KEY not configured" });
    }

    const goals = await getGoals();
    const subs  = goals.pushSubs || [];

    if (!subs.length) {
      console.log("[push] No subscriptions to send to");
      return res.status(200).json({ sent: 0, info: "No subscriptions stored" });
    }

    console.log(`[push] Sending to ${subs.length} subscription(s)...`);
    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(sub, JSON.stringify(payload))
          .catch(err => {
            console.error(`[push] Send error ${err.statusCode}: ${err.body}`);
            if (err.statusCode === 410 || err.statusCode === 404) {
              return { expired: true, endpoint: sub.endpoint };
            }
            throw err;
          })
      )
    );

    // Clean up expired subscriptions
    const expired = results
      .filter(r => r.status === "fulfilled" && r.value?.expired)
      .map(r => r.value.endpoint);

    if (expired.length) {
      const cleaned = subs.filter(s => !expired.includes(s.endpoint));
      await setGoals({ ...goals, pushSubs: cleaned });
    }

    const sent   = results.filter(r => r.status === "fulfilled" && !r.value?.expired).length;
    const failed = results.filter(r => r.status === "rejected").length;
    console.log(`[push] Done: sent=${sent} failed=${failed} expired=${expired.length}`);
    return res.status(200).json({ sent, failed, expired: expired.length });
  }

  return res.status(400).json({ error: "Unknown action. Use action: subscribe | send" });
};
