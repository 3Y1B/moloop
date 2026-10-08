-- The festival's teams, certificates and zones, which used to live in seed.sql. The crew migration after this one needs
-- them on a fresh database, where migrations run before the seed. Teams and certificates a database already has
-- stay as they are; zones take the site plan's names.

-- Merged taxonomy: safety teams + ops teams. Mirrors TEAM_SLUGS in src/lib/schema/enums.ts.
insert into teams (slug, name, description, handles, color) values
  ('first-aid', 'First Aid & Heat',    'Medical incidents, injuries, collapses, heat stress, anything needing a trained first aider.', '{medical,heat}', '#FF3B30'),
  ('welfare',   'Welfare & Lost Kids', 'Lost or separated children, vulnerable people, harassment, someone feeling unsafe, lost property.', '{lost_child,lost_property}', '#FF9500'),
  ('crowd',     'Crowd & Gates',       'Crowding, queue management, gate flow, barrier issues, weather holds, evacuations.', '{crowding,weather}', '#AF52DE'),
  ('security',  'Security Liaison',    'Fights, theft, weapons, trespass, anything needing the security contractor.', '{security}', '#34C759'),
  ('info',      'Access & Info',       'Accessibility needs, wayfinding, program questions, audience help.', '{accessibility,info_request}', '#30B0C7'),
  ('artist',    'Artist Liaison',      'Performers, backstage, green rooms, riders, stage managers.', '{artist}', '#FF2D55'),
  ('vendors',   'Food & Vendors',      'Stallholders, food safety, gas and cooking issues, vendor logistics.', '{vendor}', '#A2845E'),
  ('ops',       'Tech & Logistics',    'Power, sound, lighting, water stations, bins, toilets, spills, anything else.', '{technical,facilities,other}', '#5856D6')
on conflict (slug) do nothing;

insert into skills (slug, name, requires_expiry) values
  ('first-aid-cert', 'First Aid Certificate (HLTAID011)', true),
  ('wwcc',           'Working With Children Check', true),
  ('radio-trained',  'Radio trained', false),
  ('rsa',            'Responsible Service of Alcohol', true),
  ('crowd-control',  'Crowd control cert', true),
  ('multilingual',   'Speaks a language other than English', false)
on conflict (slug) do nothing;

-- Names are the site plan's labels (src/data/venue.ts, Birrarung Marr); 20261008190000_crew.sql places them from there.
-- Some already exist: migrations 20261008090000 and 20261008100000 add them under the old site's names, so these win.
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
