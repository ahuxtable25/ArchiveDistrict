-- ArchiveDistrict — Supabase Schema (updated)
-- Safe to re-run. Paste entire file into Supabase SQL Editor → Run

-- 1. Create table if not exists
create table if not exists app_state (
  id          integer primary key default 1,
  listings    jsonb   not null default '[]'::jsonb,
  stock_data  jsonb   not null default '[]'::jsonb,
  goals       jsonb   not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 2. Enforce single-row
create unique index if not exists app_state_singleton on app_state (id);

-- 3. Insert the one row if it doesn't exist
insert into app_state (id, listings, stock_data, goals)
values (1, '[]', '[]', '{}')
on conflict (id) do nothing;

-- 4. Row Level Security
alter table app_state enable row level security;

drop policy if exists "Allow all operations" on app_state;
create policy "Allow all operations"
  on app_state for all
  to anon, authenticated
  using (true)
  with check (true);

-- 5. Explicit grants so the anon key can read and write
grant select, insert, update on app_state to anon;
grant select, insert, update on app_state to authenticated;

-- 6. Enable Realtime
alter publication supabase_realtime add table app_state;
