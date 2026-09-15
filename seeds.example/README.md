# seeds/ — how to populate it

The tool loads licensed / authoritative material at runtime from `seeds/`, which
is **gitignored**. Nothing copyrighted is committed. Copy this directory to
`seeds/` and replace the placeholders with real content:

    cp -r seeds.example seeds

## What goes where

| Path | What | Used by |
|---|---|---|
| `seeds/fewshot/<type>.json` | 3-5 official-style examples **including the 解説** | generators |
| `seeds/official/<type>.json` | official sample items (with the answer marked) | `discriminate`, `calibrate` |
| `seeds/vocab/business_terms.txt` | one business term per line (the 重要ビジネス用語表現集 list) | vocab gate |
| `seeds/vocab/jlpt_n5_kanji.txt` … `jlpt_n1_kanji.txt` | kanji per tier, any whitespace-separated | vocab gate |
| `seeds/levels.json` | official CAN-DO descriptors per level | generators |
| `seeds/genre_templates/` | reference examples of real business documents | hand-written templates |

Note that `seedtable/` (場面×関係×機能×レベル) is **not** part of this — it is our
own design, contains no licensed text, and is committed at the repo root.

## Item shape

`fewshot` examples use the same shape the model emits (see `bjt/schemas.py`):
`stem`, `options` (each `{text, role, why}`, exactly one `role: "correct"`),
`explanation_ja`, `explanation_en`, `topic`, `vocab_notes`. The 解説 in
`explanation_ja` is the important part — it teaches the model the item shape —
and the per-option `why` is what teaches it to build a trap for a *nameable*
reason rather than writing three vaguely worse answers.

Six of the nine types carry more than a stem, because their stimulus is not one
string. `bjt/schemas.py` is the authority; in summary:

| Type | Extra fields | What `stem` is |
|---|---|---|
| `hatsugen_choukai` | `scene_id`, `speaker_role`, `listener_role`, `channel` | what the **narrator** reads; the options are what the **speaker** says |
| `bamen_haaku` | `scene_id`, `channel` | the narrated moment, then a question about the situation |
| `sougou_choukai` | `scene_id`, `channel`, `dialogue` | the narrator's question; the exchange is in `dialogue` |
| `joukyou_haaku` | `scene_id`, `channel`, `document` | the narrated situation and spoken request |
| `shiryou_choudokkai` | `channel`, `document` | the spoken prompt |
| `sougou_choudokkai` | `channel`, `dialogue`, `documents` | the narrator's question |
| `sougou_dokkai` | `document` | the question, read rather than heard |

`dialogue` is `[{speaker_role, text}]` — roles, never personal names, because the
role is what casts the voice. `document` / `documents` follow the shape in
`bjt/render/document.py`: a template id, a title, header fields, and blocks.
`channel` is `in_person` / `phone` / `video` for anything spoken and `written`
for 総合読解, which is never synthesised.

`official` items may use that same shape, **or** a lighter form:
`{"stem": "...", "options": ["...", "..."], "answer": 0, "explanation_ja": "..."}`.
A type whose stimulus is a document or a conversation must still carry it in the
lighter form — the answerability gate withholds the stem to see whether the
options leak the answer, and a withheld stem with no document behind it is not a
cold view, it is an empty one.

## Vocab gate behaviour

The kanji ceiling for a level is enforced **only when every tier up to that
level's ceiling is loaded** (J3→N3, J2→N2, J1→N1). With partial data the gate is
permissive and says so in `bjt quality`. This keeps it strict at lower levels
(small, well-defined allowed sets) and permissive at J1 (which allows almost all
kanji anyway).
