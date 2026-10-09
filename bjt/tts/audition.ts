/**
 * The listening comparison: the same lines, every cast voice, every provider.
 *
 * The choice of provider is a decision about how the whole library will sound
 * for as long as it exists, and it cannot be made from a spec sheet. What it
 * needs is a native speaker with headphones and five minutes: the same seven
 * lines from each configured provider, laid out side by side, judged on the
 * things that matter for this exam — a name, a date, a number, a business term
 * the dictionary covers, keigo said the way a person says it, and the phone
 * treatment on top of one of them.
 *
 * Nothing here touches a bundle, the database or a bucket. It writes into
 * `media/audition/` and an `index.html` next to the files, which is the whole
 * deliverable: open it and listen. The library's provider is `providers.DEFAULT`.
 *
 * `run` is async: it asks the providers for the clips.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as config from "../config.ts";
import { isDir } from "../files.ts";
import { errText, htmlEscape, isException, or, truthy } from "../py.ts";
import * as channelMod from "./channel.ts";
import { NARRATOR_VOICE } from "./plan.ts";
import { available, directionFor, getProvider, OpenAIProvider } from "./providers.ts";
import type { Provider } from "./providers.ts";

/** One line per cast voice. Original compositions, in the register the role
 *  speaks in, each carrying something a TTS model can get wrong: a surname, a
 *  time, a counted number, a dictionary reading (代替, 早急), a set phrase. */
export const LINES: [string, string, string][] = [
  [NARRATOR_VOICE, "in_person",
   "取引先の担当者から、上司の田中部長あてに電話がかかってきました。"
   + "田中部長は外出していて、三時ごろ戻る予定です。こんなとき、何と言いますか。"],
  ["staff_junior_m", "in_person",
   "お世話になっております。山田商事の佐藤でございます。"
   + "恐れ入りますが、営業部の田中様はいらっしゃいますでしょうか。"],
  ["staff_junior_f", "in_person",
   "お忙しいところ恐れ入ります。明日の会議の資料を、お目通しいただけますでしょうか。"],
  ["staff_mid_m", "in_person",
   "申し訳ございません。田中はただいま外出しておりまして、三時ごろ戻る予定でございます。"
   + "戻りましたら、こちらからご連絡いたしましょうか。"],
  ["staff_mid_f", "in_person",
   "来週の十五日、午後二時からでしたら、会議室が空いております。ご都合はいかがでしょうか。"],
  ["manager_m", "in_person",
   "この件は早急に対応してください。代替案を三つ、明日の朝までにまとめてもらえますか。"],
  ["reception_f", "in_person",
   "いらっしゃいませ。恐れ入りますが、お名前とご用件をお伺いしてもよろしいでしょうか。"],
  // The same utterance again down a telephone line: the treatment is part of
  // what is being judged, because a phone item that sounds like a studio
  // recording is an easier question than the exam asks.
  ["staff_mid_m", "phone",
   "申し訳ございません。田中はただいま外出しておりまして、三時ごろ戻る予定でございます。"
   + "戻りましたら、こちらからご連絡いたしましょうか。"],
];


export class AuditionReport {
  root: string;
  providers: string[];
  written: string[];
  failed: [string, string, string][]; // provider, voice, why

  constructor(init: { root: string; providers?: string[]; written?: string[]; failed?: [string, string, string][] }) {
    this.root = init.root;
    this.providers = init.providers ?? [];
    this.written = init.written ?? [];
    this.failed = init.failed ?? [];
  }

  summary(): string {
    const parts = [`${this.written.length} clip(s) written for ${or(this.providers.join(", "), "nobody")}`];
    if (this.failed.length) {
      parts.push(`${this.failed.length} FAILED`);
    }
    return parts.join("; ");
  }
}


export function fileName(voice: string, channel: string): string {
  return channel === "in_person" ? `${voice}.wav` : `${voice}.${channel}.wav`;
}


/** For `--voices`: one line said by every voice the chosen provider offers, so
 *  a role can be recast by ear. A mid-career line rather than the narration,
 *  because register is what the cast is about. */
export const VOICES_LINE = LINES[3][2];


/** Synthesise every line through every named provider (default: all that
 *  have credentials) and write the comparison page. With `voices`, also every
 *  candidate voice of the library's provider saying one line. */
export async function run(opts: { providers?: string[] | null; mediaDir?: string | null;
                                  force?: boolean; voices?: boolean } = {}): Promise<AuditionReport> {
  const force = opts.force ?? false;
  const voices = opts.voices ?? false;
  const names = opts.providers ?? available();
  const root = path.join(truthy(opts.mediaDir) ? opts.mediaDir! : config.MEDIA_DIR, "audition");
  const report = new AuditionReport({ root, providers: [...names] });

  if (voices) {
    const openai = new OpenAIProvider();
    for (const candidate of OpenAIProvider.CANDIDATE_VOICES) {
      const dest = path.join(root, "openai-voices", `${candidate}.wav`);
      if (existsSync(dest) && !force) {
        report.written.push(dest);
        continue;
      }
      let raw: Uint8Array;
      try {
        // Every candidate is asked for as staff_mid_m so the direction is
        // the same; only the voice id differs.
        raw = await openai.synthesize(VOICES_LINE, "staff_mid_m",
                                      { instructions: directionFor("staff_mid_m"),
                                        providerVoice: candidate });
      } catch (exc) { // a vendor error is a result, not a crash
        if (!isException(exc)) throw exc;
        report.failed.push(["openai-voices", candidate, errText(exc)]);
        continue;
      }
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, channelMod.applyChannel(raw, "in_person"));
      report.written.push(dest);
    }
  }

  for (const name of names) {
    const provider: Provider = getProvider(name);
    for (const [voice, channel, text] of LINES) {
      const dest = path.join(root, provider.name, fileName(voice, channel));
      if (existsSync(dest) && !force) {
        report.written.push(dest);
        continue;
      }
      let processed: Uint8Array;
      try {
        const raw = await provider.synthesize(text, voice, { instructions: directionFor(voice) });
        processed = channelMod.applyChannel(raw, channel);
      } catch (exc) { // one provider's outage must not hide the others
        if (!isException(exc)) throw exc;
        report.failed.push([provider.name, voice, errText(exc)]);
        continue;
      }
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, processed);
      report.written.push(dest);
    }
  }

  mkdirSync(path.dirname(path.join(root, "index.html")), { recursive: true });
  writeFileSync(path.join(root, "index.html"), page(report), "utf8");
  return report;
}


/** One table: a row per line, a column per provider. Static HTML, no script,
 *  so it opens from the file system. */
export function page(report: AuditionReport): string {
  const cols = report.providers;
  const failed = new Set(report.failed.map(([p, v]) => JSON.stringify([p, v])));
  const rows: string[] = [];
  for (const [voice, channel, text] of LINES) {
    const cells: string[] = [];
    for (const name of cols) {
      const rel = `${name}/${fileName(voice, channel)}`;
      if (failed.has(JSON.stringify([name, voice])) && !existsSync(path.join(report.root, rel))) {
        cells.push('<td class="x">failed</td>');
      } else {
        cells.push(`<td><audio controls preload="none" src="${htmlEscape(rel)}"></audio></td>`);
      }
    }
    const label = channel === "in_person" ? voice : `${voice} · ${channel}`;
    rows.push(
      `<tr><th>${htmlEscape(label)}</th><td class="t">${htmlEscape(text)}</td>${cells.join("")}</tr>`,
    );
  }
  const head = cols.map((c) => `<th>${htmlEscape(c)}</th>`).join("");
  let voices = "";
  if (isDir(path.join(report.root, "openai-voices"))) {
    const items = OpenAIProvider.CANDIDATE_VOICES
      .filter((v) => existsSync(path.join(report.root, "openai-voices", `${v}.wav`)))
      .map((v) => `<tr><th>${htmlEscape(v)}</th>`
                  + `<td><audio controls preload="none" src="openai-voices/${htmlEscape(v)}.wav"></audio></td></tr>`)
      .join("");
    voices = (`<h2>Every OpenAI voice, one line</h2><p>${htmlEscape(VOICES_LINE)}</p>`
              + `<table><tbody>${items}</tbody></table>`);
  }
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Audition</title>
<style>
 body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; color: #222; }
 table { border-collapse: collapse; }
 th, td { border-bottom: 1px solid #ddd; padding: .6rem .8rem; text-align: left; vertical-align: top; }
 th { white-space: nowrap; }
 td.t { max-width: 28rem; }
 td.x { color: #b00; }
 audio { width: 16rem; }
</style></head><body>
<h1>Audition</h1>
<p>The same lines from each provider. Judge names, dates, numbers, the dictionary readings
(代替・早急), keigo said the way a person says it, and the telephone treatment on the last row —
not a general sense of "nice". The library's voice is OpenAI; the other columns are for comparison.</p>
<table><thead><tr><th>voice</th><th>line</th>${head}</tr></thead>
<tbody>${rows.join("")}</tbody></table>
${voices}
</body></html>
`;
}
