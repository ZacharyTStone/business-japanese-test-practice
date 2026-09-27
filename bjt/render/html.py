"""Document data → semantic HTML.

Three rules decide everything in this file.

**Never an image.** A screenshot of an email cannot be selected, scaled,
searched, or read aloud, and an image model cannot spell 御中 reliably anyway.

**Semantic elements, not styled divs.** A table is a `<table>` with real `<th>`
cells and a scope, header fields are a `<dl>`, a quoted message is a
`<blockquote>`. That is what makes the document navigable with a Japanese screen
reader, which is a requirement and not a nicety: this is a language exam aid, and
somebody using it may well be reading it with their ears.

**Every string is escaped.** The content comes out of a model. It is data, not
markup, and it is interpolated into HTML — so it is escaped on the way in, with
no exceptions and no "trusted" path.

The output carries class names and no styles of its own; the app supplies the
visual design, so one document renders correctly in light mode, dark mode, and
at whatever text size the reader has chosen.
"""
from __future__ import annotations

from html import escape

from . import chart as chartmod
from . import templates as tpl

#: Heading depth is clamped: a document sits inside an app screen that already
#: owns h1, so its own headings start at h2 and never go past h4.
_MIN_HEADING, _MAX_HEADING = 2, 4


def _esc(value) -> str:
    return escape(str(value if value is not None else ""), quote=True)


def _attr(name: str, value: str | None) -> str:
    return f' {name}="{_esc(value)}"' if value else ""


def _heading(block: dict) -> str:
    level = block.get("level") or _MIN_HEADING
    try:
        level = int(level)
    except (TypeError, ValueError):
        level = _MIN_HEADING
    level = max(_MIN_HEADING, min(_MAX_HEADING, level))
    return f"<h{level} class=\"doc-heading\">{_esc(block.get('text'))}</h{level}>"


def _paragraph(block: dict) -> str:
    return f"<p class=\"doc-p\">{_esc(block.get('text'))}</p>"


def _list(block: dict, tag: str) -> str:
    items = "".join(f"<li>{_esc(x)}</li>" for x in block.get("items") or [])
    return f'<{tag} class="doc-list">{items}</{tag}>'


def _table(block: dict) -> str:
    columns = block.get("columns") or []
    head = "".join(f'<th scope="col">{_esc(c)}</th>' for c in columns)
    body = "".join(
        "<tr>"
        + "".join(
            # The first cell of each row is a row header, so a screen reader can
            # say "納期 — 4月10日" instead of reading a naked date out of context.
            f'<th scope="row">{_esc(cell)}</th>' if i == 0 else f"<td>{_esc(cell)}</td>"
            for i, cell in enumerate(row)
        )
        + "</tr>"
        for row in block.get("rows") or []
    )
    caption = f"<caption>{_esc(block['caption'])}</caption>" if block.get("caption") else ""
    return (
        f'<table class="doc-table">{caption}'
        f"<thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"
    )


def _key_values(block: dict) -> str:
    rows = "".join(
        f"<div class=\"doc-field\"><dt>{_esc(p.get('label'))}</dt>"
        f"<dd>{_esc(p.get('value'))}</dd></div>"
        for p in block.get("pairs") or []
    )
    return f'<dl class="doc-fields">{rows}</dl>'


def _quoted_message(block: dict) -> str:
    depth = block.get("depth") or 0
    try:
        depth = max(0, min(4, int(depth)))
    except (TypeError, ValueError):
        depth = 0
    header = _esc(block.get("sender"))
    if block.get("sent_at"):
        header += f" · {_esc(block.get('sent_at'))}"
    return (
        f'<blockquote class="doc-quote" data-depth="{depth}">'
        f'<p class="doc-quote-from">{header}</p>'
        f"<p class=\"doc-p\">{_esc(block.get('text'))}</p>"
        "</blockquote>"
    )


def _callout(block: dict) -> str:
    tone = block.get("tone") or "info"
    if tone not in ("info", "warning", "action"):
        tone = "info"
    # role="note" rather than an alert: this is part of a reading passage, and a
    # screen reader interrupting the learner mid-document would be wrong.
    return (
        f'<aside class="doc-callout" data-tone="{_esc(tone)}" role="note">'
        f"<p class=\"doc-p\">{_esc(block.get('text'))}</p></aside>"
    )


# ----- the chart ----------------------------------------------------------
#
# Drawn as inline SVG from the block's numbers — geometry, not a picture: it
# scales, its labels are text, and nothing in it came out of an image model.
# It carries no styles of its own either. Every mark is `currentColor`, so the
# chart is the colour of the text around it in light mode and in dark, and the
# series are told apart the way a photocopied chart tells them apart — solid,
# grey, outlined; solid, dashed, dotted; circle, square, triangle — never by
# hue alone. The SVG is hidden from a screen reader, which is handed the same
# figures as a real table instead (`doc-chart-data`): a table can be walked
# cell by cell, and a drawing cannot.

#: The drawing's own coordinate width. It is scaled to the column, so this
#: fixes proportions and the text size relative to them, not pixels.
_CHART_W = 360
_CHART_PLOT_H = 170
_CHART_TOP = 16          # room for a figure printed above the tallest bar
_CHART_BOTTOM = 32       # two lines of category label
_CHART_FONT = 11
_CHART_VALUE_FONT = 10

#: One entry per series, in order: fill, fill opacity, line dash, marker.
_SERIES = [
    ("currentColor", "1", "", "circle"),
    ("currentColor", "0.45", "6 4", "square"),
    ("none", "1", "2 3", "triangle"),
]


def _num(x: float) -> str:
    return f"{x:.1f}".rstrip("0").rstrip(".")


def _text_width(label: str, size: float) -> float:
    """A guess at how wide a label sets: a full em for kanji and kana, a little
    over half one for a digit or a Latin letter — which is what keeps 「10月」
    on one line rather than breaking it into 「10」 and 「月」."""
    return sum(0.58 if ord(ch) < 0x2E80 else 1.0 for ch in label) * size


def _category_label(label: str, x: float, y: float, room: float) -> str:
    """A category under its group: one line if it fits, two if it does not."""
    if _text_width(label, _CHART_FONT) <= room or len(label) < 2:
        return (f'<text x="{_num(x)}" y="{_num(y)}" text-anchor="middle" '
                f'font-size="{_CHART_FONT}" fill="currentColor">{_esc(label)}</text>')
    half = (len(label) + 1) // 2
    return (f'<text x="{_num(x)}" y="{_num(y)}" text-anchor="middle" '
            f'font-size="{_CHART_FONT}" fill="currentColor">'
            f'<tspan x="{_num(x)}">{_esc(label[:half])}</tspan>'
            f'<tspan x="{_num(x)}" dy="{_CHART_FONT + 2}">{_esc(label[half:])}</tspan></text>')


def _marker(shape: str, x: float, y: float, fill: str, opacity: str) -> str:
    common = (f'fill="{"none" if fill == "none" else "currentColor"}" '
              f'fill-opacity="{opacity}" stroke="currentColor" stroke-width="1.2"')
    if shape == "square":
        return f'<rect x="{_num(x - 3.5)}" y="{_num(y - 3.5)}" width="7" height="7" {common}/>'
    if shape == "triangle":
        pts = f"{_num(x)},{_num(y - 4.5)} {_num(x - 4.5)},{_num(y + 3.5)} {_num(x + 4.5)},{_num(y + 3.5)}"
        return f'<polygon points="{pts}" {common}/>'
    return f'<circle cx="{_num(x)}" cy="{_num(y)}" r="3.5" {common}/>'


def _chart_svg(c: dict) -> str:
    values = [v for s in c["series"] for v in s["values"] if v is not None]
    ticks = chartmod.axis(values)
    lo, hi = ticks[0], ticks[-1]
    labels = [chartmod.format_value(t) for t in ticks]
    left = max(_text_width(lab, _CHART_FONT) for lab in labels) + 8
    plot_w = _CHART_W - left - 6
    height = _CHART_TOP + _CHART_PLOT_H + _CHART_BOTTOM
    n = max(1, len(c["categories"]))
    group = plot_w / n

    def y(v: float) -> float:
        return _CHART_TOP + (hi - v) / (hi - lo) * _CHART_PLOT_H

    marks: list[str] = []
    for t, lab in zip(ticks, labels):
        # Zero is the baseline and is drawn darker; the rest are guides.
        opacity = "0.6" if t == 0 else "0.15"
        marks.append(f'<line x1="{_num(left)}" y1="{_num(y(t))}" x2="{_num(left + plot_w)}" '
                     f'y2="{_num(y(t))}" stroke="currentColor" stroke-opacity="{opacity}" '
                     'stroke-width="1"/>')
        marks.append(f'<text x="{_num(left - 5)}" y="{_num(y(t) + 4)}" text-anchor="end" '
                     f'font-size="{_CHART_FONT}" fill="currentColor" fill-opacity="0.7">'
                     f"{_esc(lab)}</text>")

    m = max(1, len(c["series"]))
    if c["kind"] == "bar":
        inner = group * 0.72
        bar = inner / m
        for i in range(len(c["categories"])):
            for j, s in enumerate(c["series"]):
                v = s["values"][i]
                if v is None:
                    continue
                fill, opacity, _, _ = _SERIES[j]
                x = left + i * group + (group - inner) / 2 + j * bar
                top, bottom = y(max(v, 0.0)), y(min(v, 0.0))
                marks.append(f'<rect x="{_num(x + 0.5)}" y="{_num(top)}" '
                             f'width="{_num(max(bar - 1, 1))}" height="{_num(max(bottom - top, 0.5))}" '
                             f'fill="{fill}" fill-opacity="{opacity}" stroke="currentColor" '
                             'stroke-width="0.75"/>')
                figure = chartmod.format_value(v)
                # The figure goes over its bar where it fits, and is left to
                # the gridlines and the data table where it does not.
                if _text_width(figure, _CHART_VALUE_FONT) <= bar + 2:
                    ty = top - 3 if v >= 0 else bottom + _CHART_VALUE_FONT
                    marks.append(f'<text x="{_num(x + bar / 2)}" y="{_num(ty)}" '
                                 f'text-anchor="middle" font-size="{_CHART_VALUE_FONT}" '
                                 f'fill="currentColor">{_esc(figure)}</text>')
    else:
        for j, s in enumerate(c["series"]):
            fill, opacity, dash, shape = _SERIES[j]
            points = [(left + (i + 0.5) * group, y(v))
                      for i, v in enumerate(s["values"]) if v is not None]
            dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
            marks.append('<polyline points="'
                         + " ".join(f"{_num(px)},{_num(py)}" for px, py in points)
                         + f'" fill="none" stroke="currentColor" stroke-width="2"{dash_attr}/>')
            marks.extend(_marker(shape, px, py, fill, opacity) for px, py in points)

    base = _CHART_TOP + _CHART_PLOT_H + _CHART_FONT + 3
    for i, label in enumerate(c["categories"]):
        marks.append(_category_label(label, left + (i + 0.5) * group, base, group))

    return (f'<svg class="doc-chart-plot" viewBox="0 0 {_CHART_W} {_num(height)}" '
            'width="100%" aria-hidden="true" focusable="false">'
            + "".join(marks) + "</svg>")


def _legend(c: dict) -> str:
    """Which drawing is which series. Only drawn for two or more; one series
    is what the caption already says."""
    if len(c["series"]) < 2:
        return ""
    items = []
    for j, s in enumerate(c["series"]):
        fill, opacity, dash, shape = _SERIES[j]
        if c["kind"] == "bar":
            swatch = (f'<rect x="1" y="1" width="12" height="10" fill="{fill}" '
                      f'fill-opacity="{opacity}" stroke="currentColor" stroke-width="0.75"/>')
        else:
            dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
            swatch = (f'<line x1="0" y1="6" x2="22" y2="6" stroke="currentColor" '
                      f'stroke-width="2"{dash_attr}/>' + _marker(shape, 11, 6, fill, opacity))
        items.append(f'<li><svg class="doc-chart-swatch" viewBox="0 0 24 12" width="24" '
                     f'height="12" aria-hidden="true" focusable="false">{swatch}</svg>'
                     f"{_esc(s['name'])}</li>")
    return f'<ul class="doc-chart-legend">{"".join(items)}</ul>'


def _chart_table(c: dict) -> str:
    """The figures as a table, for a reader who cannot see the drawing."""
    unit = f"（単位：{c['unit']}）" if c["unit"] else ""
    head = '<th scope="col"></th>' + "".join(
        f'<th scope="col">{_esc(s["name"] or c["unit"])}</th>' for s in c["series"])
    body = "".join(
        f'<tr><th scope="row">{_esc(label)}</th>'
        + "".join(f"<td>{_esc(chartmod.format_value(s['values'][i]))}</td>"
                  for s in c["series"])
        + "</tr>"
        for i, label in enumerate(c["categories"])
    )
    return (f'<table class="doc-table doc-chart-data"><caption>{_esc(c["caption"])}'
            f"{_esc(unit)}</caption><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>")


def _chart(block: dict) -> str:
    c = chartmod.normalised(block)
    if not c["categories"] or not c["series"]:
        # Nothing to draw. The title still says a chart was meant to be here.
        return f'<p class="doc-p">{_esc(c["caption"])}</p>' if c["caption"] else ""
    unit = f'<span class="doc-chart-unit">（単位：{_esc(c["unit"])}）</span>' if c["unit"] else ""
    return (
        f'<figure class="doc-chart" data-kind="{_esc(c["kind"])}">'
        f'<figcaption class="doc-chart-caption">{_esc(c["caption"])}{unit}</figcaption>'
        f"{_legend(c)}{_chart_svg(c)}{_chart_table(c)}</figure>"
    )


_RENDERERS = {
    "heading": _heading,
    "paragraph": _paragraph,
    "bullets": lambda b: _list(b, "ul"),
    "numbered": lambda b: _list(b, "ol"),
    "table": _table,
    "key_values": _key_values,
    "quoted_message": _quoted_message,
    "callout": _callout,
    "chart": _chart,
}


def render_block(block: dict) -> str:
    """One block. An unknown type renders as nothing rather than raising: a
    document is a stimulus a learner is in the middle of reading, and losing one
    paragraph beats losing the screen."""
    renderer = _RENDERERS.get(block.get("type"))
    return renderer(block) if renderer else ""


def render(doc: dict) -> str:
    """A whole document as an HTML fragment — no <html>, no <style>.

    A fragment rather than a page because it is embedded: in the app it sits
    inside a screen that already owns the page chrome, and in `bjt practice` it
    is wrapped by the preview. Styling belongs to whoever embeds it.
    """
    template_id = doc.get("template", "")
    template = tpl.TEMPLATES.get(template_id)
    label = template.ja if template else template_id

    meta_block = ""
    if doc.get("meta"):
        meta_block = _key_values({"pairs": doc["meta"]})

    body = "".join(render_block(b) for b in doc.get("blocks") or [] if isinstance(b, dict))

    return (
        f'<article class="doc"{_attr("data-template", template_id)}'
        f'{_attr("aria-label", label)}>'
        "<header class=\"doc-header\">"
        f'<p class="doc-kind">{_esc(label)}</p>'
        f'<h2 class="doc-title">{_esc(doc.get("title"))}</h2>'
        f"{meta_block}</header>"
        f'<div class="doc-body">{body}</div>'
        "</article>"
    )


def render_page(doc: dict, *, title: str | None = None) -> str:
    """A standalone HTML page, for looking at a document while writing one.

    Used by `bjt render`. Not what the app consumes — the app takes the fragment
    and brings its own theme — so the styling here exists only to make the
    fragment readable in a browser, and deliberately matches nothing.
    """
    style = """
      :root { color-scheme: light dark; }
      body { font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
             line-height: 1.8; margin: 0; padding: 24px; background: Canvas; color: CanvasText; }
      .doc { max-width: 42rem; margin: 0 auto; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
             border-radius: 12px; padding: 20px; }
      .doc-kind { font-size: 12px; letter-spacing: .08em; opacity: .7; margin: 0 0 4px; }
      .doc-title { font-size: 20px; margin: 0 0 12px; }
      .doc-fields { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 16px; }
      .doc-field { display: contents; }
      .doc-fields dt { font-size: 13px; opacity: .7; }
      .doc-fields dd { margin: 0; font-size: 14px; }
      .doc-table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 14px; }
      .doc-table th, .doc-table td { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
                                     padding: 6px 10px; text-align: left; }
      .doc-quote { border-left: 3px solid color-mix(in srgb, CanvasText 25%, transparent);
                   margin: 12px 0 12px 8px; padding-left: 12px; }
      .doc-quote-from { font-size: 12px; opacity: .7; margin: 0 0 4px; }
      .doc-callout { border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
                     border-radius: 8px; padding: 8px 12px; margin: 12px 0; }
      .doc-chart { margin: 12px 0; }
      .doc-chart-caption { font-size: 14px; font-weight: 700; text-align: center; }
      .doc-chart-unit { font-weight: 400; font-size: 12px; opacity: .7; }
      .doc-chart-legend { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 16px;
                          justify-content: center; margin: 6px 0; padding: 0; font-size: 12px; }
      .doc-chart-legend li { display: flex; align-items: center; gap: 6px; }
      .doc-chart-plot { display: block; max-width: 36rem; margin: 0 auto; }
      /* The figures, for a screen reader; the drawing is for the eye. */
      .doc-chart-data { position: absolute; width: 1px; height: 1px; overflow: hidden;
                        clip: rect(0 0 0 0); white-space: nowrap; }
      @media (max-width: 480px) { body { padding: 12px; } .doc { padding: 14px; } }
    """
    head_title = _esc(title or doc.get("title") or "document")
    return (
        "<!doctype html>\n"
        '<html lang="ja"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{head_title}</title><style>{style}</style></head>"
        f"<body>{render(doc)}</body></html>\n"
    )
