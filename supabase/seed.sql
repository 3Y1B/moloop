-- The timetable and the old playbooks. Teams, certificates and zones are in migration 20261008185900_reference_data.sql,
-- the crew and their roster in 20261008190000_crew.sql, moved to Birrarung Marr by 20261008210000 and 20261008210100.

-- The stage timetable. Migration 20261008110300 adds the Lawn and River rows on databases that already have zones.
insert into event_timetable(stage_id, act, starts_at, ends_at, expected_people)
select z.id, e.act, e.starts_at, e.ends_at, e.expected_people
from (values
  ('lawn-stage','Opening set','2026-10-08T14:00:00+11:00'::timestamptz,'2026-10-08T15:00:00+11:00'::timestamptz,3000),
  ('river-stage','Afternoon set','2026-10-08T14:30:00+11:00'::timestamptz,'2026-10-08T15:30:00+11:00'::timestamptz,1800),
  ('grove-stage','Grove session','2026-10-08T15:00:00+11:00'::timestamptz,'2026-10-08T15:45:00+11:00'::timestamptz,400),
  ('lawn-stage','Evening headliner','2026-10-09T19:00:00+11:00'::timestamptz,'2026-10-09T20:15:00+11:00'::timestamptz,7500),
  ('river-stage','Evening support','2026-10-09T18:30:00+11:00'::timestamptz,'2026-10-09T19:30:00+11:00'::timestamptz,2600),
  ('grove-stage','Evening session','2026-10-09T18:30:00+11:00'::timestamptz,'2026-10-09T19:15:00+11:00'::timestamptz,550),
  ('lawn-stage','Closing set','2026-10-10T18:00:00+11:00'::timestamptz,'2026-10-10T19:15:00+11:00'::timestamptz,7000),
  ('river-stage','Closing support','2026-10-10T17:30:00+11:00'::timestamptz,'2026-10-10T18:30:00+11:00'::timestamptz,2500),
  ('grove-stage','Closing session','2026-10-10T17:00:00+11:00'::timestamptz,'2026-10-10T17:45:00+11:00'::timestamptz,500)
) as e(stage_slug,act,starts_at,ends_at,expected_people)
join zones z on z.slug = e.stage_slug
on conflict (stage_id, starts_at) do nothing;

insert into playbooks (slug, title, trigger, steps) values
  ('heat-35c', 'Extreme heat (>=35C)', 'BoM forecast or on-site reading >= 35C',
   '[{"step":"Open all water stations, double staffing","team_slug":"ops","template":"Heat plan active. Water stations fully staffed. Rotate volunteers every 45 min."},
     {"step":"Pre-position first aiders at stages","team_slug":"first-aid","template":"Heat plan: first aiders to all three stages now."}]'),
  ('storm-warning', 'Storm warning (open-air stages)', 'Severe thunderstorm warning within 60 min',
   '[{"step":"Safety lead decides on stage hold","team_slug":"crowd","template":"Storm warning issued. Await safety lead instruction. Do not announce on your own."},
     {"step":"Prepare shelter routes","team_slug":"crowd","template":"Open the shelter routes to ArtPlay and the Grove Stage marquee."}]'),
  ('lost-child', 'Lost child', 'Any report of a separated child',
   '[{"step":"Welfare lead takes ownership","team_slug":"welfare","template":"Lost child report. Welfare lead has the lead."},
     {"step":"Gate leads watch exits","team_slug":"crowd","template":"Watch for child matching description. Do not let leave unaccompanied."}]');
