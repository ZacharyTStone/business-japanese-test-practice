-- A fourth channel: `written`.
--
-- The channel says how an utterance reaches the listener, and until now every
-- item type we had shipped was spoken, so three spoken channels covered it. The
-- reading and document types do not fit any of them: a sentence inside an email
-- is not delivered in person, and calling it `in_person` would put written
-- 定型表現 into the same weakness bucket as face-to-face 敬語, which is exactly
-- the distinction those items exist to teach.
--
-- `written` is never synthesised — bjt/tts/plan.py has no profile for it, by
-- design. It is a tag, not an audio treatment.
alter table public.items
    drop constraint if exists items_channel_check;

alter table public.items
    add constraint items_channel_check
    check (channel in ('in_person', 'phone', 'video', 'written'));

comment on column public.items.channel is
    'How the item reaches the learner. The three spoken channels drive TTS treatment; `written` marks an item whose stimulus is text and is never synthesised.';
