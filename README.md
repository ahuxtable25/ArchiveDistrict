# ArchiveDistrict — Business OS

Real-time resale management app. React + Vite + Supabase, deployed on Vercel.
Syncs instantly across all devices. Multiple users at the same time.

---

## Deploy in 3 steps

### Step 1 — Supabase (free database + real-time)

1. Go to supabase.com → Sign up free
2. Click New project → name it archivedistrict → region: EU West → Create project
3. Once ready, go to SQL Editor in the left sidebar
4. Paste the entire contents of supabase_schema.sql and click Run
5. Go to Project Settings → API and copy:
   - Project URL (https://xxxx.supabase.co)
   - anon public key (starts with eyJ...)

### Step 2 — Vercel environment variables

Add all three in Vercel → Project Settings → Environment Variables:

  VITE_SUPABASE_URL        = your Supabase Project URL
  VITE_SUPABASE_ANON_KEY   = your Supabase anon public key
  ANTHROPIC_API_KEY        = your Anthropic key (for Listing Drafter AI)

Redeploy after adding variables.

### Step 3 — Import your data

1. Open the live app URL
2. Click Import in the topbar
3. Select archivedistrict_import.json
4. Data saves to Supabase — all devices sync automatically

---

## How sync works

Every change saves to Supabase within 1 second.
All connected devices receive the update instantly via Supabase Realtime.
No refresh needed.
