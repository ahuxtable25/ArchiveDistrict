/* /api/push.js — Vercel serverless function
   Uses web-push npm package for reliable Web Push encryption
   Stores subscriptions in Supabase app_state.goals.pushSubs
*/

const webpush = require("web-push");
const { createClient } = require("@supabase/supabase-js");

const VAPID_PUBLIC_KEY  = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT     = "mailto:archivedistrict@gmail.com";
const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY      = process.env.VITE_SUPABASE_ANON_KEY;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET" && req.query?.action === "subs") {
    const { data } = await supabase.from("app_state").select("goals").eq("id",1).single();
    return res.status(200).json({ subscriptions: data?.goals?.pushSubs || [] });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, subscription, payload } = req.body || {};

  if (action === "subscribe" && subscription) {
    const { data } = await supabase.from("app_state").select("goals").eq("id",1).single();
    const existing = data?.goals?.pushSubs || [];
    const deduped  = [...existing.filter(s => s.endpoint !== subscription.endpoint), subscription];
    await supabase.from("app_state").update({ goals: { ...(data?.goals||{}), pushSubs: deduped } }).eq("id",1);
    return res.status(200).json({ ok: true, total: deduped.length });
  }

  if (action === "send" && payload) {
    const { data } = await supabase.from("app_state").select("goals").eq("id",1).single();
    const subs = data?.goals?.pushSubs || [];
    if (!subs.length) return res.status(200).json({ sent:0, message:"No subscriptions" });

    const results = await Promise.allSettled(
      subs.map(sub => webpush.sendNotification(sub, JSON.stringify(payload)).catch(err => {
        if (err.statusCode === 410) return { expired: true, endpoint: sub.endpoint };
        throw err;
      }))
    );

    const expired = results
      .filter(r => r.status==="fulfilled" && r.value?.expired)
      .map(r => r.value.endpoint);
    if (expired.length) {
      await supabase.from("app_state").update({
        goals: { ...(data?.goals||{}), pushSubs: subs.filter(s => !expired.includes(s.endpoint)) }
      }).eq("id",1);
    }

    const sent = results.filter(r => r.status==="fulfilled" && !r.value?.expired).length;
    const failed = results.filter(r => r.status==="rejected").length;
    return res.status(200).json({ sent, failed, expired: expired.length });
  }

  return res.status(400).json({ error: "Unknown action" });
};
