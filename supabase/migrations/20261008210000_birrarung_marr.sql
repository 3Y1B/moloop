-- The festival moves to Birrarung Marr, the terraced park on the Yarra next to Fed Square (src/data/venue.ts).
-- 20261008185900_reference_data.sql and 20261008190000_crew.sql put up the old site; a database that has already run
-- them takes the new one from here: zone names, Water 3, the Grove Stage, the Kids Playground and the Market, the
-- Grove Stage's sets and the playbooks' wording. 20261008210100_birrarung_marr_crew.sql places the zones and the crew.

-- Names are the site plan's labels. Zones a database already has take the new names.
insert into zones (slug, name, kind, is_open_air, capacity) values
  ('gate-a',          'North Gate',      'gate',      true,  3000),
  ('gate-b',          'Main Entrance',   'gate',      true,  2000),
  ('lawn-stage',      'Lawn Stage',      'stage',     true,  8000),
  ('river-stage',     'River Stage',     'stage',     true,  3000),
  ('water-1',         'Water 1',         'water',     true,  null),
  ('water-2',         'Water 2',         'water',     true,  null),
  ('water-3',         'Water 3',         'water',     true,  null),
  ('first-aid-hq',    'First Aid',       'first_aid', false, null),
  ('food-alley',      'Food Alley',      'food',      true,  1500),
  ('info-tent',       'Info',            'area',      false, null),
  ('artist-gate',     'Artist Gate',     'gate',      true,  null),
  ('artist-village',  'Artist Village',  'area',      true,  null),
  ('backstage',       'Backstage',       'area',      true,  null),
  ('track-backstage', 'River Backstage', 'area',      true,  null),
  ('toilets-west',    'Toilets West',    'area',      true,  null),
  ('toilets-east',    'Toilets East',    'area',      true,  null),
  ('the-grove',       'The Grove',       'area',      true,  800),
  ('grove-stage',     'Grove Stage',     'stage',     false, 600),
  ('pavilion',        'ArtPlay',         'area',      false, null),
  ('playground',      'Kids Playground', 'area',      true,  250),
  ('ticket-office',   'Ticket Office',   'area',      false, null),
  ('merch-lounge',    'Merch & Lounge',  'area',      false, null),
  ('market',          'Market',          'area',      true,  600),
  ('supplies',        'Supplies',        'area',      false, null),
  ('bar',             'Bar',             'food',      true,  600)
on conflict (slug) do update set
  name = excluded.name, kind = excluded.kind, is_open_air = excluded.is_open_air, capacity = excluded.capacity;

-- The Grove Stage's sets. 20261008110300 published the Lawn and River Stage timetable before the Grove Stage existed;
-- these match seed.sql.
insert into event_timetable(stage_id, act, starts_at, ends_at, expected_people)
select z.id, e.act, e.starts_at, e.ends_at, e.expected_people
from (values
  ('grove-stage','Grove session','2026-10-08T15:00:00+11:00'::timestamptz,'2026-10-08T15:45:00+11:00'::timestamptz,400),
  ('grove-stage','Evening session','2026-10-09T18:30:00+11:00'::timestamptz,'2026-10-09T19:15:00+11:00'::timestamptz,550),
  ('grove-stage','Closing session','2026-10-10T17:00:00+11:00'::timestamptz,'2026-10-10T17:45:00+11:00'::timestamptz,500)
) as e(stage_slug,act,starts_at,ends_at,expected_people)
join zones z on z.slug = e.stage_slug
on conflict (stage_id, starts_at) do nothing;

-- The old playbooks in seed.sql, worded for the new site.
update playbooks set steps = s.steps::jsonb
from (values
  ('heat-35c',
   '[{"step":"Open all water stations, double staffing","team_slug":"ops","template":"Heat plan active. Water stations fully staffed. Rotate volunteers every 45 min."},
     {"step":"Pre-position first aiders at stages","team_slug":"first-aid","template":"Heat plan: first aiders to all three stages now."}]'),
  ('storm-warning',
   '[{"step":"Safety lead decides on stage hold","team_slug":"crowd","template":"Storm warning issued. Await safety lead instruction. Do not announce on your own."},
     {"step":"Prepare shelter routes","team_slug":"crowd","template":"Open the shelter routes to ArtPlay and the Grove Stage marquee."}]')
) as s(slug, steps)
where playbooks.slug = s.slug;
