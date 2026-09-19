-- The scene job keeps a ledger of refused drafts in the `scenes` bucket
-- (`rejected/<scene>-<n>.txt`, bjt/scene_art.py Bucket.record_refusal), so a
-- fresh runner knows how many drafts a picture has already cost and gives up
-- at BJT_SCENE_LIFETIME_ATTEMPTS. The bucket accepted images only, and the
-- first night with the ledger refused every marker with 415 — so the cap
-- never took effect. Plain text is allowed alongside the pictures; the
-- bucket is public-read already and the markers are one line of reasons.
update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'text/plain')
 where id = 'scenes'
   and not ('text/plain' = any(allowed_mime_types));
