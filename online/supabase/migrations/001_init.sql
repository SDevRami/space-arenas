-- Space Arenas online - initial schema (Phase 2 accounts / leaderboard).
-- Applied automatically by Supabase GitHub integration when pushed alongside the server.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  games int not null default 0,
  wins int not null default 0,
  high_score int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  map text not null,
  winner text,
  started_at timestamptz not null default now()
);

create table if not exists public.leaderboard (
  user_id uuid primary key references auth.users (id) on delete cascade,
  score int not null default 0,
  rank int
);

-- Row-level security: profiles readable, own-row writes; leaderboard readable.
alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.leaderboard enable row level security;

create policy "profiles are readable by all"
  on public.profiles for select using (true);

create policy "users insert their own profile"
  on public.profiles for insert with check (auth.uid() = user_id);

create policy "users update their own profile"
  on public.profiles for update using (auth.uid() = user_id);

create policy "leaderboard is readable by all"
  on public.leaderboard for select using (true);

create policy "leaderboard updated by service role"
  on public.leaderboard for all using (auth.role() = 'service_role');

create policy "matches are readable by all"
  on public.matches for select using (true);

create policy "matches written by service role"
  on public.matches for all using (auth.role() = 'service_role');