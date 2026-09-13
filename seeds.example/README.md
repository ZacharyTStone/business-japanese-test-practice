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
| `seeds/genre_templates/` | phase 2 (総合読解) genre templates | not yet used |

Note that `seedtable/` (場面×関係×機能×レベル) is **not** part of this — it is our
own design, contains no licensed text, and is committed at the repo root.

## Item shape

`fewshot` examples use the same shape the model emits (see `bjt/schemas.py`):
`stem`, `options` (each `{text, role, why}`, exactly one `role: "correct"`),
`explanation_ja`, `explanation_en`, `topic`, `vocab_notes`. The 解説 in
`explanation_ja` is the important part — it teaches the model the item shape —
and the per-option `why` is what teaches it to build a trap for a *nameable*
reason rather than writing three vaguely worse answers.

`hatsugen_choukai` (発言聴解) adds four fields, because its stimulus is heard
rather than read: `scene_id`, `speaker_role`, `listener_role`, and `channel`
(`in_person` / `phone` / `video`). Its `stem` is what the **narrator** reads
aloud; the options are what the **speaker** says.

`official` items may use that same shape, **or** a lighter form:
`{"stem": "...", "options": ["...", "..."], "answer": 0, "explanation_ja": "..."}`.

## Vocab gate behaviour

The kanji ceiling for a level is enforced **only when every tier up to that
level's ceiling is loaded** (J3→N3, J2→N2, J1→N1). With partial data the gate is
permissive and says so in `bjt quality`. This keeps it strict at lower levels
(small, well-defined allowed sets) and permissive at J1 (which allows almost all
kanji anyway).
