-- 1) Run health checks: warnings export_supabase.py found when comparing a
--    refresh against the previous one (see _health_check there).
alter table public.refresh_runs add column warnings jsonb;

-- 2) Houses layer: ~85K+ OSM single-family-style buildings, too many to
--    ship as static JSON. Written by pipeline/exports/export_houses_supabase.py,
--    read by the map a viewport at a time through houses_in_bbox().
create extension if not exists postgis with schema extensions;

create table public.houses (
  osm_id        text primary key,            -- 'way/123' | 'node/456'
  building_type text not null,               -- house | detached | semidetached_house | terrace | bungalow
  address       text,
  geom          extensions.geometry(Point, 4326) not null,
  updated_at    timestamptz not null default now()
);

create index houses_geom_idx on public.houses using gist (geom);

alter table public.houses enable row level security;
create policy "public read" on public.houses for select using (true);
grant select on public.houses to anon, authenticated;
grant all on public.houses to service_role;

create or replace function public.houses_in_bbox(
  min_lon double precision, min_lat double precision,
  max_lon double precision, max_lat double precision,
  max_rows int default 5000
)
returns table (osm_id text, building_type text, address text, lat double precision, lon double precision)
language sql stable security invoker
set search_path = public, extensions
as $$
  select h.osm_id, h.building_type, h.address, st_y(h.geom), st_x(h.geom)
  from public.houses h
  where h.geom && st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326)
  limit least(max_rows, 10000);
$$;

grant execute on function public.houses_in_bbox to anon, authenticated, service_role;
