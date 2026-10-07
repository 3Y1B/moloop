-- Moloop migration 4: voice in and out (docs/PLAN-LIVE.md, phase 4).
--
-- In: every hold of the pill is recorded, sent to the server, transcribed by Spark and kept in the `voice` bucket at
-- <caller id>/<clip id>.<ext>. A report or request made from speech lists its clips (one per hold: "hold to add more"
-- makes two). reports.media_url stays for photos.
--
-- Out: a spoken message ("New task: ...") is rendered by Spark TTS after it's written, and kept in the `speech`
-- bucket at <recipient id>/<message id>.mp3. The delivery row points at it, so the phone hears about it over realtime.

alter table reports add column voice_clips text[] not null default '{}';
alter table guest_requests add column voice_clips text[] not null default '{}';

alter table message_deliveries add column audio_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('voice', 'voice', false, 10485760, null),
  ('speech', 'speech', false, 5242880, array['audio/mpeg'])
on conflict (id) do nothing;

-- Clips are written and read by the server only (service role). A recipient reads their own spoken messages.
create policy "read own speech" on storage.objects for select to authenticated using (
  bucket_id = 'speech' and (storage.foldername(name))[1] = (select auth.uid())::text
);
