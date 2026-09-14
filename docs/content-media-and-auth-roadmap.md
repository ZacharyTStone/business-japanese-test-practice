# Content, media, and account roadmap

> Research proposal only. This document changes no application, database, Cloudflare, or Supabase configuration.

The goal is an original, credible BJT-style practice library: strong listening and reading variation, reusable art and audio, and accounts that preserve a learner's history across devices.

## Existing foundation

The repository already has more foundation than the deployed screen currently shows:

- Its schema names nine item types and stores scene_id, image_path, audio clips, clip duration, per-user attempts, and weakness statistics.
- The content pipeline emits a de-duplicated audio manifest. A clip is keyed by voice, channel, and text, so repeated utterances should be synthesized once and reused.
- The app can play a clip when audio_path is populated and shows the transcript while it is not.
- Anonymous-first authentication and a Google identity-linking flow are present in the client. Linking should retain the same Supabase user id, attempts, and weakness history.
- The shipped bundles are listening-oriented. The taxonomy includes reading and listening-reading variants, but the product should not claim broad format coverage until those variants are populated and reviewed.

The app should keep publishing only reviewed, static content. No image, audio, or question is generated while someone is practising.

## Test-format matrix

The official BJT has listening, listening-and-reading, and reading sections. The app's nine-type taxonomy maps directly to those sections. These are original scenario blueprints, not copied test questions.

| Section | Type | Learner interaction | Original example blueprint | Required assets |
|---|---|---|---|---|
| Listening | bamen_haaku (situation grasp) | Hear a short situation; choose the setting, role, or next action | A colleague hears a delivery driver at reception and identifies what information to confirm | Narrator; optional shared reception illustration |
| Listening | hatsugen_choukai (utterance choice) | Hear a situation; choose the best spoken response | A supplier calls while the manager is away; choose the respectful reply | Narrator and four option clips; phone treatment where applicable |
| Listening | sougou_choukai (integrated listening) | Hear a short meeting or presentation; answer 2–3 related questions | Team members discuss a delayed proposal and decide who contacts the client | Multi-speaker clips; optional timeline card |
| Listening + reading | joukyou_haaku (situation grasp) | Read a visual or notice, hear a request, choose an action | Visitor badge rules plus a receptionist's question | Shared sign or office illustration; audio |
| Listening + reading | shiryou_choudokkai (document listening-reading) | Read an email, schedule, or table while hearing a related prompt | Delivery-status email plus voicemail; identify the promised arrival date | Semantic HTML document; audio |
| Listening + reading | sougou_choudokkai (integrated listening-reading) | Combine a longer exchange with related documents | Project-meeting excerpt, revised agenda, and expense table; identify the action owner | Multi-speaker clips; semantic HTML documents |
| Reading | goi_bunpou (vocabulary/grammar) | Complete one business sentence with the best word or form | Select the correct humble form in an approval request | None |
| Reading | hyougen (expression reading) | Read a situation and choose the appropriate expression | Decline a colleague's urgent request without sounding dismissive | None |
| Reading | sougou_dokkai (integrated reading) | Read an email thread, memo, report, or notice; infer intent or action | Determine the required next step after a client escalation email and internal memo | Semantic HTML document; optional shared illustration |

### Format rules

- Documents are accessible HTML data, never generated images. Text must be selectable, scalable, and testable.
- One scene illustration is reused per scene_id, never generated per question.
- All names, documents, numbers, and prompts are original. Do not transcribe or imitate proprietary test questions.
- Every format needs a fixture bundle, generation schema, validity gate, and rendered app example before it is called supported.
- First prove one format per section: hatsugen_choukai, joukyou_haaku, and sougou_dokkai.

## Reading documents: reusable templates that feel like real work

Reading and mixed-media questions should render inside realistic, reusable document templates rather than a generic paragraph card. The template supplies the visual grammar; the generated or hand-written scenario supplies only the original business content.

| Template | Visual structure | Best formats | Example use |
|---|---|---|---|
| External email | From, To, CC, subject, timestamp, greeting, signature | hyougen, shiryou_choudokkai, sougou_dokkai | A client asks whether a revised quotation can arrive before Friday |
| Email thread | Quoted replies, sender hierarchy, timestamps, action request | shiryou_choudokkai, sougou_dokkai | Identify the latest decision in a three-message approval chain |
| Internal memo / notice | Title, owner, issue date, audience, short sections | joukyou_haaku, sougou_dokkai | New visitor-access procedure and the action staff must take |
| Meeting agenda / minutes | Date, attendees, numbered agenda, decisions, action owners | sougou_choukai, sougou_choudokkai, sougou_dokkai | Hear a meeting excerpt and match it to the pending action in the minutes |
| Schedule / calendar | Date grid, time ranges, attendee/location chips, conflict state | joukyou_haaku, shiryou_choudokkai | Choose the only viable reschedule time after hearing a voicemail |
| Progress report | Heading, status summary, milestones, risks, next steps | sougou_dokkai | Infer which risk must be escalated from an internal project update |
| Quote / order form | Sender/recipient blocks, line-item table, due date, notes | shiryou_choudokkai, sougou_dokkai | Compare an oral change request with the revised quantity and delivery date |
| Office sign / form | Clear heading, icon, rules, location or deadline | bamen_haaku, joukyou_haaku | Use a meeting-room sign to decide how a visitor should be guided |

### Template contract

Each document should be a structured, accessible object with a template id, version, audience, metadata, and ordered content blocks such as paragraphs, bullet lists, tables, callouts, and quoted messages. Render that object as semantic HTML; do not create a screenshot or an image of a document.

Templates should have controlled variations so they do not become visually predictable:

- Email threads can have 2–4 messages, different reply depth, and one or more recipients.
- Schedules can show an open slot, a conflict, a provisional reservation, or a changed location.
- Tables can contain one distractor row whose values are plausible but not relevant to the question.
- Reports can use a concise summary, a milestone list, or a risk-and-action layout.

### Realism guardrails

- Use fictional companies, people, dates, phone numbers, addresses, and amounts. Never use real brands, logos, or copied documents.
- Keep the layout stable enough to feel like workplace material, while making the tested evidence explicit and readable on a phone.
- Maintain Japanese business conventions in the template: appropriate subject lines, honorifics, greetings, sign-offs, and internal/external distinction.
- Make every visual field selectable and screen-reader-accessible; tables need headers and all labels need text equivalents.
- Test at phone width, desktop width, large text, and with a Japanese screen reader before approving a template.

### First three template fixtures

1. **External email:** a customer asks to move a delivery. The learner identifies the correct respectful acknowledgement.
2. **Schedule plus voicemail:** a manager's meeting changes time; the learner finds the compatible room and attendee slot.
3. **Internal memo plus action list:** a security procedure changes; the learner identifies which employee owns the immediate action.

These fixtures should become the reference cases for the reading and mixed-media renderers before the library expands.

## Images: reviewed scene bank, not per-item art

### Recommendation

Pilot the existing scene bank first: reception desk, open office, meeting room, phone desk, elevator hall, client visit, and video meeting. Generate or commission 2–3 candidates per scene, approve one canonical image, and reuse it wherever its scene_id appears.

An image-generation API suits this offline, low-volume asset task. OpenAI's current Image API supports generation and editing, and its current guide recommends the latest GPT Image family for new integrations. Evaluate fixed prompts in a small pilot; never invoke it from the app.

### Scene-prompt contract

Each prompt should declare:

- scene_id and business setting;
- camera framing and consistent illustrative art direction;
- roles and relative positions, with no real-person likenesses;
- no readable text, logos, brand marks, charts, or UI;
- a negative list for malformed hands, extra people, and inappropriate cultural cues;
- fixed aspect ratio and output size.

Example: scene_reception_counter is a clean editorial illustration of a Japanese office reception counter, one receptionist and one arriving visitor, neutral professional clothing, clear counter and waiting area, no readable text or logos, landscape 3:2. Labels and document details are overlaid by the app, never baked into the art.

### Acceptance gate

1. Confirm the image matches its scene_id and contains no text or brands.
2. Confirm the formality, roles, and setting do not contradict the item.
3. Check readability at phone width and in high-contrast mode.
4. Store the approved file at a deterministic storage path and update only scenes.image_path.
5. Retain prompt, provider/model, reviewer, and approved revision in a content-operations record.

## Audio: offline TTS with a pronunciation review loop

### Recommendation

Keep the existing manifest contract and build an offline synthesise-clips job. It accepts only clips from a passed bundle, generates each missing clip once, applies channel processing, uploads it, and writes audio_clips.audio_path and duration_ms.

Use a provider adapter rather than hard-coding a vendor. Run a blind Japanese pronunciation pilot with the same 20 clips across two candidates:

- OpenAI gpt-4o-mini-tts: supports voice instructions and WAV output; a strong candidate for natural delivery and straightforward integration.
- Google Cloud Text-to-Speech: offers Japanese voices, SSML, and WAV/LINEAR16 output; a strong candidate where exact pauses, readings, dates, and acronyms need explicit control.

Choose with native-speaker review, not a generic naturalness score. Review names, business terms, numbers, honorifics, and contrastive emphasis. Preserve the existing fixed voice cast by relation so a learner cannot answer through speaker recognition.

### Pipeline

~~~
checked bundle
  -> de-duplicated audio manifest
  -> provider TTS request; secret remains off the client
  -> pronunciation, duration, and loudness checks
  -> phone/video channel transform
  -> reviewed upload to Supabase Storage
  -> audio_clips.audio_path and duration_ms
  -> app playback
~~~

Operational rules:

- Output WAV for review; create a web delivery derivative such as AAC/MP3 only after approval.
- Phone treatment is post-processing, never a second phone voice.
- Do not generate audio on demand. Do not expose OpenAI, Google, storage-write, or Supabase secret keys to Expo or the public Worker.
- Maintain an approved pronunciation dictionary for names, abbreviations, dates, and Japanese readings.
- Label generated speech transparently wherever product policy requires it.

## Login: make the existing account-linking flow operational

The client already starts an anonymous session and calls linkIdentity with Google. The remaining work is environment setup and end-to-end testing, not a new account model.

### Production setup checklist

1. Create/configure the Supabase project and apply repository migrations.
2. Enable anonymous sign-ins and Google as an Auth provider.
3. Enable manual identity linking in Supabase Auth; it is required for the existing explicit linking path.
4. In Google Cloud Console, register the Supabase callback URL shown in the Google provider configuration. Store the Google client secret only in Supabase.
5. In Supabase Auth URL Configuration, set the production Site URL and allow the production Cloudflare hostname/custom domain, local development URLs, and the Expo bizjadrill callback scheme.
6. Set only EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in Cloudflare build variables. Never put a Supabase secret/service-role key or provider key there.
7. Add a visible account-linked confirmation and a recoverable error state for failed OAuth redirects.

### Account acceptance tests

- Fresh browser: anonymous sign-in creates exactly one profile.
- Answer fixture items anonymously; confirm attempts and weakness metrics change.
- Link Google; confirm the Supabase user id, profile, attempts, and streak are unchanged.
- Refresh and open on another device; confirm the linked history is present.
- Sign out; confirm a new anonymous user cannot read the linked user's data.
- Test denied consent, cancelled consent, an unapproved redirect URL, and a missing build variable.
- Repeat on the deployed workers.dev hostname and eventual custom domain, not only localhost.

## Future personalization: nightly candidates, never live generation

Do not target an individual learner with an immediate model call. The current selection function already prioritizes unseen and weak content without generation. Use that first.

When the static library is mature, add a separate content-orchestrator service. Do not add it to the assets-only Cloudflare Worker.

~~~
nightly scheduler
  -> aggregate weakness clusters; no raw learner text
  -> choose under-covered seed cells
  -> create budgeted candidate batch
  -> existing validation, duplicate, and answerability gates
  -> image/audio candidates
  -> human review and publish
  -> static library serves matching learners
~~~

Constraints:

- Use thresholded aggregates: for example, phone plus subordinate-to-superior plus requests is under-covered, not a raw profile dump.
- Generate drafts only; a reviewer publishes.
- Cap each run's items, media outputs, spend, retries, and execution time.
- Audit model/provider version, prompt revision, seed cell, validation outcome, reviewer, and rejection reason.
- Start with a scheduled GitHub Action: the existing Python generation and gates are already in this repository. A later Cloudflare Cron Worker needs a separate Worker with a scheduled handler and secrets; the current Worker deliberately serves static assets only.
- Cloudflare Cron runs in UTC, so learner-time policy must be explicit.

## Delivery order

1. Content fixtures and renderer proof: one reviewed example in every section and visible format labels.
2. Audio pilot: 20 fixed clips, two providers, native-speaker scoring, approved provider, and pronunciation dictionary.
3. Scene pilot: 6–8 reusable scenes, canonical prompt, review checklist, and storage paths.
4. Google identity linking: provider/redirect configuration and acceptance tests.
5. Content operations: draft/review/publish state, provider audit fields, and reproducible media job.
6. Nightly candidate generation: only after formats, gates, and review workflow are proven.

## Research sources

- [BJT official overview and sample-question sections](https://www.kanken.or.jp/bjt/english/)
- [BJT three-part format](https://www.kanken.or.jp/bjt/english/about/feature.html)
- [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
- [Google Cloud TTS basics](https://cloud.google.com/text-to-speech/docs/basics)
- [Google Cloud TTS SSML](https://cloud.google.com/text-to-speech/docs/ssml)
- [Supabase Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase Google social login](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
