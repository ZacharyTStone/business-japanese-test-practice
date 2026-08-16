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

## Item shape

`fewshot` examples use the same shape the model emits (see `bjt/schemas.py`):
`stem`, `options` (each `{text, role}`, exactly one `role: "correct"`),
`explanation_ja`, `explanation_en`, `topic`, `vocab_notes`. The 解説 in
`explanation_ja` is the important part — it teaches the model the item shape.

`official` items may use that same shape, **or** a lighter form:
`{"stem": "...", "options": ["...", "..."], "answer": 0, "explanation_ja": "..."}`.

## Vocab gate behaviour

The kanji ceiling for a level is enforced **only when every tier up to that
level's ceiling is loaded** (J3→N3, J2→N2, J1→N1). With partial data the gate is
permissive and says so in `bjt quality`. This keeps it strict at lower levels
(small, well-defined allowed sets) and permissive at J1 (which allows almost all
kanji anyway).
