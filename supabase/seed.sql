-- Reference data. Volunteers/profiles come from auth.users, so seed those via script (scripts/seed-volunteers.ts, TODO).

-- Merged taxonomy: safety teams + ops teams. Mirrors TEAM_SLUGS in src/lib/schema/enums.ts.
insert into teams (slug, name, description, handles, color) values
  ('first-aid', 'First Aid & Heat',    'Medical incidents, injuries, collapses, heat stress, anything needing a trained first aider.', '{medical,heat}', '#FF3B30'),
  ('welfare',   'Welfare & Lost Kids', 'Lost or separated children, vulnerable people, harassment, someone feeling unsafe, lost property.', '{lost_child,lost_property}', '#FF9500'),
  ('crowd',     'Crowd & Gates',       'Crowding, queue management, gate flow, barrier issues, weather holds, evacuations.', '{crowding,weather}', '#AF52DE'),
  ('security',  'Security Liaison',    'Fights, theft, weapons, trespass, anything needing the security contractor.', '{security}', '#34C759'),
  ('info',      'Access & Info',       'Accessibility needs, wayfinding, program questions, audience help.', '{accessibility,info_request}', '#30B0C7'),
  ('artist',    'Artist Liaison',      'Performers, backstage, green rooms, riders, stage managers.', '{artist}', '#FF2D55'),
  ('vendors',   'Food & Vendors',      'Stallholders, food safety, gas and cooking issues, vendor logistics.', '{vendor}', '#A2845E'),
  ('ops',       'Tech & Logistics',    'Power, sound, lighting, water stations, bins, toilets, spills, anything else.', '{technical,facilities,other}', '#5856D6');

insert into skills (slug, name, requires_expiry) values
  ('first-aid-cert', 'First Aid Certificate (HLTAID011)', true),
  ('wwcc',           'Working With Children Check', true),
  ('radio-trained',  'Radio trained', false),
  ('rsa',            'Responsible Service of Alcohol', true),
  ('crowd-control',  'Crowd control cert', true),
  ('multilingual',   'Speaks a language other than English', false);

insert into zones (slug, name, kind, is_open_air, capacity) values
  ('gate-a',        'VIP Gate (Tunnel)',  'gate',      true,  3000),
  ('gate-b',        'Main Entrance',      'gate',      true,  2000),
  ('lawn-stage',    'Oval Stage',         'stage',     true,  8000),
  ('river-stage',   'Track Stage',        'stage',     true,  3000),
  ('water-1',       'Water Station 1',    'water',     true,  null),
  ('water-2',       'Water Station 2',    'water',     true,  null),
  ('first-aid-hq',  'First Aid Post',     'first_aid', false, null),
  ('food-alley',    'Food Alley',         'food',      true,  1500),
  ('info-tent',     'Info Tent',          'area',      false, null),
  ('artist-gate',   'Artist Gate',        'gate',      true,  null),
  ('artist-village','Artist Village',     'area',      true,  null),
  ('backstage',     'Oval Stage Backstage','area',     true,  null),
  ('track-backstage','Track Stage Backstage','area',    true,  null),
  ('toilets-west',  'Toilets West',       'area',      true,  null),
  ('toilets-east',  'Toilets East',       'area',      true,  null),
  ('the-grove',     'The Grove',          'area',      true,  800),
  ('pavilion',      'Pavilion (Crew HQ)', 'area',      false, null),
  ('ticket-office', 'Ticket Office',      'area',      false, null),
  ('merch-lounge',  'Merch & Lounge',     'area',      false, null),
  ('supplies',      'Supplies (Crew)',    'area',      false, null);

insert into playbooks (slug, title, trigger, steps) values
  ('heat-35c', 'Extreme heat (>=35C)', 'BoM forecast or on-site reading >= 35C',
   '[{"step":"Open all water stations, double staffing","team_slug":"ops","template":"Heat plan active. Water stations fully staffed. Rotate volunteers every 45 min."},
     {"step":"Pre-position first aiders at stages","team_slug":"first-aid","template":"Heat plan: first aiders to Oval + Track stages now."}]'),
  ('storm-warning', 'Storm warning (open-air stages)', 'Severe thunderstorm warning within 60 min',
   '[{"step":"Safety lead decides on stage hold","team_slug":"crowd","template":"Storm warning issued. Await safety lead instruction. Do not announce on your own."},
     {"step":"Prepare shelter routes","team_slug":"crowd","template":"Open shelter routes B and C."}]'),
  ('lost-child', 'Lost child', 'Any report of a separated child',
   '[{"step":"Welfare lead takes ownership","team_slug":"welfare","template":"Lost child report. Welfare lead has the lead."},
     {"step":"Gate leads watch exits","team_slug":"crowd","template":"Watch for child matching description. Do not let leave unaccompanied."}]');
