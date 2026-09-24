-- houses_in_bbox() returned a row set, which PostgREST silently caps at the
-- project's API max-rows (1000 by default) — dense viewports and Find Your
-- Match regions were missing most of their houses. Return one compact JSON
-- array of [osm_id, building_type, address, lat, lon] instead: a single
-- value isn't subject to the row cap, and it's ~3x smaller on the wire.
drop function if exists public.houses_in_bbox(double precision, double precision, double precision, double precision, int);

create function public.houses_in_bbox(
  min_lon double precision, min_lat double precision,
  max_lon double precision, max_lat double precision,
  max_rows int default 5000
)
returns json
language sql stable security invoker
set search_path = public, extensions
as $$
  select coalesce(json_agg(json_build_array(osm_id, building_type, address,
                                            round(st_y(geom)::numeric, 6), round(st_x(geom)::numeric, 6))), '[]'::json)
  from (
    select h.osm_id, h.building_type, h.address, h.geom
    from public.houses h
    where h.geom && st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    limit least(max_rows, 20000)
  ) t;
$$;

grant execute on function public.houses_in_bbox to anon, authenticated, service_role;
