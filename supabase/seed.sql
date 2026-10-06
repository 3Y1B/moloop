-- Reference data. Volunteers/profiles come from auth.users, so seed those via script (scripts/seed-volunteers.ts, TODO).

insert into teams (slug, name, description, handles, color) values
  ('first-aid',  'First Aid',     'Medical incidents, injuries, collapses, intoxication needing medical attention, anything needing a trained first aider.', '{medical}', '#E5484D'),
  ('water-heat', 'Water & Heat',  'Heat stress, dehydration, water station queues and refills, shade and cooling.', '{heat}', '#3E63DD'),
  ('welfare',    'Welfare & Lost Children', 'Lost or separated children, vulnerable people, harassment, someone feeling unsafe, lost property.', '{lost_child,lost_property}', '#F76B15'),
  ('crowd',      'Crowd & Gates', 'Crowding, queue management, gate flow, barrier issues, evacuations.', '{crowding,weather}', '#8E4EC6'),
  ('security',   'Security Liaison', 'Fights, theft, weapons, trespass, anything needing the security contractor.', '{security}', '#30A46C'),
  ('access',     'Access & Info', 'Accessibility needs, wayfinding, program questions, facilities, toilets.', '{accessibility,info_request,facilities}', '#12A594');

insert into skills (slug, name, requires_expiry) values
  ('first-aid-cert', 'First Aid Certificate (HLTAID011)', true),
  ('wwcc',           'Working With Children Check', true),
  ('radio-trained',  'Radio trained', false),
  ('rsa',            'Responsible Service of Alcohol', true),
  ('crowd-control',  'Crowd control cert', true),
  ('multilingual',   'Speaks a language other than English', false);

insert into zones (slug, name, kind, is_open_air, capacity) values
  ('gate-a',        'Gate A (Main)',      'gate',      true,  3000),
  ('gate-b',        'Gate B (Tram)',      'gate',      true,  2000),
  ('lawn-stage',    'Lawn Stage',         'stage',     true,  6000),
  ('river-stage',   'River Stage',        'stage',     true,  4000),
  ('water-1',       'Water Station 1',    'water',     true,  null),
  ('water-2',       'Water Station 2',    'water',     true,  null),
  ('first-aid-hq',  'First Aid Post',     'first_aid', false, null),
  ('food-alley',    'Food Alley',         'food',      true,  2500),
  ('info-tent',     'Info Tent',          'area',      false, null);

insert into playbooks (slug, title, trigger, steps) values
  ('heat-35c', 'Extreme heat (>=35C)', 'BoM forecast or on-site reading >= 35C',
   '[{"step":"Open all water stations, double staffing","team_slug":"water-heat","template":"Heat plan active. Water stations fully staffed. Rotate volunteers every 45 min."},
     {"step":"Pre-position first aiders at stages","team_slug":"first-aid","template":"Heat plan: first aiders to Lawn + River stages now."}]'),
  ('storm-warning', 'Storm warning (open-air stages)', 'Severe thunderstorm warning within 60 min',
   '[{"step":"Safety lead decides on stage hold","team_slug":"crowd","template":"Storm warning issued. Await safety lead instruction. Do not announce on your own."},
     {"step":"Prepare shelter routes","team_slug":"crowd","template":"Open shelter routes B and C."}]'),
  ('lost-child', 'Lost child', 'Any report of a separated child',
   '[{"step":"Welfare lead takes ownership","team_slug":"welfare","template":"Lost child report. Welfare lead has the lead."},
     {"step":"Gate leads watch exits","team_slug":"crowd","template":"Watch for child matching description. Do not let leave unaccompanied."}]');
