"""The chart block: figures drawn as a bar or a line graph, from numbers.

資料聴読解 on the real paper often puts a graph in front of the candidate and
asks about it together with what is heard — which month fell, which branch
overtook which, whether a figure cleared its target once the speaker has said
what to leave out. Reading a trend off bars is a different skill from finding a
cell in a table, and a document with only tables cannot ask for it.

A chart is data like every other block, never a picture. An image model cannot
put 4月 under the right bar any more reliably than it can spell 御中, and a
picture could be neither read aloud nor checked. The model emits categories and
numbers; we draw them — ``html.py`` for a page, ``client/src/ui/chart.tsx`` (with
the geometry in ``plot.ts``) for the app — and we write them out as text
(``text``) for every reader that is a model: the answerability gate's two
views, the proofreader, the difficulty probe and the discriminator all see each
figure beside its label, because ``document.text_of`` is what they read.

Two kinds, bar and line. A bar compares a few groups; a line follows one
quantity through time. A pie is left out on purpose: it is read by angle, which
nobody can do to the precision a question needs.

**The bounds are legibility on a phone,** where a document gets about three
hundred points of width. Eight groups of up to three bars still fit, standing
where the columns have room and laid on their side where they do not; a line
has room for twelve points, a year of months. A label longer than eight
characters does not fit under its group, a figure of seven digits does not fit
on its bar or its axis — which is why a printed chart says 1,250万円 rather than
12,500,000円 — and a fourth series is more than a legend can keep apart without
colour, which a document does not use: inside the sheet everything is ink.
The validator holds all of this, so a draft outside it is sent back with the
reason rather than drawn badly.
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Optional

#: What a chart may draw. See the module docstring for why not a pie.
CHART_KINDS = ["bar", "line"]

#: How each kind is named when a chart is written out as text.
KIND_JA = {"bar": "棒グラフ", "line": "折れ線グラフ"}

MAX_SERIES = 3
MIN_CATEGORIES = 2
MAX_CATEGORIES = {"bar": 8, "line": 12}
#: A category sits under its own group of bars; eight characters is two lines
#: of four there (「第1四半期」「東日本エリア」「2026年度」).
CATEGORY_MAX_CHARS = 8
#: A series name sits in the legend, which wraps.
SERIES_NAME_MAX_CHARS = 12
CAPTION_MAX_CHARS = 40
UNIT_MAX_CHARS = 8
#: Every figure is smaller than this in absolute value: at most six digits
#: before the point. Choose the unit so that it fits, as print does.
VALUE_LIMIT = 1_000_000
#: …and at most two after it.
MAX_DECIMALS = 2
#: One chart per document. Two graphs on a phone screen is a scrolling test.
MAX_PER_DOCUMENT = 1


def is_number(value: Any) -> bool:
    """A real, finite number. `True` is an int to Python and not a figure to
    anybody, and NaN would reach the database as a JSON token Postgres refuses."""
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))


def format_value(value: Any) -> str:
    """A figure as print sets it: thousands separated, no trailing zeros.
    The app writes the same string (`formatValue` in client/src/ui/plot.ts)."""
    if not is_number(value):
        return "—"
    if float(value).is_integer():
        return f"{int(value):,}"
    return f"{value:,.{MAX_DECIMALS}f}".rstrip("0").rstrip(".")


def _labels(value: Any) -> list[str]:
    return [str(x) for x in value] if isinstance(value, list) else []


def normalised(block: dict) -> dict:
    """The chart as something every renderer can draw without asking questions.

    Validation happens upstream and a published chart has passed it; this is
    the belt to that brace, because a renderer is the one place a malformed
    block must not raise — a learner is in the middle of reading. Unknown kinds
    draw as bars, missing labels as blanks, a value that is not a number as a
    gap, and a series is cut or padded to the categories it has.
    """
    categories = _labels(block.get("categories"))
    series = []
    for s in block.get("series") or []:
        if not isinstance(s, dict) or len(series) >= MAX_SERIES:
            continue
        raw = s.get("values") if isinstance(s.get("values"), list) else []
        values: list[Optional[float]] = [
            float(v) if is_number(v) else None for v in raw[:len(categories)]]
        values += [None] * (len(categories) - len(values))
        series.append({"name": str(s.get("name") or "").strip(), "values": values})
    kind = block.get("kind")
    return {
        "kind": kind if kind in CHART_KINDS else "bar",
        "caption": str(block.get("caption") or ""),
        "unit": str(block.get("unit") or ""),
        "categories": categories,
        "series": series,
    }


def errors(block: dict) -> list[str]:
    """What is wrong with a chart block, each as a phrase that follows
    "block 3 (chart) …". Empty when it can be drawn and read."""
    out: list[str] = []
    kind = block.get("kind")
    if kind not in CHART_KINDS:
        out.append(f"has kind {kind!r}; a chart is one of {CHART_KINDS}")
    if len(str(block.get("caption") or "")) > CAPTION_MAX_CHARS:
        out.append(f"has a caption longer than {CAPTION_MAX_CHARS} characters")
    if len(str(block.get("unit") or "")) > UNIT_MAX_CHARS:
        out.append(f"has a unit longer than {UNIT_MAX_CHARS} characters")

    categories = block.get("categories")
    if not isinstance(categories, list):
        out.append("needs `categories`, a list of labels")
        categories = []
    most = MAX_CATEGORIES.get(kind, max(MAX_CATEGORIES.values()))
    if categories and not MIN_CATEGORIES <= len(categories) <= most:
        out.append(f"has {len(categories)} categories; a {kind or 'chart'} takes "
                   f"{MIN_CATEGORIES}–{most}")
    for c in categories:
        if not isinstance(c, str) or not c.strip():
            out.append("has a blank category label")
        elif len(c) > CATEGORY_MAX_CHARS:
            out.append(f"category {c!r} is longer than {CATEGORY_MAX_CHARS} characters")
    labels = [c for c in categories if isinstance(c, str)]
    if len(set(labels)) != len(labels):
        out.append("repeats a category label")

    series = block.get("series")
    if not isinstance(series, list) or not series:
        out.append("needs `series`, one to three lists of figures")
        return out
    if len(series) > MAX_SERIES:
        out.append(f"has {len(series)} series; at most {MAX_SERIES} can be told apart")
    names = []
    for n, s in enumerate(series):
        if not isinstance(s, dict):
            out.append(f"series {n} is not an object")
            continue
        name = str(s.get("name") or "").strip()
        names.append(name)
        if len(name) > SERIES_NAME_MAX_CHARS:
            out.append(f"series name {name!r} is longer than {SERIES_NAME_MAX_CHARS} characters")
        values = s.get("values")
        if not isinstance(values, list):
            out.append(f"series {n} has no list of values")
            continue
        if len(values) != len(categories):
            out.append(f"series {n} has {len(values)} value(s) for {len(categories)} "
                       "categories")
        for v in values:
            if not is_number(v):
                out.append(f"series {n} has {v!r}, which is not a finite number")
            elif abs(v) >= VALUE_LIMIT:
                out.append(f"series {n} has {v}, which needs more than six digits; state "
                           "it in a larger unit (万円 rather than 円)")
            elif abs(v * 10 ** MAX_DECIMALS - round(v * 10 ** MAX_DECIMALS)) > 1e-6:
                out.append(f"series {n} has {v}, more than {MAX_DECIMALS} decimal places")
    if len(series) > 1:
        if not all(names):
            out.append("names every series when there is more than one, or the legend "
                       "cannot say which is which")
        elif len(set(names)) != len(names):
            out.append("gives two series the same name")
    figures = [v for s in series if isinstance(s, dict) and isinstance(s.get("values"), list)
               for v in s["values"] if is_number(v)]
    if figures and not any(figures):
        out.append("has nothing but zeros")
    return out


def text(block: dict) -> str:
    """A chart written out for a reader who cannot see it: what it is and in
    what unit, then each series with every figure beside its category.

        【棒グラフ】月別 問い合わせ件数（単位：件）
        電話：4月 330 / 5月 410 / 6月 340
        メール：4月 150 / 5月 190 / 6月 250

    Pairing each figure with its label, rather than printing a row of numbers
    under a row of months, is what keeps a model from reading 5月's figure as
    6月's: the gate and the probe answer from this text, and a misaligned
    column would make an answerable item look ambiguous.
    """
    c = normalised(block)
    head = f"【{KIND_JA[c['kind']]}】{c['caption']}"
    if c["unit"]:
        head += f"（単位：{c['unit']}）"
    lines = [head]
    for s in c["series"]:
        pairs = " / ".join(f"{label} {format_value(v)}"
                           for label, v in zip(c["categories"], s["values"], strict=True))
        lines.append(f"{s['name']}：{pairs}" if s["name"] else pairs)
    return "\n".join(lines)


def axis(values: Iterable[Any], target: int = 5) -> list[float]:
    """Gridline values for a chart of these figures: round numbers, zero among
    them, spanning every figure. `niceTicks` in client/src/ui/plot.ts is the same
    arithmetic, so a page and a phone draw the same lines."""
    finite = [float(v) for v in values if is_number(v)]
    lo, hi = min([0.0, *finite]), max([0.0, *finite])
    if lo == hi:
        hi = lo + 1
    raw = (hi - lo) / target
    magnitude = 10 ** math.floor(math.log10(raw))
    step = next(m * magnitude for m in (1, 2, 2.5, 5, 10) if m * magnitude >= raw * (1 - 1e-9))
    first = math.floor(lo / step + 1e-9) * step
    last = math.ceil(hi / step - 1e-9) * step
    return [round(first + i * step, 10) for i in range(int(round((last - first) / step)) + 1)]
