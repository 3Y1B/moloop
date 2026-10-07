-- Someone at a report may need hands-on first aid (src/server/models/intake-tools.ts): hurt, collapsed, very drunk,
-- spiked, chest pain, bleeding, heat. The picker keeps a place for a first aider (src/server/pick.ts). Null when no
-- model said, or on reports from before: the picker goes by the category.
alter table reports add column if not exists first_aid_needed boolean;
