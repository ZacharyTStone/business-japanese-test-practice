"""Phase 2: document -> HTML/SVG rendering.

When we reach 資料聴読解 / 総合聴読解, the model emits structured JSON (rows,
labels, values, correct region index) and *we* render it here — we never call an
image model, which mangles kanji. Not built in phase 1.
"""
