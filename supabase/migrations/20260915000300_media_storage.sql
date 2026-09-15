-- The two media buckets, and who may touch them.
--
-- The app has been calling `storage.from('audio').getPublicUrl(...)` since it
-- was written, against a bucket nothing ever created. It worked only because
-- every `audio_path` was null, so the call was never made — the bug was hidden
-- by the feature not existing yet. Creating the buckets here means the client
-- contract check can see them and the synthesis job has somewhere to upload to.
--
-- Both are public-read and have no write policy at all, which is the same shape
-- as the item library and for the same reason: media is published from a laptop
-- as the service role, so no key that can write it ever ships in the app.
--
-- Public-read is a deliberate choice, not a shortcut. These files are questions
-- and pictures, identical for every learner, and nothing about them is personal.
-- Signed URLs would buy no privacy and would cost a round trip per clip on a
-- screen whose whole design is one round trip per set.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('audio', 'audio', true, 5242880,
     array['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg']),
    ('scenes', 'scenes', true, 2097152,
     array['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml'])
on conflict (id) do update set
    public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Read policies. `public = true` already serves objects over the public URL, so
-- these exist for the API path a client would use to list or fetch via
-- storage.objects — without them an authenticated client gets a confusing empty
-- result rather than the file it can plainly download.
drop policy if exists "media is readable" on storage.objects;
create policy "media is readable"
    on storage.objects for select
    to anon, authenticated
    using (bucket_id in ('audio', 'scenes'));

-- No insert, update or delete policy, on purpose. A client that could write
-- these buckets could replace the audio of a question with anything at all.
