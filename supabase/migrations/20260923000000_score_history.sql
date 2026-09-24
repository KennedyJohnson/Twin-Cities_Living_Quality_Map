-- Score history: one row per pipeline refresh, plus one snapshot row per
-- district/ZIP per refresh. Written by pipeline/exports/export_supabase.py
-- using the secret key (bypasses RLS); readable by anyone via the
-- publishable key, since every value here is already public on the map.

create table public.refresh_runs (
  id           bigint generated always as identity primary key,
  run_at       timestamptz not null default now(),
  data_generated timestamptz,          -- neighborhoods.json metadata timestamp
  acs_year     int,                    -- Census ACS vintage used
  git_sha      text,                   -- commit the pipeline ran from
  trigger      text,                   -- 'github-actions' | 'local'
  area_count   int
);

create table public.area_snapshots (
  run_id        bigint not null references public.refresh_runs(id) on delete cascade,
  area_type     text   not null check (area_type in ('district', 'zip')),
  area_id       int    not null,        -- 1-17 St. Paul, 101-111 Minneapolis, 5-digit ZIP
  city          text,                   -- 'stpaul' | 'mpls' | null for ZIPs
  area_name     text,
  population    int,

  -- Composite + five components (0-100)
  health_score    numeric,
  safety          numeric,
  opportunity     numeric,
  amenities       numeric,
  transportation  numeric,
  economic_profile numeric,             -- pipeline key: affordability

  -- Blended sub-scores (0-100)
  walkability_score numeric,
  education_score   numeric,
  commute_score     numeric,
  broadband_score   numeric,

  -- Headline Census figures, as columns for easy trend queries
  median_home_value       numeric,
  median_gross_rent       numeric,
  median_household_income numeric,
  poverty_rate            numeric,

  metrics jsonb,   -- per-metric {raw_count, rate_per_1000}
  census  jsonb,   -- full affordability/Census record

  primary key (run_id, area_type, area_id)
);

create index area_snapshots_area_idx on public.area_snapshots (area_type, area_id);

-- Latest snapshot per area, for quick lookups.
create view public.latest_area_snapshots with (security_invoker = true) as
select s.*, r.run_at
from public.area_snapshots s
join public.refresh_runs r on r.id = s.run_id
where s.run_id = (select max(id) from public.refresh_runs);

alter table public.refresh_runs   enable row level security;
alter table public.area_snapshots enable row level security;

create policy "public read" on public.refresh_runs   for select using (true);
create policy "public read" on public.area_snapshots for select using (true);

-- "Automatically expose new tables" is off, so grant explicitly.
grant select on public.refresh_runs, public.area_snapshots, public.latest_area_snapshots
  to anon, authenticated;
grant all on public.refresh_runs, public.area_snapshots, public.latest_area_snapshots
  to service_role;
