-- One name per zone: the site plan's labels (src/data/venue.ts), which the map and the zone picker show, so a task
-- card never says "Water Station 2" under a pin that says "Water 2". scripts/seed.ts keeps them in step from now on.
update zones set name = v.name
from (values
  ('gate-a', 'Gate A'),
  ('gate-b', 'Gate B'),
  ('water-1', 'Water 1'),
  ('water-2', 'Water 2'),
  ('first-aid-hq', 'First Aid'),
  ('info-tent', 'Info'),
  ('pavilion', 'Pavilion')
) as v(slug, name)
where zones.slug = v.slug;

-- The bar by the tennis courts becomes a zone, so "fight by the bar" lands on the map and re-triage can match on it.
insert into zones (slug, name, kind, is_open_air, capacity) values ('bar', 'Bar', 'food', true, 600)
on conflict (slug) do nothing;
