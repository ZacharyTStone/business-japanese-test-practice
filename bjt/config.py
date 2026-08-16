"""Runtime configuration, read from the environment with sensible defaults.

Everything is overridable so the single user can tune models and paths without
touching code. Nothing here is secret; the API key is read by the Anthropic SDK
itself from ANTHROPIC_API_KEY.
"""
from __future__ import annotations

import os
from pathlib import Path

# Repo root is the parent of this package.
ROOT = Path(__file__).resolve().parent.parent


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


# The generator model. A strong model matters most here: distractor quality and
# the honorific/register judgements are exactly where weaker models collapse.
GEN_MODEL = _env("BJT_MODEL", "claude-opus-5")

# The model used for the answerability gate and the discriminator judge. Kept
# strong on purpose: the cold/full test only means something if the model taking
# it is genuinely capable ("a strong model should fail cold, succeed full").
JUDGE_MODEL = _env("BJT_JUDGE_MODEL", GEN_MODEL)

DB_PATH = Path(_env("BJT_DB_PATH", str(ROOT / "bjt.db")))

# Licensed few-shot examples, official sample items, vocab lists, and level
# descriptors live here. Gitignored — see README.
SEEDS_DIR = Path(_env("BJT_SEEDS_DIR", str(ROOT / "seeds")))

# How many recent stems/topics to feed back into a generation prompt as a
# "do not repeat these" list.
RECENT_TOPICS_WINDOW = int(_env("BJT_RECENT_TOPICS_WINDOW", "25"))

# Answerability gate: run each side this many times and require consistency.
GATE_TRIALS = int(_env("BJT_GATE_TRIALS", "3"))
