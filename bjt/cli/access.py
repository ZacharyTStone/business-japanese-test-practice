"""Who may use the app: `grant` (the ad-free unlock) and `tester` (the list
that is the only door while the app is in testing). Both print SQL for a
person to read and apply; neither holds a key that could write it."""
from __future__ import annotations

import argparse
import re
import sys

from .. import (
    publish,
)

#: A user id (users.id), a uuid.
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


#: One @, something before it, a dotted domain after it, and no space or
#: control character anywhere: an address the sign-in form accepts, and one
#: that cannot end the comment line it is printed in. Quotes are allowed
#: (o'brien@…) — `publish.lit` doubles them.
_EMAIL = re.compile(r"^[^@\s\x00-\x1f\x7f]+@[^@\s\x00-\x1f\x7f]+\.[^@\s\x00-\x1f\x7f.]+$")


def cmd_grant(args) -> int:
    """SQL granting (or withdrawing) the ad-free unlock for one user.

    SQL rather than a live call, for the same reason content is: the thing that
    reaches the database is a file somebody can read first. It also means no key
    that can write entitlements has to live anywhere near this process.
    """
    if not _UUID.match(args.user):
        print(f"not a user id (a uuid): {args.user!r}", file=sys.stderr)
        return 2
    user, product = publish.lit(args.user), publish.lit(args.product)
    if args.revoke:
        # Withdrawn without deleting the record of it having existed: a refund
        # should still leave an answer to "why did this person have it".
        call = (
            "update entitlements set revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
            + (f", note = {publish.lit(args.note)}" if args.note else "")
            + f" where user_id = {user} and product = {product};"
        )
    else:
        # Re-granting after a revocation restores it, which is what a
        # re-purchase after a refund means.
        call = (
            "insert into entitlements (user_id, product, source, external_id, note) values "
            f"({user}, {product}, {publish.lit(args.source)}, {publish.lit(args.external_id)}, "
            f"{publish.lit(args.note)}) on conflict (user_id, product) do update set "
            "source = excluded.source, "
            "external_id = coalesce(excluded.external_id, entitlements.external_id), "
            "note = coalesce(excluded.note, entitlements.note), revoked_at = null;"
        )
    print(f"-- {'Revoke' if args.revoke else 'Grant'} {publish.comment(args.product)} "
          f"for {args.user}.")
    print("-- For D1: `wrangler d1 execute business-japanese-drill --remote --file <this>`.")
    print("-- Only the owner, signed in to Cloudflare, can run it; the app cannot.")
    if not args.revoke:
        print("-- Idempotent: a replayed purchase updates the row it already wrote.")
    print()
    print(call)
    return 0


def cmd_tester(args) -> int:
    """SQL adding (or removing) somebody on the tester list.

    While the app is in testing, `testers` is the only door: the Worker
    refuses every query from an address that is not in it.
    SQL rather than a live call, for the same reason `bjt grant` is: what
    reaches the database is a statement somebody can read first, and no key
    that can write it has to live near this process.
    """
    email = args.email.strip().lower()
    if not _EMAIL.match(email) or len(email) > 254:
        print(f"not an email address: {args.email!r}", file=sys.stderr)
        return 2
    if args.remove:
        print(f"-- Remove {email} from the tester list. Their history stays; they cannot read it.")
        print("-- For D1: `wrangler d1 execute`. Only the owner, signed in to Cloudflare, can run it.")
        print()
        print(f"delete from testers where email = {publish.lit(email)};")
    else:
        # No product ceiling: what limits a set is how many items the bank has
        # in the learner's level window, not this number. 32767 is where the
        # smallint the column is declared as ends.
        if args.max_goal is not None and not 1 <= args.max_goal <= 32767:
            print(f"a day is at least 1 question and at most 32767, not {args.max_goal}",
                  file=sys.stderr)
            return 2
        if args.max_goal is not None and args.no_max_goal:
            print("--max-goal and --no-max-goal say opposite things", file=sys.stderr)
            return 2
        unlimited = "1" if args.unlimited else "0"
        may_veto = "1" if args.veto else "0"
        max_goal = "null" if args.max_goal is None else str(args.max_goal)
        # What an existing row takes from this statement: only what the
        # command names. The deploy workflow re-adds testers with a note and
        # no flags, and that must not take the owner's veto or day away.
        named = [column for column, said in (
            ("note", args.note is not None),
            ("unlimited", args.unlimited is not None),
            ("may_veto", args.veto is not None),
            ("max_daily_goal", args.max_goal is not None or args.no_max_goal),
        ) if said]
        extras = [t for t, on in (("no daily ceiling", args.unlimited),
                                  ("the veto button", args.veto),
                                  (f"a day of up to {args.max_goal} questions",
                                   args.max_goal is not None)) if on]
        print(f"-- Let {email} use the app while it is in testing"
              + (f", with {' and '.join(extras)}." if extras else "."))
        if args.veto:
            print("-- The veto button unpublishes a question for EVERYBODY on one press.")
            print("-- Give it to the owner and to nobody else.")
        if args.max_goal is not None:
            print("-- max_daily_goal is the own fifteen of this ONE account: the largest set")
            print("-- it may choose in the app, and the point its day stops. Every other")
            print("-- row stays null, which is the ten-a-day, fifteen-at-most everyone has.")
            print("-- Ask for more than the bank can serve and the queue serves what it has.")
        print("-- For D1: `wrangler d1 execute`. Only the owner, signed in to Cloudflare, can run it.")
        print("-- Idempotent. On a row that exists it changes only what this command")
        print("-- names; a flag it does not name keeps the value it has.")
        print()
        print("insert into testers (email, note, unlimited, may_veto, max_daily_goal) "
              f"values ({publish.lit(email)}, {publish.lit(args.note or '')}, "
              f"{unlimited}, {may_veto}, {max_goal})")
        if named:
            print("on conflict (email) do update set "
                  + ", ".join(f"{column} = excluded.{column}" for column in named) + ";")
        else:
            print("on conflict (email) do nothing;")
    return 0



def register(sub, types: list[str]) -> None:
    """Add this module's subcommands to the `bjt` parser."""
    gr = sub.add_parser("grant", help="SQL granting or revoking the ad-free unlock")
    gr.add_argument("user", help="the user id (users.id, a uuid)")
    gr.add_argument("--product", default="ads_free")
    gr.add_argument("--source", default="grant",
                    choices=["app_store", "play_store", "stripe", "grant"])
    gr.add_argument("--external-id", help="the store or processor transaction id")
    gr.add_argument("--note", help="why — shows up in the row, and in a dispute")
    gr.add_argument("--revoke", action="store_true",
                    help="withdraw it instead, keeping the record that it existed")
    gr.set_defaults(func=cmd_grant)
    te = sub.add_parser("tester", help="SQL adding or removing somebody on the tester list")
    te.add_argument("email", help="the email address they sign in with")
    te.add_argument("--note", help="who this is — shows up in the row")
    te.add_argument("--unlimited", action=argparse.BooleanOptionalAction, default=None,
                    help="lift the daily ceiling for this account (a tester exercising the "
                         "app); --no-unlimited puts it back. Unnamed, an existing row keeps "
                         "what it has")
    te.add_argument("--veto", action=argparse.BooleanOptionalAction, default=None,
                    help="let this account unpublish a question from inside the app "
                         "(one press, for everybody — the owner's row, not a tester's); "
                         "--no-veto takes it away. Unnamed, an existing row keeps what it has")
    te.add_argument("--max-goal", type=int, metavar="N",
                    help="let this account choose its own daily set size, up to N "
                         "questions; its day then ends at N instead of at fifteen. "
                         "As large as you like — the queue serves what the bank has "
                         "in the level window. Omit to leave an existing row's "
                         "number as it is (a new row gets the standard ten-a-day, "
                         "fifteen-at-most)")
    te.add_argument("--no-max-goal", action="store_true",
                    help="put this account back on the standard day (max_daily_goal null)")
    te.add_argument("--remove", action="store_true", help="take them off the list instead")
    te.set_defaults(func=cmd_tester)
