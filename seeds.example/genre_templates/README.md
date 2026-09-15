# Genre templates

**The structure now lives in the repository, not here.** `bjt/render/templates.py`
declares the eight document templates — 社外メール, メールのやりとり, 社内通知,
議事録, 予定表, 進捗報告書, 見積書・注文書, 掲示・案内 — each with the header
fields it cannot do without and the ways it is allowed to vary. That is our own
design, contains no licensed text, and is therefore committed rather than living
in gitignored `seeds/`.

What still belongs here is the part that *is* licensed or copied: reference
examples of real Japanese business documents whose set phrases and section order
you want the generator to match. Drop them in as text or JSON and cite them in a
prompt by hand while writing a new template.

Be careful about what that means. A reference document is for calibrating our
own template's shape — 「つきましては」 belongs in the second paragraph, the
signature block carries these four fields. It is **not** source material: no
sentence from a real document, and certainly none from a past paper, is ever
copied into an item. Every item this repository ships is an original
composition, and every company, person, date and amount in one is invented.
