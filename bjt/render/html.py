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


_RENDERERS = {
    "heading": _heading,
    "paragraph": _paragraph,
    "bullets": lambda b: _list(b, "ul"),
    "numbered": lambda b: _list(b, "ol"),
    "table": _table,
    "key_values": _key_values,
    "quoted_message": _quoted_message,
    "callout": _callout,
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
