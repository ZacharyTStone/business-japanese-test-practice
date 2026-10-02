/**
 * Document stimuli: the data model, the templates, and the renderer.
 *
 * The four reading and listening-reading types put a business document in front of
 * the learner. It is **data**, never a picture — see `html.ts` for why that is
 * not a preference.
 *
 *     import * as render from "./render/index.ts";
 *
 *     render.validateDocument(doc)      // problems with a document, [] == valid
 *     render.render(doc)                // -> an HTML fragment for the app
 *     render.renderPage(doc)            // -> a standalone page, for looking at it
 *     render.documentSchema()           // -> the schema the model emits against
 *     render.toArabic(doc)              // spelled-out numbers -> digits, in place
 *     render.documentFaults(doc)        // the numbers still spelled out, [] == clean
 *     render.TEMPLATES                  // -> the nine templates
 *     render.chart                      // the graph block: bounds, text, axis
 *
 * The submodules are reachable as Python's package attributes were:
 * `render.chart`, `render.document`, `render.numerals`, `render.html`,
 * `render.templates`.
 */
export * as chart from "./chart.ts";
export * as document from "./document.ts";
export * as numerals from "./numerals.ts";
export * as html from "./html.ts";
export * as templates from "./templates.ts";
export {
  BLOCK_TYPES,
  CALLOUT_TONES,
  CHART_KINDS,
  documentSchema,
  dropUnusedFields,
  pruneEmptyBlocks,
  textOf,
  validateDocument,
} from "./document.ts";
export {
  COUNTERS,
  documentFaults,
  kanjiNumbersIn,
  toArabic,
  toArabicText,
} from "./numerals.ts";
export { render, renderBlock, renderPage } from "./html.ts";
export { TEMPLATES, Template, forItemType, spec } from "./templates.ts";
