-- Space Arenas online - Phase 2 records: participant/score detail + username uniqueness.
-- Follows 001_init.sql. Idempotent; safe to run via the Supabase SQL editor as well.

alter table public.matches add column if not exists participants jsonb not null default '[]'::jsonb;
alter table public.matches add column if not exists score jsonb not null default '{}'::jsonb;

-- Usernames are the public handle shown on the leaderboard: enforce global uniqueness
-- case-insensitively, and give the leaderboard a fast path over high_score.
create unique index if not exists profiles_username_unique_key on public.profiles (lower(username));
create index if not exists profiles_high_score_idx on public.profiles (high_score desc);

-- The leaderboard mirrors profile scores (service-role writes, readable by all). The
-- handle lives in leaderboard.username so the ranking query never has to join profiles.
alter table public.leaderboard add column if not exists username text;