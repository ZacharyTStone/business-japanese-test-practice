# Google Play: the listing and the Data safety form (draft)

Written from the code on 2026-10-03, for the owner to read and correct before
anything is submitted. It is not legal advice. What it says the app does is
what the code does; if the code changes what it keeps, the Data safety answers
and the privacy policy (`src/lib/privacy.ts`) change with it.

While the app is for testers only, it goes to a **closed testing** track, not
production: a production listing for an app most people cannot sign in to
would be refused.

## The listing

**App name** (30 characters at most; never "BJT", a registered trademark):

- ja-JP (default): ビジネス日本語ドリル
- en-US: Business Japanese Drill

**Short description** (80 at most):

- ja: 本番と同じ形式で、ビジネス日本語の試験対策。毎日10問、聴解・聴読解・読解。
- en: Business Japanese exam practice in the real format: ten questions a day.

**Full description** (4000 at most). The exam is named in prose only, to say
what the questions are for, with the disclaimer:

> ビジネス日本語の試験対策アプリです。BJTビジネス日本語能力テストと同じ三つの部（聴解・聴読解・読解）、九つの問題形式で、毎日10問を解きます。
>
> ・選ぶのはアプリ：レベルや問題形式を選ぶ必要はありません。解答の記録から、部ごとのレベルと次に出す問題をアプリが決めます。
> ・引っかかった「わな」をもう一度：間違えた問題は、同じ問題ではなく、同じわなを持つ別の問題で復習します。間隔は20時間・3日・1週間・3週間・2か月です。
> ・本番のペースで：読解は本番と同じ時間配分で、聴解・聴読解は音声に合わせて進みます。試験日を入れると、直前の2週間は本番と同じ配分で出題します。
> ・点数の予測はしません：作った問題には本番と同じ尺度がないので、「たぶん◯点」とは言いません。
>
> 問題はすべて独自に作ったもので、過去問は使っていません。音声はAIで作った合成音声です。広告はありません。
>
> 現在はテスト参加者だけが使えます。
>
> 本アプリは、BJTビジネス日本語能力テストの実施団体とは関係ありません。「BJT」は登録商標です。

> Practice for the business Japanese exam: ten questions a day, in the same three sections (listening, listening & reading, reading) and nine question types as the BJT Business Japanese Proficiency Test.
>
> • The app chooses: no levels or question types to pick. Your answers decide your level in each section and what comes next.
> • The trap again, in a new question: a question you missed comes back as a different question with the same trap, after 20 hours, 3 days, 1 week, 3 weeks and 2 months.
> • At the exam's pace: reading is timed as the exam times it, and listening moves with the audio. Set your exam date, and the last two weeks follow the exam's mix exactly.
> • No score prediction: the questions share no scale with the real exam, so the app never says “probably N points”.
>
> Every question is original; no past papers. The voices are AI-generated. No ads.
>
> For testers only, for now.
>
> This app is not affiliated with the organisation that runs the BJT Business Japanese Proficiency Test. “BJT” is a registered trademark.

**Elsewhere in the store listing and app content:**

| Field | Answer |
| --- | --- |
| Category | Education |
| Contact email | the owner's (the same as the privacy policy's) |
| Website | `https://<the Worker's host>` |
| Privacy policy | `https://<the Worker's host>/privacy` |
| Ads | No ads |
| App access | Restricted: sign-in with a Google account on the tester list. Give the reviewers one: a Google account added to `testers` (`bjt tester <email>`) and to the consent screen's test users, with its password, and the steps "Continue with Google → choose the account". |
| Target audience | 18 and over (adults preparing for a business exam; not for children) |
| Content rating | Education/reference; no violence, sexual content, gambling, user-to-user communication or location sharing |
| Delete account URL | `https://<the Worker's host>/privacy` (its "How long, and deleting it" section says how, in the app, on the web, or by email) |
| Screenshots | From the `preview` build on a phone: two to eight, portrait. Home, a listening question, a reading question with its clock, the verdict, the record. |
| App icon | `store/icon-512.png` (512 × 512) |
| Feature graphic | `store/feature-graphic.png` (1024 × 500, no words: Play prints the name beside it) |

## Data safety

**Overview**

| Question | Answer |
| --- | --- |
| Does the app collect or share any of the required user data types? | Yes |
| Is all of the user data collected encrypted in transit? | Yes (HTTPS only) |
| Do you provide a way for users to request that their data is deleted? | Yes: "Delete account" in the app and on the web, or by email |

**Data types.** Shared: none. The services the app runs on (Cloudflare,
Google for sign-in) act on its behalf, which Play does not count as sharing.
None is processed ephemerally only.

| Category | Type | Collected | Required or optional | Why |
| --- | --- | --- | --- | --- |
| Personal info | Email address | Yes | Required | Account management, App functionality |
| App activity | App interactions (answers: question, choice, right or wrong, time taken, replays, when) | Yes | Required | App functionality, Personalization (which questions come next) |
| App activity | Other user-generated content (notes on questions, question reports) | Yes | Optional | App functionality |

**Not collected:** name, photo, user IDs from other services, phone number,
address, location (the sign-in counts requests per IP address for a minute, in
memory, to stop abuse; nothing is stored and no location is derived), contacts,
files, photos, audio, calendar, health, financial info, web browsing, search
history, installed apps, crash logs, diagnostics, device or advertising IDs.
