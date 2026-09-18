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


def _load_dotenv() -> None:
    """Load a .env file if python-dotenv is installed. Real exported env vars
    always win (override=False); if python-dotenv isn't present, this is a no-op
    and you can `source` the file yourself instead."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(ROOT / ".env")   # repo-root .env
    load_dotenv()                # and one in the current working directory


_load_dotenv()


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


# The generator model. A strong model matters most here: distractor quality and
# the honorific/register judgements are exactly where weaker models collapse.
GEN_MODEL = _env("BJT_MODEL", "claude-opus-5")

# The model used for the answerability gate and the discriminator judge. Kept
# strong on purpose: the cold/full test only means something if the model taking
# it is genuinely capable ("a strong model should fail cold, succeed full").
JUDGE_MODEL = _env("BJT_JUDGE_MODEL", GEN_MODEL)

# The proofreader. It runs once per item the moment the item exists, before the
# expensive gate, and it is deliberately the cheapest model in the family: what
# it looks for — an explanation that names the wrong option, two options that say
# the same thing, a dropped particle — needs care, not expertise. Anything that
# needs expertise is the answerability gate's job and stays there. One small call
# per item, against six large ones, is why this saves money rather than costing
# it: a broken item never reaches the gate.
SANITY_MODEL = _env("BJT_SANITY_MODEL", "claude-haiku-4-5")

# Set BJT_SANITY=0 to skip it. An item that is not checked is recorded as not
# checked rather than as clean — see bjt/fidelity/sanity.py.
SANITY_ENABLED = _env("BJT_SANITY", "1").strip().lower() not in ("0", "false", "no", "off")

DB_PATH = Path(_env("BJT_DB_PATH", str(ROOT / "bjt.db")))

# Licensed few-shot examples, official sample items, vocab lists, and level
# descriptors live here. Gitignored — see README.
SEEDS_DIR = Path(_env("BJT_SEEDS_DIR", str(ROOT / "seeds")))

# The seed tables (場面×関係×機能×レベル). Our own design, not licensed — these
# ARE committed, unlike seeds/. See bjt/seedtable.py.
SEEDTABLE_DIR = Path(_env("BJT_SEEDTABLE_DIR", str(ROOT / "seedtable")))

# Where batch runs write their bundles (the JSON the app ships with).
BATCH_DIR = Path(_env("BJT_BATCH_DIR", str(ROOT / "batches")))

# Where the media jobs put files before they are uploaded: `media/audio/...`
# and `media/scenes/...`, mirroring the storage buckets. Gitignored — audio and
# artwork are large, regenerable, and belong in object storage, not in git.
MEDIA_DIR = Path(_env("BJT_MEDIA_DIR", str(ROOT / "media")))

# How many recent stems/topics to feed back into a generation prompt as a
# "do not repeat these" list.
RECENT_TOPICS_WINDOW = int(_env("BJT_RECENT_TOPICS_WINDOW", "25"))

# Answerability gate: run each side this many times and require consistency.
GATE_TRIALS = int(_env("BJT_GATE_TRIALS", "3"))

# The difficulty probe. The gate's full-view rate was the difficulty prior the
# practice queue used for an item nobody had answered yet, and it was a poor
# one: a strong model with the whole stimulus answers nearly everything, so the
# number was 0.67 or 1.0 and almost always 1.0. That is the gate doing its job
# — "is this answerable at all?" is a question a strong reader should say yes
# to — but a rate that never moves carries no information about how hard the
# item is. A weaker model is the better instrument here precisely because it
# fails sometimes: its pass rate spreads across items in roughly the order a
# learner would find them hard, which is all a prior needs to do. The proofreader's
# model is the natural pick — the cheapest in the family, already in use. The
# probe runs after the gate and only on items the gate kept, so it costs
# DIFFICULTY_TRIALS small calls per shipped item and nothing per discarded one.
DIFFICULTY_MODEL = _env("BJT_DIFFICULTY_MODEL", SANITY_MODEL)
DIFFICULTY_TRIALS = int(_env("BJT_DIFFICULTY_TRIALS", "5"))

# Set BJT_DIFFICULTY=0 to skip it. An item that was not probed carries the
# gate's full-view rate as before, which is the honest fallback rather than a
# made-up number — see bjt/fidelity/difficulty.py.
DIFFICULTY_ENABLED = _env("BJT_DIFFICULTY", "1").strip().lower() not in ("0", "false", "no", "off")

# The image model that draws the scene bank, and how hard it tries. The bank is
# sixteen pictures drawn once, so quality is cheap here; attempts is how many
# drafts the review gate may reject before a scene ships without a picture.
IMAGE_MODEL = _env("BJT_IMAGE_MODEL", "gpt-image-1")
IMAGE_QUALITY = _env("BJT_IMAGE_QUALITY", "high")
SCENE_ATTEMPTS = int(_env("BJT_SCENE_ATTEMPTS", "3"))

# How hard the image API compresses the WebP it returns (0–100, higher is
# larger). The `scenes` bucket refuses anything over SCENE_MAX_BYTES, which is
# the file_size_limit in supabase/migrations/20260915000300_media_storage.sql;
# the first real night produced a 1536×1024 "high" draft above it and the
# upload step died. 80 keeps a flat illustration far under the limit with no
# visible cost, and the limit is checked here before a byte is sent.
IMAGE_COMPRESSION = int(_env("BJT_IMAGE_COMPRESSION", "80"))
SCENE_MAX_BYTES = 2 * 1024 * 1024
