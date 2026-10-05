-- Space Arenas online - Phase 5: community map repository.
-- Follows 004_mods.sql. Idempotent; safe to run via the Supabase SQL editor as well.
--
-- Read paths are public (the repo is meant to be browsed by anyone); writes happen only
-- through the online server after validation/sanitization, so they are service-role only.
-- Mirrors the mods pipeline (004) so map a client downloads is re-validated by the same
-- shared `validateMap` before any match or builder can use it.

create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- Denormalized meta fields for the (payload-free) repo list. Populated server-side
  -- from the sanitized MapData on upload, so list queries stay light and filterable.
  meta_author text not null default '',
  meta_description text not null default '',
  meta_version text not null default '',
  size_bytes integer not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  players integer not null default 0,
  require_protocol integer not null default 0,
  payload jsonb not null,
  downloads integer not null default 0,
  created_at timestamptz not null default now()
);

-- Backstop for the collision check the server does explicitly (see 004 for rationale).
create unique index if not exists maps_name_ci_idx on public.maps (lower(name));
create index if not exists maps_created_at_idx on public.maps (created_at desc);
create index if not exists maps_downloads_idx on public.maps (downloads desc);
create index if not exists maps_players_idx on public.maps (players desc);
create index if not exists maps_owner_id_idx on public.maps (owner_id);

create table if not exists public.map_ratings (
  map_id uuid not null references public.maps (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (map_id, user_id)
);

create index if not exists map_ratings_map_id_idx on public.map_ratings (map_id);

create table if not exists public.map_comments (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists map_comments_map_id_idx on public.map_comments (map_id);

-- Public reads (anon + authenticated) for the repo, ratings and comments.
alter table public.maps enable row level security;
alter table public.map_ratings enable row level security;
alter table public.map_comments enable row level security;

create policy "maps readable by all"
  on public.maps for select using (true);
create policy "maps written by service role"
  on public.maps for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "map_ratings readable by all"
  on public.map_ratings for select using (true);
create policy "map_ratings written by service role"
  on public.map_ratings for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "map_comments readable by all"
  on public.map_comments for select using (true);
create policy "map_comments written by service role"
  on public.map_comments for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');