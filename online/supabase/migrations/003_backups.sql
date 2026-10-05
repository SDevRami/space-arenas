-- Space Arenas online - Phase 3 backups: encrypted, expiring blobs (dev-settings / profile).
-- Follows 002_match_records.sql. Idempotent; safe to run via the Supabase SQL editor as well.

create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('devsettings', 'profile')),
  payload text not null,
  passphrase_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists backups_expires_at_idx on public.backups (expires_at);
create index if not exists backups_user_id_idx on public.backups (user_id);

alter table public.backups enable row level security;

create policy "backups managed by service role"
  on public.backups for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');