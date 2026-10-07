-- The site plan's newer zones (src/data/venue.ts): the Artist Village and its gate, the sports centre buildings, and a
-- backstage behind each stage. Names are the plan's labels, as in 20261008090000: Gate B is now the Main Entrance, Gate A
-- the VIP Gate, and Backstage covers everything behind the Oval Stage.
insert into zones (slug, name, kind, is_open_air, capacity) values
  ('artist-gate',     'Artist Gate',     'gate', true,  null),
  ('artist-village',  'Artist Village',  'area', true,  null),
  ('track-backstage', 'Track Backstage', 'area', true,  null),
  ('ticket-office',   'Ticket Office',   'area', false, null),
  ('merch-lounge',    'Merch & Lounge',  'area', false, null),
  ('supplies',        'Supplies',        'area', false, null)
on conflict (slug) do nothing;

update zones set name = v.name
from (values
  ('gate-a', 'VIP Gate'),
  ('gate-b', 'Main Entrance'),
  ('backstage', 'Oval Backstage')
) as v(slug, name)
where zones.slug = v.slug;
