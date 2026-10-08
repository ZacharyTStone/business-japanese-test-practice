/**
 * Document data → semantic HTML.
 *
 * Three rules decide everything in this file.
 *
 * **Never an image.** A screenshot of an email cannot be selected, scaled,
 * searched, or read aloud, and an image model cannot spell 御中 reliably anyway.
 *
 * **Semantic elements, not styled divs.** A table is a `<table>` with real `<th>`
 * cells and a scope, header fields are a `<dl>`, a quoted message is a
 * `<blockquote>`. That is what makes the document navigable with a Japanese screen
 * reader, which is a requirement and not a nicety: this is a language exam aid, and
 * somebody using it may well be reading it with their ears.
 *
 * **Every string is escaped.** The content comes out of a model. It is data, not
 * markup, and it is interpolated into HTML — so it is escaped on the way in, with
 * no exceptions and no "trusted" path.
 *
 * The output carries class names and no styles of its own; the app supplies the
 * visual design, so one document renders correctly in light mode, dark mode, and
 * at whatever text size the reader has chosen.
 */
import { fixed, floorDiv, get, has, htmlEscape, isDict, len, or, PyError, rstrip, slice, str, toInt, truthy, TypeError_, ValueError } from "../py.ts";
import * as chartmod from "./chart.ts";
import type { Chart } from "./chart.ts";
import { CALLOUT_TONES } from "./document.ts";
import * as tpl from "./templates.ts";

/** Heading depth is clamped: a document sits inside an app screen that already
 *  owns h1, so its own headings start at h2 and never go past h4. */
export const _MIN_HEADING = 2;
export const _MAX_HEADING = 4;

type Block = Record<string, any>;

/** `for x in (value or [])`, as Python iterates it: a list's elements, a
 *  string's characters, a dict's keys. */
function iterOr(v: unknown): any[] {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [...v];
  if (isDict(v)) return Object.keys(v);
  throw new TypeError_(`'${typeof v}' object is not iterable`);
}

/** `for x in value`. */
function iterOf(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [...v];
  if (isDict(v)) return Object.keys(v);
  throw new TypeError_(`'${typeof v}' object is not iterable`);
}

/** `int(value)`, or null where Python raises TypeError or ValueError (the
 *  two the callers catch). An infinity is an OverflowError, which they do
 *  not catch, and is thrown. */
function intOrNull(value: unknown): number | null {
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return null;
    if (!Number.isFinite(value)) throw new PyError("cannot convert float infinity to integer");
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    try {
      return toInt(value);
    } catch (e) {
      if (e instanceof ValueError) return null;
      throw e;
    }
  }
  return null;
}

export function _esc(value: unknown): string {
  return htmlEscape(str(value !== null && value !== undefined ? value : ""), true);
}

export function _attr(name: string, value: unknown): string {
  return truthy(value) ? ` ${name}="${_esc(value)}"` : "";
}

function _heading(block: Block): string {
  let level = intOrNull(or(get(block, "level"), _MIN_HEADING)) ?? _MIN_HEADING;
  level = Math.max(_MIN_HEADING, Math.min(_MAX_HEADING, level));
  return `<h${level} class="doc-heading">${_esc(get(block, "text"))}</h${level}>`;
}

function _paragraph(block: Block): string {
  return `<p class="doc-p">${_esc(get(block, "text"))}</p>`;
}

function _list(block: Block, tag: string): string {
  const items = iterOr(get(block, "items")).map((x) => `<li>${_esc(x)}</li>`).join("");
  return `<${tag} class="doc-list">${items}</${tag}>`;
}

function _table(block: Block): string {
  const columns = iterOr(get(block, "columns"));
  const head = columns.map((c) => `<th scope="col">${_esc(c)}</th>`).join("");
  const body = iterOr(get(block, "rows")).map((row) =>
    "<tr>" +
    iterOf(row).map((cell, i) =>
      // The first cell of each row is a row header, so a screen reader can
      // say "納期 — 4月10日" instead of reading a naked date out of context.
      i === 0 ? `<th scope="row">${_esc(cell)}</th>` : `<td>${_esc(cell)}</td>`,
    ).join("") +
    "</tr>",
  ).join("");
  const caption = truthy(get(block, "caption")) ? `<caption>${_esc(block["caption"])}</caption>` : "";
  return (
    `<table class="doc-table">${caption}` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  );
}

function _keyValues(block: Block): string {
  const rows = iterOr(get(block, "pairs")).map((p) =>
    `<div class="doc-field"><dt>${_esc(get(p, "label"))}</dt>` +
    `<dd>${_esc(get(p, "value"))}</dd></div>`,
  ).join("");
  return `<dl class="doc-fields">${rows}</dl>`;
}

function _quotedMessage(block: Block): string {
  const raw = intOrNull(or(get(block, "depth"), 0));
  const depth = raw === null ? 0 : Math.max(0, Math.min(4, raw));
  let header = _esc(get(block, "sender"));
  if (truthy(get(block, "sent_at"))) {
    header += ` · ${_esc(get(block, "sent_at"))}`;
  }
  return (
    `<blockquote class="doc-quote" data-depth="${depth}">` +
    `<p class="doc-quote-from">${header}</p>` +
    `<p class="doc-p">${_esc(get(block, "text"))}</p>` +
    "</blockquote>"
  );
}

function _callout(block: Block): string {
  let tone = or(get(block, "tone"), "info");
  if (!CALLOUT_TONES.includes(tone)) {
    tone = "info";
  }
  // role="note" rather than an alert: this is part of a reading passage, and a
  // screen reader interrupting the learner mid-document would be wrong.
  return (
    `<aside class="doc-callout" data-tone="${_esc(tone)}" role="note">` +
    `<p class="doc-p">${_esc(get(block, "text"))}</p></aside>`
  );
}

// ----- the chart ----------------------------------------------------------
//
// Drawn as inline SVG from the block's numbers — geometry, not a picture: it
// scales, its labels are text, and nothing in it came out of an image model.
// It carries no styles of its own either. Every mark is `currentColor`, so the
// chart is the colour of the text around it in light mode and in dark, and the
// series are told apart the way a photocopied chart tells them apart — solid,
// grey, outlined; solid, dashed, dotted; circle, square, triangle — never by
// hue alone. The SVG is hidden from a screen reader, which is handed the same
// figures as a real table instead (`doc-chart-data`): a table can be walked
// cell by cell, and a drawing cannot.

/** The drawing's own coordinate width. It is scaled to the column, so this
 *  fixes proportions and the text size relative to them, not pixels. */
export const _CHART_W = 360;
export const _CHART_PLOT_H = 170;
export const _CHART_TOP = 16;          // room for a figure printed above the tallest bar
export const _CHART_BOTTOM = 32;       // two lines of category label
export const _CHART_FONT = 11;
export const _CHART_VALUE_FONT = 10;

/** One entry per series, in order: fill, fill opacity, line dash, marker. */
export const _SERIES: readonly (readonly [string, string, string, string])[] = [
  ["currentColor", "1", "", "circle"],
  ["currentColor", "0.45", "6 4", "square"],
  ["none", "1", "2 3", "triangle"],
];

export function _num(x: number): string {
  return rstrip(rstrip(fixed(x, 1), "0"), ".");
}

/** A guess at how wide a label sets: a full em for kanji and kana, a little
 *  over half one for a digit or a Latin letter — which is what keeps 「10月」
 *  on one line rather than breaking it into 「10」 and 「月」. */
export function _textWidth(label: string, size: number): number {
  let total = 0;
  for (const ch of label) total += ch.codePointAt(0)! < 0x2E80 ? 0.58 : 1.0;
  return total * size;
}

/** A category under its group: one line if it fits, two if it does not. */
function _categoryLabel(label: string, x: number, y: number, room: number): string {
  if (_textWidth(label, _CHART_FONT) <= room || len(label) < 2) {
    return (`<text x="${_num(x)}" y="${_num(y)}" text-anchor="middle" ` +
            `font-size="${_CHART_FONT}" fill="currentColor">${_esc(label)}</text>`);
  }
  const half = floorDiv(len(label) + 1, 2);
  return (`<text x="${_num(x)}" y="${_num(y)}" text-anchor="middle" ` +
          `font-size="${_CHART_FONT}" fill="currentColor">` +
          `<tspan x="${_num(x)}">${_esc(slice(label, 0, half))}</tspan>` +
          `<tspan x="${_num(x)}" dy="${_CHART_FONT + 2}">${_esc(slice(label, half))}</tspan></text>`);
}

function _marker(shape: string, x: number, y: number, fill: string, opacity: string): string {
  const common = (`fill="${fill === "none" ? "none" : "currentColor"}" ` +
                  `fill-opacity="${opacity}" stroke="currentColor" stroke-width="1.2"`);
  if (shape === "square") {
    return `<rect x="${_num(x - 3.5)}" y="${_num(y - 3.5)}" width="7" height="7" ${common}/>`;
  }
  if (shape === "triangle") {
    const pts = `${_num(x)},${_num(y - 4.5)} ${_num(x - 4.5)},${_num(y + 3.5)} ${_num(x + 4.5)},${_num(y + 3.5)}`;
    return `<polygon points="${pts}" ${common}/>`;
  }
  return `<circle cx="${_num(x)}" cy="${_num(y)}" r="3.5" ${common}/>`;
}

function _chartSvg(c: Chart): string {
  const values = c.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const ticks = chartmod.axis(values);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const labels = ticks.map((t) => chartmod.formatValue(t));
  const left = Math.max(...labels.map((lab) => _textWidth(lab, _CHART_FONT))) + 8;
  const plotW = _CHART_W - left - 6;
  const height = _CHART_TOP + _CHART_PLOT_H + _CHART_BOTTOM;
  const n = Math.max(1, c.categories.length);
  const group = plotW / n;

  const y = (v: number): number => _CHART_TOP + (hi - v) / (hi - lo) * _CHART_PLOT_H;

  const marks: string[] = [];
  ticks.forEach((t, k) => {
    const lab = labels[k];
    // Zero is the baseline and is drawn darker; the rest are guides.
    const opacity = t === 0 ? "0.6" : "0.15";
    marks.push(`<line x1="${_num(left)}" y1="${_num(y(t))}" x2="${_num(left + plotW)}" ` +
               `y2="${_num(y(t))}" stroke="currentColor" stroke-opacity="${opacity}" ` +
               'stroke-width="1"/>');
    marks.push(`<text x="${_num(left - 5)}" y="${_num(y(t) + 4)}" text-anchor="end" ` +
               `font-size="${_CHART_FONT}" fill="currentColor" fill-opacity="0.7">` +
               `${_esc(lab)}</text>`);
  });

  const m = Math.max(1, c.series.length);
  if (c.kind === "bar") {
    const inner = group * 0.72;
    const bar = inner / m;
    for (let i = 0; i < c.categories.length; i++) {
      c.series.forEach((s, j) => {
        const v = s.values[i];
        if (v === null) {
          return;
        }
        const [fill, opacity] = _SERIES[j];
        const x = left + i * group + (group - inner) / 2 + j * bar;
        const top = y(Math.max(v, 0.0));
        const bottom = y(Math.min(v, 0.0));
        marks.push(`<rect x="${_num(x + 0.5)}" y="${_num(top)}" ` +
                   `width="${_num(Math.max(bar - 1, 1))}" height="${_num(Math.max(bottom - top, 0.5))}" ` +
                   `fill="${fill}" fill-opacity="${opacity}" stroke="currentColor" ` +
                   'stroke-width="0.75"/>');
        const figure = chartmod.formatValue(v);
        // The figure goes over its bar where it fits, and is left to
        // the gridlines and the data table where it does not.
        if (_textWidth(figure, _CHART_VALUE_FONT) <= bar + 2) {
          const ty = v >= 0 ? top - 3 : bottom + _CHART_VALUE_FONT;
          marks.push(`<text x="${_num(x + bar / 2)}" y="${_num(ty)}" ` +
                     `text-anchor="middle" font-size="${_CHART_VALUE_FONT}" ` +
                     `fill="currentColor">${_esc(figure)}</text>`);
        }
      });
    }
  } else {
    c.series.forEach((s, j) => {
      const [fill, opacity, dash, shape] = _SERIES[j];
      const points: [number, number][] = [];
      s.values.forEach((v, i) => {
        if (v !== null) points.push([left + (i + 0.5) * group, y(v)]);
      });
      const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
      marks.push('<polyline points="' +
                 points.map(([px, py]) => `${_num(px)},${_num(py)}`).join(" ") +
                 `" fill="none" stroke="currentColor" stroke-width="2"${dashAttr}/>`);
      for (const [px, py] of points) marks.push(_marker(shape, px, py, fill, opacity));
    });
  }

  const base = _CHART_TOP + _CHART_PLOT_H + _CHART_FONT + 3;
  c.categories.forEach((label, i) => {
    marks.push(_categoryLabel(label, left + (i + 0.5) * group, base, group));
  });

  return (`<svg class="doc-chart-plot" viewBox="0 0 ${_CHART_W} ${_num(height)}" ` +
          'width="100%" aria-hidden="true" focusable="false">' +
          marks.join("") + "</svg>");
}

/** Which drawing is which series. Only drawn for two or more; one series
 *  is what the caption already says. */
function _legend(c: Chart): string {
  if (c.series.length < 2) {
    return "";
  }
  const items: string[] = [];
  c.series.forEach((s, j) => {
    const [fill, opacity, dash, shape] = _SERIES[j];
    let swatch: string;
    if (c.kind === "bar") {
      swatch = (`<rect x="1" y="1" width="12" height="10" fill="${fill}" ` +
                `fill-opacity="${opacity}" stroke="currentColor" stroke-width="0.75"/>`);
    } else {
      const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
      swatch = (`<line x1="0" y1="6" x2="22" y2="6" stroke="currentColor" ` +
                `stroke-width="2"${dashAttr}/>` + _marker(shape, 11, 6, fill, opacity));
    }
    items.push(`<li><svg class="doc-chart-swatch" viewBox="0 0 24 12" width="24" ` +
               `height="12" aria-hidden="true" focusable="false">${swatch}</svg>` +
               `${_esc(s.name)}</li>`);
  });
  return `<ul class="doc-chart-legend">${items.join("")}</ul>`;
}

/** The figures as a table, for a reader who cannot see the drawing. */
function _chartTable(c: Chart): string {
  const unit = c.unit ? `（単位：${c.unit}）` : "";
  const head = '<th scope="col"></th>' + c.series.map(
    (s) => `<th scope="col">${_esc(s.name || c.unit)}</th>`).join("");
  const body = c.categories.map((label, i) =>
    `<tr><th scope="row">${_esc(label)}</th>` +
    c.series.map((s) => `<td>${_esc(chartmod.formatValue(s.values[i]))}</td>`).join("") +
    "</tr>",
  ).join("");
  return (`<table class="doc-table doc-chart-data"><caption>${_esc(c.caption)}` +
          `${_esc(unit)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
}

function _chart(block: Block): string {
  const c = chartmod.normalised(block);
  if (c.categories.length === 0 || c.series.length === 0) {
    // Nothing to draw. The title still says a chart was meant to be here.
    return c.caption ? `<p class="doc-p">${_esc(c.caption)}</p>` : "";
  }
  const unit = c.unit ? `<span class="doc-chart-unit">（単位：${_esc(c.unit)}）</span>` : "";
  return (
    `<figure class="doc-chart" data-kind="${_esc(c.kind)}">` +
    `<figcaption class="doc-chart-caption">${_esc(c.caption)}${unit}</figcaption>` +
    `${_legend(c)}${_chartSvg(c)}${_chartTable(c)}</figure>`
  );
}

export const _RENDERERS: Record<string, (b: Block) => string> = {
  heading: _heading,
  paragraph: _paragraph,
  bullets: (b) => _list(b, "ul"),
  numbered: (b) => _list(b, "ol"),
  table: _table,
  key_values: _keyValues,
  quoted_message: _quotedMessage,
  callout: _callout,
  chart: _chart,
};

/** One block. An unknown type renders as nothing rather than raising: a
 *  document is a stimulus a learner is in the middle of reading, and losing one
 *  paragraph beats losing the screen. */
export function renderBlock(block: Block): string {
  const type = str(get(block, "type"));
  const renderer = has(_RENDERERS, type) ? _RENDERERS[type] : null;
  return renderer ? renderer(block) : "";
}

/** A whole document as an HTML fragment — no <html>, no <style>.
 *
 *  A fragment rather than a page because it is embedded: in the app it sits
 *  inside a screen that already owns the page chrome, and in `bjt practice` it
 *  is wrapped by the preview. Styling belongs to whoever embeds it. */
export function render(doc: Record<string, any>): string {
  const templateId = get(doc, "template", "");
  const template = typeof templateId === "string" && has(tpl.TEMPLATES, templateId) ? tpl.TEMPLATES[templateId] : null;
  const label = template ? template.ja : templateId;

  let metaBlock = "";
  if (truthy(get(doc, "meta"))) {
    metaBlock = _keyValues({ pairs: doc["meta"] });
  }

  const body = iterOr(get(doc, "blocks")).filter(isDict).map((b) => renderBlock(b)).join("");

  return (
    `<article class="doc"${_attr("data-template", templateId)}` +
    `${_attr("aria-label", label)}>` +
    "<header class=\"doc-header\">" +
    `<p class="doc-kind">${_esc(label)}</p>` +
    `<h2 class="doc-title">${_esc(get(doc, "title"))}</h2>` +
    `${metaBlock}</header>` +
    `<div class="doc-body">${body}</div>` +
    "</article>"
  );
}

/** A standalone HTML page, for looking at a document while writing one.
 *
 *  Used by `bjt render`. Not what the app consumes — the app takes the fragment
 *  and brings its own theme — so the styling here exists only to make the
 *  fragment readable in a browser, and deliberately matches nothing. */
export function renderPage(doc: Record<string, any>, opts: { title?: string | null } = {}): string {
  const title = opts.title ?? null;
  const style = `
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
    `;
  const headTitle = _esc(or(or(title, get(doc, "title")), "document"));
  return (
    "<!doctype html>\n" +
    '<html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${headTitle}</title><style>${style}</style></head>` +
    `<body>${render(doc)}</body></html>\n`
  );
}
