/**
 * Every word the given questions carry notes for, in one list, each with a
 * sentence it is used in. The app gives it the questions a learner has
 * answered (`fetchWordList`).
 *
 * Nothing here is written for the list. The words, readings and meanings are
 * the `vocab_notes` each item shipped with, and the sentence is a line of a
 * question — a turn of its conversation, its stem, its document, its correct
 * answer — found by looking for the word. A fill-in-the-blank stem is completed
 * with the correct option, never a wrong one: a distractor is wrong Japanese on
 * purpose, and an example sentence built from one would teach exactly the
 * mistake it exists to catch. A word with no line to point at simply has no
 * sentence.
 *
 * Furigana comes from the same notes. There is no dictionary in the app, so a
 * sentence's words are annotated only where the bank has a reading for them —
 * which is the vocabulary a learner came here for anyway.
 *
 * Plain functions, so `npm test` can hold them without a device.
 */
import type { DocBlock, Level, Section, StimulusDocument, VocabNote } from "./types";

/** The slice of an item this list reads. */
export type WordSourceItem = {
  id: string;
  level: Level;
  section: Section;
  stem: string;
  dialogue: { text: string }[];
  documents: StimulusDocument[];
  vocab_notes: VocabNote[];
  /** The correct option's text, for completing a blank in the stem. */
  correct_text: string | null;
};

export type WordEntry = VocabNote & {
  /** Every level and section of a question carrying this note. */
  levels: Level[];
  sections: Section[];
  /** The two together, one per question kind, so a filter on both at once
   *  matches a question that is both rather than one of each. */
  places: { level: Level; section: Section }[];
  /** A line from a question that uses the word, or null when none does. */
  sentence: string | null;
};

/** A run of text, with a reading to print above it when it has one. */
export type RubySegment = { text: string; ruby?: string };

const KANJI = /[㐀-鿿豈-﫿々〆ヵヶ]/;
const BLANK = /[＿_]{2,}|（\s*）|\(\s*\)/;

function hasKanji(s: string): boolean {
  return KANJI.test(s);
}

/** Katakana folded to hiragana, for comparing a term with its reading and for search. */
function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** For search: case, width and kana folded so 「ヒキツギ」 finds 引き継ぎ's reading. */
export function fold(s: string): string {
  return toHiragana(s.normalize("NFKC").toLowerCase());
}

/**
 * A term cut into ruby segments by its reading: the kana it shares with the
 * reading stays bare and each kanji run gets its own reading — 引き継ぎ /
 * ひきつぎ is 引(ひ) き 継(つ) ぎ. When the reading cannot be aligned that way
 * the whole term takes the whole reading, which is still right, only coarser.
 */
export function furigana(term: string, reading: string): RubySegment[] {
  if (!hasKanji(term) || !reading) return [{ text: term }];
  // Runs of kanji (anything not kana) and runs of kana, in order.
  const runs = term.match(/[ぁ-ゟァ-ヿー]+|[^ぁ-ゟァ-ヿー]+/g) ?? [term];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = runs
    .map((run) => (hasKanji(run) ? "(.+?)" : `(${escape(toHiragana(run))})`))
    .join("");
  const match = new RegExp(`^${pattern}$`).exec(toHiragana(reading));
  if (!match) return [{ text: term, ruby: reading }];
  return runs.map((run, i) => (hasKanji(run) ? { text: run, ruby: match[i + 1] } : { text: run }));
}

/** A word as searched for: the term itself, or what is left of a verb once its
 *  ending is gone, which only counts when a kana ending follows it. */
type Needle = { find: string; inflected: boolean };

/** Particles that end a noun rather than a verb: 会 before の is 会議's 会 or
 *  a noun, never 会う. Only asked of a one-kanji stem. */
const PARTICLES = new Set([..."のはがをにでともへやか"]);

function matchesAt(text: string, i: number, n: Needle): boolean {
  if (!text.startsWith(n.find, i)) return false;
  if (!n.inflected) return true;
  const next = text[i + n.find.length] ?? "";
  return /[ぁ-ゖ]/.test(next) && (n.find.length >= 2 || !PARTICLES.has(next));
}

function includesNeedle(text: string, n: Needle): boolean {
  for (let i = text.indexOf(n.find); i >= 0; i = text.indexOf(n.find, i + 1)) {
    if (matchesAt(text, i, n)) return true;
  }
  return false;
}

/** A term as it is looked for: a note's leading or trailing 〜 marks where the
 *  rest of the sentence goes and is never in the sentence itself. */
function bare(term: string): string {
  return term.replace(/^[〜～~]+|[〜～~]+$/g, "");
}

function needlesOf(term: string): Needle[] {
  const find = bare(term);
  const stem = conjugationStem(find);
  return [{ find, inflected: false }, ...(stem ? [{ find: stem, inflected: true }] : [])];
}

type Candidate = { needle: Needle; segments: RubySegment[] };

/**
 * A sentence cut into ruby segments, annotating every word the bank has a
 * reading for. Longest term first, so 引き継ぎ書 is not read as 引き継ぎ + 書.
 * A verb is also found by its stem when a kana ending follows it (すり合わせる
 * in すり合わせてまいりました, 伺う in 伺っております).
 *
 * One sentence against one list. The word list annotates forty sentences
 * against the same thousand notes on every keystroke of a search, so it keeps
 * an annotator (`makeAnnotator`) instead, which does the preparation once.
 */
export function annotate(sentence: string, notes: VocabNote[]): RubySegment[] {
  return makeAnnotator(notes)(sentence);
}

/**
 * `annotate`, with the notes prepared once and each sentence's answer kept.
 *
 * Preparing is the expensive half: a candidate per term and per verb stem,
 * sorted longest first. It is done here once per list. The candidates are
 * then filed by their first character, since a word can only start where the
 * sentence has that character — so each position in a sentence asks the
 * handful that could match rather than all of them, in the same longest-first
 * order, and gets the same answer. A sentence already annotated is answered
 * from memory: the list redraws on every keystroke, the sentences do not
 * change.
 */
export function makeAnnotator(notes: VocabNote[]): (sentence: string) => RubySegment[] {
  const byFirst = new Map<string, Candidate[]>();
  for (const c of candidatesOf(notes)) {
    const first = c.needle.find[0];
    const list = byFirst.get(first);
    if (list) list.push(c);
    else byFirst.set(first, [c]);
  }
  const memo = new Map<string, RubySegment[]>();
  return (sentence) => {
    const known = memo.get(sentence);
    if (known) return known;
    const out = segmentsOf(sentence, byFirst);
    memo.set(sentence, out);
    return out;
  };
}

/** Every term and verb stem worth looking for, longest first. */
function candidatesOf(notes: VocabNote[]): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    const term = bare(note.term);
    if (!hasKanji(term) || seen.has(term)) continue;
    seen.add(term);
    const segments = furigana(term, bare(note.reading));
    for (const needle of needlesOf(term)) {
      if (!needle.inflected) {
        candidates.push({ needle, segments });
        continue;
      }
      // Keep the segments that cover the stem, trimming the last to fit.
      let left = needle.find.length;
      const cut: RubySegment[] = [];
      for (const seg of segments) {
        if (left <= 0) break;
        if (seg.text.length <= left) cut.push(seg);
        else if (!seg.ruby) cut.push({ text: seg.text.slice(0, left) });
        else break; // would split a kanji run from its reading
        left -= seg.text.length;
      }
      if (left <= 0) candidates.push({ needle, segments: cut });
    }
  }
  candidates.sort((a, b) => b.needle.find.length - a.needle.find.length);
  return candidates;
}

/** The walk along one sentence, asking at each position only the candidates
 *  that start with the character there. */
function segmentsOf(sentence: string, byFirst: Map<string, Candidate[]>): RubySegment[] {
  const out: RubySegment[] = [];
  let plain = "";
  let i = 0;
  outer: while (i < sentence.length) {
    for (const c of byFirst.get(sentence[i]) ?? []) {
      if (matchesAt(sentence, i, c.needle)) {
        if (plain) out.push({ text: plain });
        plain = "";
        out.push(...c.segments);
        i += c.needle.find.length;
        continue outer;
      }
    }
    plain += sentence[i];
    i += 1;
  }
  if (plain) out.push({ text: plain });
  return out;
}

/** A term without its trailing kana, when a kanji is left; otherwise null. */
export function conjugationStem(term: string): string | null {
  const stem = term.replace(/[ぁ-ゖ]+$/, "");
  return stem !== term && hasKanji(stem) ? stem : null;
}

function blockLines(block: DocBlock): string[] {
  const out: string[] = [];
  if (block.text) out.push(block.text);
  if (block.items) out.push(...block.items);
  if (block.pairs) out.push(...block.pairs.map((p) => p.value));
  return out;
}

/** The lines of an item a word may be shown in, in the order they are preferred. */
export function linesOf(item: WordSourceItem): string[] {
  const blank = Boolean(item.correct_text) && BLANK.test(item.stem);
  const stem = blank ? item.stem.replace(BLANK, item.correct_text!) : item.stem;
  return [
    ...item.dialogue.map((turn) => turn.text),
    stem,
    ...item.documents.flatMap((doc) => doc.blocks.flatMap(blockLines)),
    // Last: the correct option on its own, which in the spoken types is a
    // whole utterance. Already inside the stem when it filled a blank.
    ...(blank ? [] : [item.correct_text ?? ""]),
  ].filter(Boolean);
}

/** A quotation mark left open or closed by cutting a sentence out of a line. */
function unpaired(s: string): string {
  if (s.startsWith("「") && !s.includes("」")) s = s.slice(1);
  if (s.endsWith("」") && !s.includes("「")) s = s.slice(0, -1);
  return s.trim();
}

function sentenceFor(line: string, needle: Needle): string | null {
  if (!includesNeedle(line, needle)) return null;
  const parts = (line.match(/[^。！？!?\n]+[。！？!?」]*/g) ?? []).map((p) => p.trim()).filter(Boolean);
  return unpaired(parts.find((p) => includesNeedle(p, needle)) ?? line.trim());
}

/** The one sentence of a line that holds the word, or null. */
export function sentenceWith(line: string, term: string): string | null {
  for (const needle of needlesOf(term)) {
    const s = sentenceFor(line, needle);
    if (s) return s;
  }
  return null;
}

/** The word as written anywhere in these questions before its stem anywhere. */
function findSentence(term: string, items: WordSourceItem[]): string | null {
  for (const needle of needlesOf(term)) {
    for (const item of items) {
      for (const line of linesOf(item)) {
        const s = sentenceFor(line, needle);
        if (s) return s;
      }
    }
  }
  return null;
}

const LEVEL_ORDER: Level[] = ["J1", "J2", "J3"];
const SECTION_ORDER: Section[] = ["choukai", "choudokkai", "dokkai"];

/**
 * One entry per term across the bank. A term noted by several questions keeps
 * the first note's reading and meaning and every question's level and section;
 * its sentence comes from a question that noted it where one uses it, and from
 * any other question in the list otherwise.
 */
export function buildWordList(items: WordSourceItem[]): WordEntry[] {
  const byTerm = new Map<string, { note: VocabNote; items: WordSourceItem[] }>();
  for (const item of items) {
    for (const note of item.vocab_notes ?? []) {
      const term = note.term?.trim();
      if (!term) continue;
      const had = byTerm.get(term);
      if (had) had.items.push(item);
      else byTerm.set(term, { note: { ...note, term }, items: [item] });
    }
  }
  const out: WordEntry[] = [];
  for (const { note, items: own } of byTerm.values()) {
    const others = items.filter((i) => !own.includes(i));
    out.push({
      ...note,
      levels: LEVEL_ORDER.filter((l) => own.some((i) => i.level === l)),
      sections: SECTION_ORDER.filter((s) => own.some((i) => i.section === s)),
      places: [...new Set(own.map((i) => `${i.level}:${i.section}`))].map((key) => {
        const [level, section] = key.split(":");
        return { level: level as Level, section: section as Section };
      }),
      sentence: findSentence(note.term, own) ?? findSentence(note.term, others),
    });
  }
  return out.sort((a, b) => fold(a.reading || a.term).localeCompare(fold(b.reading || b.term), "ja"));
}

type WordFilter = { query: string; level: Level | null; section: Section | null };

export function filterWords(words: WordEntry[], f: WordFilter): WordEntry[] {
  const q = fold(f.query.trim());
  return words.filter(
    (w) =>
      w.places.some((p) => (!f.level || p.level === f.level) && (!f.section || p.section === f.section)) &&
      (!q || fold(w.term).includes(q) || fold(w.reading).includes(q) || fold(w.meaning).includes(q))
  );
}
