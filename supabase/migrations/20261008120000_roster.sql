-- A full roster (scripts/gen-crew.ts): a short description of each volunteer for the picker to read, and the certificates
-- the other teams need. The description sits with the contact details, crew-only: festival-goers can read the profile of
-- whoever is helping them, but not this.
alter table profile_private add column bio text;

insert into skills (slug, name, requires_expiry) values
  ('mental-health-first-aid', 'Mental Health First Aid', true),
  ('security-licence',        'Security licence (crowd controller)', true),
  ('food-safety',             'Food Safety Supervisor', true)
on conflict (slug) do nothing;
