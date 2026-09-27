-- Space Arenas online - Phase 4: community mod repository.
-- Follows 003_backups.sql. Idempotent; safe to run via the Supabase SQL editor as well.
--
-- Reads are public (the repo is meant to be browsed by anyone); writes happen only
-- through the online server after validation/sanitization, so they are service-role only.

create table if not exists public.mods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- Denormalized meta fields for the (payload-free) repo list. Populated server-side
  -- from the sanitized ModFile on upload, so list queries stay light and filterable.
  meta_author text not null default '',
  meta_description text not null default '',
  meta_version text not null default '',
  size_bytes integer not null default 0,
  require_protocol integer not null default 0,
  payload jsonb not null,
  downloads integer not null default 0,
  created_at timestamptz not null default now()
);

-- Backstop for the collision check the server does explicitly (PostgREST upserts on the pk,
-- so the server pre-checks lower(name) and returns 409; this index guarantees uniqueness).
create unique index if not exists mods_name_ci_idx on public.mods (lower(name));
create index if not exists mods_created_at_idx on public.mods (created_at desc);
create index if not exists mods_downloads_idx on public.mods (downloads desc);
create index if not exists mods_owner_id_idx on public.mods (owner_id);

create table if not exists public.mod_ratings (
  mod_id uuid not null references public.mods (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (mod_id, user_id)
);

create index if not exists mod_ratings_mod_id_idx on public.mod_ratings (mod_id);

create table if not exists public.mod_comments (
  id uuid primary key default gen_random_uuid(),
  mod_id uuid not null references public.mods (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists mod_comments_mod_id_idx on public.mod_comments (mod_id);

-- Public reads (anon + authenticated) for the repo, ratings and comments.
alter table public.mods enable row level security;
alter table public.mod_ratings enable row level security;
alter table public.mod_comments enable row level security;

create policy "mods readable by all"
  on public.mods for select using (true);
create policy "mods written by service role"
  on public.mods for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "mod_ratings readable by all"
  on public.mod_ratings for select using (true);
create policy "mod_ratings written by service role"
  on public.mod_ratings for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "mod_comments readable by all"
  on public.mod_comments for select using (true);
create policy "mod_comments written by service role"
  on public.mod_comments for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');