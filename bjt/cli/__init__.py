"""Command-line interface. `bjt --help` lists every command.

The commands are thin on purpose. What they drive lives in the modules they
call: one draft's checks and a shelf's loop in `bjt/pipeline.py`, the passes
over the bank that already shipped in `bjt/backfill.py` (the probe) and
`bjt/regate.py`, the bundle and its offline checks in `bjt/batch.py`, the SQL
in `bjt/publish.py`.

Each module here registers its own subcommands next to their handlers:
`generate` (gen, smoke, batch, plan, nightly), `bank` (importbatch,
checkbatch, publish, probe, regate), `media` (synth, audition, scenes, render),
`access` (grant, tester) and `research` (init, selftest, seeds, seedtable,
practice, quality, discriminate, calibrate). This one composes the parser and
runs the command.
"""
from __future__ import annotations

import argparse
import sys

from ..generators import GENERATORS
from ..llm import LLMError
from . import access, bank, generate, media, research
from .generate import _nightly_summary, clamp_night, cmd_gen, cmd_smoke
from .research import _normalize_official, cmd_seeds

__all__ = [
    "build_parser", "main",
    # What the tests reach for by name.
    "_nightly_summary", "_normalize_official", "clamp_night", "cmd_gen", "cmd_seeds", "cmd_smoke",
]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="bjt", description="Write, gate, check and publish BJT-format practice items")
    sub = p.add_subparsers(dest="command", required=True)
    types = sorted(GENERATORS)
    for module in (research, generate, bank, media, access):
        module.register(sub, types)
    return p


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    # practice --demo/--type: type is optional; every other command validates via choices.
    if args.command == "practice" and not args.demo and not args.type:
        parser.error("practice requires --type unless --demo is used")
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\ninterrupted.")
        return 130
    except LLMError as e:
        print(f"\nGeneration failed: {e}", file=sys.stderr)
        return 1
