-- The language someone at a report needs a volunteer to speak (src/server/models/intake-tools.ts): the report's own
-- language when it isn't English, or one it names ("his wife only speaks Mandarin"). The picker keeps a place for a
-- speaker of it (src/server/pick.ts). detected_language stays what the report was written in.
alter table reports add column if not exists speaker_needed text;
