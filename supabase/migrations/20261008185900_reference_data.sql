-- The festival's teams, certificates and zones, which used to live in seed.sql. The crew migration after this one needs
-- them on a fresh database, where migrations run before the seed. Databases that already have them keep theirs.

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

-- Names are the site plan's labels (src/data/venue.ts); 20261008190000_crew.sql places them from there. Some may already
-- exist: migrations 20261008090000 (the bar) and 20261008100000 (the Artist Village, the buildings and the backstages) add them.
insert into zones (slug, name, kind, is_open_air, capacity) values
  ('gate-a',          'VIP Gate',        'gate',      true,  3000),
  ('gate-b',          'Main Entrance',   'gate',      true,  2000),
  ('lawn-stage',      'Oval Stage',      'stage',     true,  8000),
  ('river-stage',     'Track Stage',     'stage',     true,  3000),
  ('water-1',         'Water 1',         'water',     true,  null),
  ('water-2',         'Water 2',         'water',     true,  null),
  ('first-aid-hq',    'First Aid',       'first_aid', false, null),
  ('food-alley',      'Food Alley',      'food',      true,  1500),
  ('info-tent',       'Info',            'area',      false, null),
  ('artist-gate',     'Artist Gate',     'gate',      true,  null),
  ('artist-village',  'Artist Village',  'area',      true,  null),
  ('backstage',       'Oval Backstage',  'area',      true,  null),
  ('track-backstage', 'Track Backstage', 'area',      true,  null),
  ('toilets-west',    'Toilets West',    'area',      true,  null),
  ('toilets-east',    'Toilets East',    'area',      true,  null),
  ('the-grove',       'The Grove',       'area',      true,  800),
  ('pavilion',        'Pavilion',        'area',      false, null),
  ('ticket-office',   'Ticket Office',   'area',      false, null),
  ('merch-lounge',    'Merch & Lounge',  'area',      false, null),
  ('supplies',        'Supplies',        'area',      false, null),
  ('bar',             'Bar',             'food',      true,  600)
on conflict (slug) do nothing;
