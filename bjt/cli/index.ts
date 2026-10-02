/**
 * Command-line interface. `bjt --help` lists every command.
 *
 * The commands are thin on purpose. What they drive lives in the modules they
 * call: one draft's checks and a shelf's loop in `bjt/pipeline.ts`, the passes
 * over the bank that already shipped in `bjt/backfill.ts` (the probe) and
 * `bjt/regate.ts`, the bundle and its offline checks in `bjt/batch.ts`, the SQL
 * in `bjt/publish.ts`.
 *
 * Each module here registers its own subcommands next to their handlers:
 * `generate` (gen, smoke, batch, plan, nightly), `bank` (importbatch,
 * checkbatch, publish, probe, regate), `media` (synth, audition, scenes, render),
 * `access` (grant, tester) and `research` (init, selftest, seeds, seedtable,
 * practice, quality, discriminate, calibrate). This one composes the parser and
 * runs the command.
 */
import { GENERATORS } from "../generators/index.ts";
import { LLMError } from "../llm.ts";
import { eprint, errText, sorted, SystemExit } from "../py.ts";
import { ArgumentParser, type Namespace } from "./argparse.ts";
import * as access from "./access.ts";
import * as bank from "./bank.ts";
import * as generate from "./generate.ts";
import * as media from "./media.ts";
import * as research from "./research.ts";

// What the tests reach for by name.
export { _nightlySummary, clampNight, cmdGen, cmdSmoke } from "./generate.ts";
export { _normalizeOfficial, cmdSeeds } from "./research.ts";


export function buildParser(): ArgumentParser {
  const p = new ArgumentParser({
    prog: "bjt", description: "Write, gate, check and publish BJT-format practice items" });
  const sub = p.addSubparsers({ dest: "command", required: true });
  const types = sorted(Object.keys(GENERATORS));
  for (const module of [research, generate, bank, media, access]) {
    module.register(sub, types);
  }
  return p;
}


/**
 * Parse `argv` (default: the process's own arguments), run the command, and
 * return its exit status. A usage error is argparse's status 2; a failed
 * generation is said on stderr and is 1. The process's exit status is set by
 * bjt/main.ts alone, which also answers an interrupt (Python's
 * `KeyboardInterrupt`: "interrupted.", 130).
 */
export async function main(opts: { argv?: string[] | null } = {}): Promise<number> {
  const argv = opts.argv ?? process.argv.slice(2);
  const parser = buildParser();
  let args: Namespace;
  try {
    args = parser.parseArgs(argv);
    // practice --demo/--type: type is optional; every other command validates via choices.
    if (args.command === "practice" && !args.demo && !args.type) {
      parser.error("practice requires --type unless --demo is used");
    }
  } catch (e) {
    if (e instanceof SystemExit) return e.code;
    throw e;
  }
  try {
    return await args.func(args);
  } catch (e) {
    if (e instanceof LLMError) {
      eprint(`\nGeneration failed: ${errText(e)}`);
      return 1;
    }
    if (e instanceof SystemExit) return e.code;
    throw e;
  }
}
