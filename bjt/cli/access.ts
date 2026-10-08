/** Who may use the app: `grant` (the ad-free unlock) and `tester` (the list
 *  that is the only door while the app is in testing). Both print SQL for a
 *  person to read and apply; neither holds a key that could write it. */
import * as publish from "../publish.ts";
import { eprint, len, print, repr, str, strip, WS } from "../py.ts";
import type { Namespace, SubParsers } from "./argparse.ts";

/** A user id (users.id), a uuid. (`\n?$`: Python's `$` also matches before a
 *  trailing newline.) */
export const _UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\n?$/;


/** One @, something before it, a dotted domain after it, and no space or
 *  control character anywhere: an address the sign-in form accepts, and one
 *  that cannot end the comment line it is printed in. Quotes are allowed
 *  (o'brien@…) — `publish.lit` doubles them. */
export const _EMAIL = new RegExp(
  `^[^@${WS}\\x00-\\x1f\\x7f]+@[^@${WS}\\x00-\\x1f\\x7f]+\\.[^@${WS}\\x00-\\x1f\\x7f.]+\\n?$`, "u");


/**
 * SQL granting (or withdrawing) the ad-free unlock for one user.
 *
 * SQL rather than a live call, for the same reason content is: the thing that
 * reaches the database is a file somebody can read first. It also means no key
 * that can write entitlements has to live anywhere near this process.
 */
export async function cmdGrant(args: Namespace): Promise<number> {
  if (!_UUID.test(args.user)) {
    eprint(`not a user id (a uuid): ${repr(args.user)}`);
    return 2;
  }
  const [user, product] = [publish.lit(args.user), publish.lit(args.product)];
  let call: string;
  if (args.revoke) {
    // Withdrawn without deleting the record of it having existed: a refund
    // should still leave an answer to "why did this person have it".
    call = (
      "update entitlements set revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
      + (args.note ? `, note = ${publish.lit(args.note)}` : "")
      + ` where user_id = ${user} and product = ${product};`
    );
  } else {
    // Re-granting after a revocation restores it, which is what a
    // re-purchase after a refund means.
    call = (
      "insert into entitlements (user_id, product, source, external_id, note) values "
      + `(${user}, ${product}, ${publish.lit(args.source)}, ${publish.lit(args.external_id)}, `
      + `${publish.lit(args.note)}) on conflict (user_id, product) do update set `
      + "source = excluded.source, "
      + "external_id = coalesce(excluded.external_id, entitlements.external_id), "
      + "note = coalesce(excluded.note, entitlements.note), revoked_at = null;"
    );
  }
  print(`-- ${args.revoke ? "Revoke" : "Grant"} ${publish.comment(args.product)} `
        + `for ${str(args.user)}.`);
  print("-- For D1: wrangler d1 execute business-japanese-drill --remote --file <this>");
  print("-- Only the owner, signed in to Cloudflare, can run it. The app cannot.");
  if (!args.revoke) {
    print("-- Idempotent: a replayed purchase updates the row it already wrote.");
  }
  print();
  print(call);
  return 0;
}


/**
 * SQL adding (or removing) somebody on the tester list.
 *
 * While the app is in testing, `testers` is the only door: the Worker
 * refuses every query from an address that is not in it.
 * SQL rather than a live call, for the same reason `bjt grant` is: what
 * reaches the database is a statement somebody can read first, and no key
 * that can write it has to live near this process.
 */
export async function cmdTester(args: Namespace): Promise<number> {
  const email = strip(args.email).toLowerCase();
  if (!_EMAIL.test(email) || len(email) > 254) {
    eprint(`not an email address: ${repr(args.email)}`);
    return 2;
  }
  if (args.remove) {
    print(`-- Remove ${publish.comment(email)} from the tester list. Their history stays, and they cannot read it.`);
    print("-- For D1: wrangler d1 execute. Only the owner, signed in to Cloudflare, can run it.");
    print();
    print(`delete from testers where email = ${publish.lit(email)};`);
  } else {
    // No product ceiling: what limits a set is how many items the bank has
    // in the learner's level window, not this number. 32767 is where the
    // smallint the column is declared as ends.
    if (args.max_goal !== null && !(1 <= args.max_goal && args.max_goal <= 32767)) {
      eprint(`a day is at least 1 question and at most 32767, not ${str(args.max_goal)}`);
      return 2;
    }
    if (args.max_goal !== null && args.no_max_goal) {
      eprint("--max-goal and --no-max-goal say opposite things");
      return 2;
    }
    const unlimited = args.unlimited ? "1" : "0";
    const mayVeto = args.veto ? "1" : "0";
    const maxGoal = args.max_goal === null ? "null" : str(args.max_goal);
    // What an existing row takes from this statement: only what the
    // command names. The deploy workflow re-adds testers with a note and
    // no flags, and that must not take the owner's veto or day away.
    const named = ([
      ["note", args.note !== null],
      ["unlimited", args.unlimited !== null],
      ["may_veto", args.veto !== null],
      ["max_daily_goal", args.max_goal !== null || args.no_max_goal],
    ] as [string, boolean][]).filter(([, said]) => said).map(([column]) => column);
    const extras = ([
      ["no daily ceiling", args.unlimited],
      ["the veto button", args.veto],
      [`a day of up to ${str(args.max_goal)} questions`, args.max_goal !== null],
    ] as [string, boolean | null][]).filter(([, on]) => on).map(([t]) => t);
    print(`-- Let ${publish.comment(email)} use the app while it is in testing`
          + (extras.length ? `, with ${extras.join(" and ")}.` : "."));
    if (args.veto) {
      print("-- The veto button unpublishes a question for EVERYBODY on one press.");
      print("-- Give it to the owner and to nobody else.");
    }
    if (args.max_goal !== null) {
      print("-- max_daily_goal is the own fifteen of this ONE account: the largest set");
      print("-- it may choose in the app, and the point its day stops. Every other");
      print("-- row stays null, which is the ten-a-day, fifteen-at-most everyone has.");
      print("-- Ask for more than the bank can serve and the queue serves what it has.");
    }
    print("-- For D1: wrangler d1 execute. Only the owner, signed in to Cloudflare, can run it.");
    print("-- Idempotent. On a row that exists it changes only what this command");
    print("-- names: a flag it does not name keeps the value it has.");
    print();
    print("insert into testers (email, note, unlimited, may_veto, max_daily_goal) "
          + `values (${publish.lit(email)}, ${publish.lit(args.note || "")}, `
          + `${unlimited}, ${mayVeto}, ${maxGoal})`);
    if (named.length) {
      print("on conflict (email) do update set "
            + named.map((column) => `${column} = excluded.${column}`).join(", ") + ";");
    } else {
      print("on conflict (email) do nothing;");
    }
  }
  return 0;
}


/** Add this module's subcommands to the `bjt` parser. */
export function register(sub: SubParsers, types: string[]): void {
  const gr = sub.addParser("grant", { help: "SQL granting or revoking the ad-free unlock" });
  gr.addArgument("user", { help: "the user id (users.id, a uuid)" });
  gr.addArgument("--product", { default: "ads_free" });
  gr.addArgument("--source", { default: "grant",
                               choices: ["app_store", "play_store", "stripe", "grant"] });
  gr.addArgument("--external-id", { help: "the store or processor transaction id" });
  gr.addArgument("--note", { help: "why — shows up in the row, and in a dispute" });
  gr.addArgument("--revoke", { action: "store_true",
                               help: "withdraw it instead, keeping the record that it existed" });
  gr.setDefaults({ func: cmdGrant });
  const te = sub.addParser("tester", { help: "SQL adding or removing somebody on the tester list" });
  te.addArgument("email", { help: "the email address they sign in with" });
  te.addArgument("--note", { help: "who this is — shows up in the row" });
  te.addArgument("--unlimited", { action: "BooleanOptional", default: null,
                                  help: "lift the daily ceiling for this account (a tester exercising the "
                                        + "app); --no-unlimited puts it back. Unnamed, an existing row keeps "
                                        + "what it has" });
  te.addArgument("--veto", { action: "BooleanOptional", default: null,
                             help: "let this account unpublish a question from inside the app "
                                   + "(one press, for everybody — the owner's row, not a tester's); "
                                   + "--no-veto takes it away. Unnamed, an existing row keeps what it has" });
  te.addArgument("--max-goal", { type: "int", metavar: "N",
                                 help: "let this account choose its own daily set size, up to N "
                                       + "questions; its day then ends at N instead of at fifteen. "
                                       + "As large as you like — the queue serves what the bank has "
                                       + "in the level window. Omit to leave an existing row's "
                                       + "number as it is (a new row gets the standard ten-a-day, "
                                       + "fifteen-at-most)" });
  te.addArgument("--no-max-goal", { action: "store_true",
                                    help: "put this account back on the standard day (max_daily_goal null)" });
  te.addArgument("--remove", { action: "store_true", help: "take them off the list instead" });
  te.setDefaults({ func: cmdTester });
}
