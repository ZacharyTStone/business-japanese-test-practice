/** Audio and pictures: `synth` (bjt/tts/synth.ts), `audition`, `scenes`
 *  (bjt/scenes.ts, bjt/scene_art.ts) and `render` (a document to HTML). */
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as batchmod from "../batch.ts";
import * as config from "../config.ts";
import * as fixtures from "../fixtures.ts";
import * as pipeline from "../pipeline.ts";
import * as render from "../render/index.ts";
import * as schemas from "../schemas.ts";
import * as scenemod from "../scenes.ts";
import * as withdrawn from "../withdrawn.ts";
import * as scene_art from "../scene_art.ts";
import * as providers from "../tts/providers.ts";
import * as synth from "../tts/synth.ts";
import * as audition from "../tts/audition.ts";
import { writeAtomic } from "../files.ts";
import { GENERATORS } from "../generators/index.ts";
import { eprint, errText, has, IndexError, isDict, KeyError, len, pathStr, print, repr, RuntimeError, sorted, str, truthy, ValueError } from "../py.ts";
import type { Namespace, SubParsers } from "./argparse.ts";


/** `f"{s:<{width}}"`, by code point. */
function _ljust(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - len(s)));
}

/** `f"{s:>{width}}"`, by code point. */
function _rjust(s: string, width: number): string {
  return " ".repeat(Math.max(0, width - len(s))) + s;
}

/** `items[i]`, negative counting from the end, as a Python list indexes. */
function _at<T>(items: readonly T[], i: number): T {
  const j = i < 0 ? i + items.length : i;
  if (j < 0 || j >= items.length) {
    throw new IndexError("list index out of range");
  }
  return items[j];
}


/**
 * Bundle → audio files + the SQL that points the database at them.
 *
 * Producing files and producing SQL are the job. Uploading is opt-in
 * (`--upload`) and applying the SQL stays a separate act, so on a laptop no
 * key that can write media has to exist, and in the deploy workflow — the
 * one place all three happen together — each step is still its own line.
 */
export async function cmdSynth(args: Namespace): Promise<number> {
  const bundlePath = pathStr(args.path);
  const bundle = batchmod.load(bundlePath);
  const report = batchmod.checkBundle(bundle);
  if (!report.ok && !args.force) {
    pipeline.printBundleReport(bundle, report);
    eprint("\nRefusing to synthesise audio for a bundle that fails its own checks.");
    eprint("A clip is expensive and permanent; an item that has not cleared its "
           + "gates has no business having a voice recorded for it.");
    return 1;
  }

  let provider: providers.Provider;
  try {
    provider = providers.getProvider(args.provider);
  } catch (exc) {
    if (!(exc instanceof KeyError)) throw exc;
    eprint(errText(exc));
    return 2;
  }

  let bucket: scene_art.Bucket | null = null;
  if (args.upload) {
    if (provider.name === "silent") {
      eprint("--upload with the silent provider would ship silence: a learner would "
             + "hear nothing where the app now shows the text. Refusing.");
      return 2;
    }
    if (!args.have) {
      // Without the database's list of live clips, an empty media/ makes
      // every clip look new: all of them re-synthesised, and each one's
      // duration rewritten from a recording nobody hears.
      eprint("--upload needs --have: the clip ids already live, one per line, read "
             + "out of the database (an empty file on a fresh project). A live clip is "
             + "never re-made.");
      return 2;
    }
    bucket = new scene_art.Bucket({ name: "audio" });
    if (!bucket.configured) {
      eprint("--upload needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in the environment");
      return 2;
    }
  }

  const have = args.have ? synth.readHave(args.have) : null;
  const remake = args.remake ? synth.readHave(args.remake) : null;
  if (remake !== null && remake.size) {
    print(`Re-making ${remake.size} named clip(s) if this bundle asks for them — `
          + "the recording a learner already heard is being replaced.");
  }

  const run = await synth.run(bundle, { provider, bucket, mediaDir: args.media_dir,
                                        force: args.force_clips, limit: args.limit, have, remake });
  const [result, up] = [run.report, run.uploaded];
  if (run.skipped) {
    print(`Skipping ${run.skipped} clip(s) only withdrawn items use `
          + `(batches/${withdrawn.LEDGER_NAME}).`);
  }

  print(result.summary());
  for (const [clipId, error] of result.failed) {
    eprint(`  FAILED ${clipId}: ${error}`);
  }

  if (provider.name === "silent") {
    print();
    print("  These are SILENT placeholder clips. They exercise the pipeline — "
          + "planning,\n  channel treatment, durations, the SQL — and prove nothing "
          + "about how the\n  Japanese sounds. Their storage path says `silent/` so "
          + "they can never be\n  mistaken for real recordings. Set GEMINI_API_KEY or "
          + "OPENAI_API_KEY for\n  real voices; `bjt audition` compares them.");
  }

  if (bucket !== null && up !== null) {
    print(`uploaded ${up.sent.length} clip(s) to the \`${bucket.name}\` bucket`);
    if (up.existing.length) {
      print(`${up.existing.length} clip(s) were already in the bucket; left alone and `
            + "counted as live");
    }
    for (const [clipPath, why] of up.failed) {
      eprint(`not uploaded: ${clipPath}: ${why}`);
    }
  }

  if (!result.clips.length && !result.live.length) {
    return 0;
  }

  const out = args.out ? pathStr(args.out)
    : path.join(path.dirname(bundlePath), scene_art._stem(bundlePath) + ".audio.sql");
  writeAtomic(out, synth.toSql(result));
  print(`\nWrote ${out}`);

  const record = path.join(truthy(args.media_dir) ? args.media_dir : config.MEDIA_DIR,
                           "reports", `${scene_art._stem(bundlePath)}.json`);
  synth.writeReport(result, record);
  print(`Wrote ${record}`);

  if (result.clips.length) {
    print();
    if (bucket === null) {
      print("Next: upload media/audio/** to the `audio` bucket (or re-run with "
            + "--upload), then apply the SQL:");
    } else {
      print("Next: apply the SQL:");
    }
    print(`  (cd client && npx wrangler d1 execute business-japanese-drill --remote --file ${path.resolve(out)})`);
  }
  return result.failed.length ? 1 : 0;
}


/** The same lines, every cast voice, every configured provider — for a
 *  person to listen to before the library is synthesised. */
export async function cmdAudition(args: Namespace): Promise<number> {
  const names: string[] = truthy(args.provider) ? args.provider : providers.available();
  if (!names.length && !args.voices) {
    eprint("No TTS provider is configured. Set one of:");
    for (const [name, keys] of Object.entries(providers.CREDENTIALS)) {
      eprint(`  ${_ljust(name, 8)} ${keys.join(" or ")}`);
    }
    eprint("(`--provider silent` exercises the page with silent clips.)");
    return 2;
  }
  const unknown = sorted(new Set(names.filter((n) => !has(providers.PROVIDERS, n))));
  if (unknown.length) {
    eprint(`unknown provider(s): ${unknown.join(", ")}; `
           + `available: ${repr(sorted(Object.keys(providers.PROVIDERS)))}`);
    return 2;
  }

  const report = await audition.run({ providers: names, mediaDir: args.media_dir, force: args.force,
                                      voices: args.voices });
  print(report.summary());
  for (const [name, voice, why] of report.failed) {
    eprint(`  FAILED ${name} ${voice}: ${why}`);
  }
  print(`\nOpen ${path.join(report.root, "index.html")} and listen.`);
  if (args.voices) {
    print(`Every ${providers.DEFAULT} voice saying one line is under `
          + `${path.join(report.root, "openai-voices")}; a recast goes in OpenAIProvider.VOICE_IDS.`);
  }
  return report.failed.length ? 1 : 0;
}


/** What the scene bank needs, what exists, the drawing of what is missing,
 *  and the SQL for what is approved. */
export async function cmdScenes(args: Namespace): Promise<number> {
  // The bucket is consulted whenever it is configured: on the nightly runner
  // media/ is empty every night, and the only record of what has already
  // been drawn is the bucket itself.
  const bucket = new scene_art.Bucket();
  let remote = new Set<string>();
  if (bucket.configured && (args.generate !== null || args.upload || args.sql)) {
    try {
      remote = await bucket.list();
    } catch (exc) {
      if (!(exc instanceof RuntimeError)) throw exc;
      eprint(`could not list the scenes bucket: ${errText(exc)}`);
      return 1;
    }
  } else if (args.upload) {
    eprint("--upload needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in the environment");
    return 2;
  }

  let survey = scenemod.survey({ mediaDir: args.media_dir, remote });

  if (args.prompt) {
    const wanted = survey.filter((s) => s.scene_id === args.prompt);
    if (!wanted.length) {
      eprint(`no scene ${repr(args.prompt)} in any committed seed table`);
      return 2;
    }
    print(scenemod.promptFor(wanted[0]));
    return 0;
  }

  let failed = false;
  if (args.generate !== null) {
    let provider: scene_art.ImageProvider;
    try {
      provider = scene_art.getProvider(args.provider);
    } catch (exc) {
      if (!(exc instanceof KeyError)) throw exc;
      eprint(errText(exc));
      return 2;
    }
    let wanted: scenemod.Scene[];
    try {
      wanted = scene_art.select(survey, { names: args.generate, force: args.force, only: args.only });
    } catch (exc) {
      if (!(exc instanceof ValueError)) throw exc;
      eprint(errText(exc));
      return 2;
    }
    const [prior, onReject, warning] = await scene_art.lifetimeLedger(bucket, { record: args.upload });
    if (warning) {
      eprint(warning);
    }
    if (!wanted.length) {
      const note = "every scene already has artwork; nothing to draw (--force redraws)";
      print(note);
      // The summary file is a promise to the workflow, which appends it to
      // the run page whatever happened. A night with nothing to draw is
      // the ordinary night once the bank is full, and it must not be the
      // night the job fails on a missing file.
      if (args.summary) {
        writeFileSync(args.summary, `## Scene artwork (${provider.name})\n\n${note}\n`, "utf8");
      }
    } else {
      let result: scene_art.DrawResult;
      try {
        result = await scene_art.draw(wanted, {
          provider, review: scene_art.reviewWithModel,
          mediaDir: args.media_dir, attempts: args.attempts,
          prior, onReject,
        });
      } catch (stop) {
        if (!(stop instanceof scene_art.DrawStopped)) throw stop;
        // The ceiling: nothing more is drawn, and what was approved
        // before it is still uploaded and pointed at below.
        eprint(`stopping the drawing: ${errText(stop)}`);
        result = stop.result;
      }
      print(result.summary());
      if (args.summary) {
        writeFileSync(args.summary, result.summary() + "\n", "utf8");
      }
      failed = result.failed.length > 0 || result.stopped !== null;
      if (!provider.real) {
        print("\n  placeholder provider: files are under media/scenes/placeholder/,");
        print("  the survey does not count them, and nothing uploads them.");
      }
      survey = scenemod.survey({ mediaDir: args.media_dir, remote });
    }
  }

  if (args.upload) {
    const up = await scene_art.uploadApproved(survey, bucket, { mediaDir: args.media_dir });
    print(`uploaded ${up.sent.length} file(s) to the \`${bucket.name}\` bucket`
          + (up.sent.length ? ": " + up.sent.join(", ") : ""));
    for (const [p, why] of up.failed) {
      eprint(`not uploaded: ${p}: ${why}`);
    }
    if (up.failed.length) {
      failed = true;
      if (args.summary) {
        appendFileSync(args.summary, "\n" + up.summary() + "\n", "utf8");
      }
      // The SQL below must describe the bucket, not this machine.
      survey = scene_art.without(survey, up.failed_paths);
    }
  }

  const have = survey.filter((s) => s.has_art);

  if (args.sql) {
    const out = args.out ? pathStr(args.out) : path.join(config.ROOT, "batches", "scenes.sql");
    writeAtomic(out, scenemod.toSql(survey));
    const standIns: [scenemod.Scene, scenemod.Scene | null][] = survey.map((s) => [s, scenemod.standInFor(s, survey)]);
    const borrowed = standIns.filter((pair): pair is [scenemod.Scene, scenemod.Scene] => pair[1] !== null);
    print(`Wrote ${out}  (${have.length} scene(s) with artwork`
          + (borrowed.length ? `, ${borrowed.length} on a stand-in` : "") + ")");
    if (args.summary && borrowed.length) {
      let text = "\n### Stand-ins\n\n";
      for (const [s, o] of borrowed) {
        text += `- \`${s.scene_id}\` shows \`${o.scene_id}\`'s picture until its own is drawn.\n`;
      }
      appendFileSync(args.summary, text, "utf8");
    }
    return failed ? 1 : 0;
  }

  if (args.generate !== null || args.upload) {
    return failed ? 1 : 0;
  }

  print(`scene bank: ${survey.length} scene(s), ${have.length} with artwork\n`);
  print(`  ${_ljust("scene_id", 32)} ${_ljust("art", 4)} ${_rjust("cells", 6)}  used by`);
  for (const scene of survey) {
    const other = scenemod.standInFor(scene, survey);
    const mark = scene.has_art ? "yes" : (other ? "↪" : "—");
    print(`  ${_ljust(scene.scene_id, 32)} ${_ljust(mark, 4)} ${_rjust(str(scene.cell_count), 6)}  `
          + `${scene.used_by.join("、")}`
          + (other ? `  (shows ${other.scene_id})` : "")
          + (scene.is_picture ? "  [per-item picture]" : ""));
  }
  if (!have.length) {
    print("\n  No artwork yet. Items ship and are practised without pictures —");
    print("  except 画像把握, whose items wait for their own picture.");
    print("  `bjt scenes --generate` draws the missing ones and reviews each draft;");
    print("  `bjt scenes --prompt <scene_id>` prints the brief for one.");
  }
  return 0;
}


/** Render a document stimulus to HTML, to look at while writing one. */
export async function cmdRender(args: Namespace): Promise<number> {
  let item: Record<string, any> | null = null;
  if (args.chart ?? false) {
    // The worked example of a document with a graph in it, which no type's
    // own fixture carries: a 資料聴読解 item on the `figures` template.
    item = fixtures.CHART_FIXTURE;
  } else if (args.item_type) {
    item = has(fixtures.FIXTURES, args.item_type) ? fixtures.FIXTURES[args.item_type] : null;
    if (item === null) {
      eprint(`no fixture for ${repr(args.item_type)}`);
      return 2;
    }
  } else {
    const bundle = batchmod.load(pathStr(args.path));
    const items = (bundle["items"] as Record<string, any>[]).filter((i) => truthy(i["documents"] ?? null));
    if (!items.length) {
      eprint("no document items in that bundle");
      return 2;
    }
    item = _at(items, Math.min(args.index, items.length - 1));
  }

  const field = schemas.documentField(item["item_type"] ?? "");
  const documents = item["documents"] ?? null;
  const raw = truthy(documents) ? documents : (field ? [item[field] ?? null] : []);
  const docs = (Array.isArray(raw) ? raw : [raw]).filter(isDict);
  if (!docs.length) {
    eprint("that item has no document");
    return 2;
  }

  const html = docs.map((d) => (args.page ? render.renderPage(d) : render.render(d))).join("\n");
  if (args.out) {
    writeFileSync(args.out, html, "utf8");
    print(`Wrote ${str(args.out)}`);
  } else {
    print(html);
  }
  return 0;
}


/** Add this module's subcommands to the `bjt` parser. */
export function register(sub: SubParsers, types: string[]): void {
  const sy = sub.addParser("synth", { help: "synthesise a bundle's audio and write the SQL for it" });
  sy.addArgument("path", { help: "path to a checked bundle .json" });
  sy.addArgument("--provider", { default: "auto",
                                 help: "TTS backend: auto (BJT_TTS_PROVIDER, else the library's voice "
                                       + "when its key is set, else silent), or a provider by name; "
                                       + "silent is an offline placeholder" });
  sy.addArgument("--have", { metavar: "FILE",
                             help: "clip ids already live (one per line): skipped entirely. "
                                   + "The deploy workflow reads them out of the database" });
  sy.addArgument("--remake", { metavar: "FILE",
                               help: "clip ids (one per line) to synthesise again even though they "
                                     + "are live: for replacing clips made with the wrong delivery. "
                                     + "Named clips only — never a blanket re-make of the library" });
  sy.addArgument("--upload", { action: "store_true",
                               help: "put the clips in the `audio` bucket "
                                     + "(needs --have and the R2_* credentials); never over "
                                     + "a file already there but the ones --remake names" });
  sy.addArgument("--out", { help: "where to write the SQL (default: alongside the bundle)" });
  sy.addArgument("--media-dir", { type: pathStr,
                                  help: `where audio files go (default: ${pathStr(config.MEDIA_DIR)})` });
  sy.addArgument("--limit", { type: "int",
                              help: "cap how many NEW clips this run may make — a budget, not a "
                                    + "debugging convenience" });
  sy.addArgument("--force-clips", { action: "store_true",
                                    help: "re-synthesise clips that already exist on disk" });
  sy.addArgument("--force", { action: "store_true",
                              help: "synthesise even if the bundle fails its checks" });
  sy.setDefaults({ func: cmdSynth });
  const au = sub.addParser("audition", { help: "the same lines in every cast voice from each "
                                               + "configured TTS provider, for a person to compare" });
  au.addArgument("--provider", { nargs: "*", metavar: "NAME",
                                 help: "which providers (default: every one with credentials)" });
  au.addArgument("--media-dir", { type: pathStr,
                                  help: `where the clips go (default: ${pathStr(config.MEDIA_DIR)}/audition)` });
  au.addArgument("--voices", { action: "store_true",
                               help: "also one line in every voice the library's provider offers, "
                                     + "to recast a role by ear" });
  au.addArgument("--force", { action: "store_true", help: "re-synthesise clips that exist" });
  au.setDefaults({ func: cmdAudition });
  const sc = sub.addParser("scenes", { help: "what the scene bank needs, draw what is missing" });
  sc.addArgument("--media-dir", { type: pathStr,
                                  help: `where scene art lives (default: ${pathStr(config.MEDIA_DIR)}/scenes)` });
  sc.addArgument("--prompt", { metavar: "SCENE_ID",
                               help: "print the illustration brief for one scene" });
  sc.addArgument("--generate", { nargs: "*", metavar: "SCENE_ID",
                                 help: "draw the scenes that have no artwork (or only the named ones), "
                                       + "reviewing every draft against the brief" });
  sc.addArgument("--provider", { default: "openai",
                                 help: "image backend: openai (needs OPENAI_API_KEY), or placeholder "
                                       + "(offline, grey rectangles that are never counted as art)" });
  sc.addArgument("--attempts", { type: "int", default: null,
                                 help: `drafts the review may reject per scene (default: ${config.SCENE_ATTEMPTS})` });
  sc.addArgument("--force", { action: "store_true",
                              help: "redraw even scenes that already have artwork" });
  sc.addArgument("--only", { choices: ["bank", "pictures"], default: null,
                             help: "draw only the shared bank, or only the per-item pictures "
                                   + "(default: both)" });
  sc.addArgument("--upload", { action: "store_true",
                               help: "put approved files in the `scenes` bucket "
                                     + "(needs the R2_* credentials)" });
  sc.addArgument("--sql", { action: "store_true",
                            help: "write the SQL pointing the database at approved artwork" });
  sc.addArgument("--out", { help: "where to write that SQL" });
  sc.addArgument("--summary", { default: null, help: "write a markdown summary here" });
  sc.setDefaults({ func: cmdScenes });
  const rn = sub.addParser("render", { help: "render a document stimulus to HTML" });
  rn.addArgument("path", { nargs: "?", help: "a bundle .json containing document items" });
  rn.addArgument("--item-type", { choices: sorted(Object.keys(GENERATORS)),
                                  help: "render this type's fixture instead of a bundle item" });
  rn.addArgument("--chart", { action: "store_true",
                              help: "render the worked example of a document carrying a graph" });
  rn.addArgument("--index", { type: "int", default: 0, help: "which document item in the bundle" });
  rn.addArgument("--page", { action: "store_true",
                             help: "a standalone HTML page rather than a fragment" });
  rn.addArgument("--out", { help: "write to a file instead of stdout" });
  rn.setDefaults({ func: cmdRender });
}
