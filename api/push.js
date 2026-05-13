/* /api/push.js — Vercel serverless function (CommonJS) */
const webpush = require("web-push");
const { createClient } = require("@supabase/supabase-js");

const VAPID_PUBLIC_KEY  = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY      = process.env.VITE_SUPABASE_ANON_KEY;

webpush.setVapidDetails(
  "mailto:archivedistrict@gmail.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getState() {
  const { data } = await supabase.from("app_state").select("goals").eq("id",1).single();
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  /* GET ?action=subs — list stored subscriptions */
  if (req.method === "GET") {
    const data = await getState();
    const subs = data?.goals?.pushSubs || [];
    return res.status(200).json({ count: subs.length, subs: subs.map(s=>s.endpoint) });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, subscription, payload } = req.body || {};

  /* Save subscription */
  if (action === "subscribe" && subscription) {
    const data = await getState();
    const existing = data?.goals?.pushSubs || [];
    const deduped  = [
      ...existing.filter(s => s.endpoint !== subscription.endpoint),
      subscription,
    ];
    const { error } = await supabase.from("app_state")
      .update({ goals: { ...(data?.goals || {}), pushSubs: deduped } })
      .eq("id", 1);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, total: deduped.length });
  }

  /* Send push to all subscriptions */
  if (action === "send" && payload) {
    const data = await getState();
    const subs = data?.goals?.pushSubs || [];
    if (!subs.length) return res.status(200).json({ sent: 0, info: "No subscriptions stored" });

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(sub, JSON.stringify(payload))
          .catch(err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              return { expired: true, endpoint: sub.endpoint };
            }
            throw err;
          })
      )
    );

    const expired = results
      .filter(r => r.status === "fulfilled" && r.value?.expired)
      .map(r => r.value.endpoint);

    if (expired.length) {
      const cleaned = subs.filter(s => !expired.includes(s.endpoint));
      await supabase.from("app_state")
        .update({ goals: { ...(data?.goals || {}), pushSubs: cleaned } })
        .eq("id", 1);
    }

    const sent   = results.filter(r => r.status === "fulfilled" && !r.value?.expired).length;
    const failed = results.filter(r => r.status === "rejected").length;
    console.log(`Push: sent=${sent} failed=${failed} expired=${expired.length}`);
    return res.status(200).json({ sent, failed, expired: expired.length });
  }

  /* Test — send a test notification to all devices */
  if (action === "test") {
    const data = await getState();
    const subs = data?.goals?.pushSubs || [];
    return res.status(200).json({
      subsCount: subs.length,
      vapidOk: !!VAPID_PUBLIC_KEY && !!VAPID_PRIVATE_KEY,
      supabaseOk: !!SUPABASE_URL,
    });
  }

  return res.status(400).json({ error: "Unknown action" });
};
