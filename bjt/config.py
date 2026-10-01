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


# The generator model. Sonnet writes the drafts at two and a half times less
# than Opus per token; what holds the bar is that every draft must still pass
# the proofreader and the answerability gate below. BJT_MODEL=claude-opus-5
# switches the writer to Opus.
GEN_MODEL = _env("BJT_MODEL", "claude-sonnet-5")

# How hard the generator thinks. Output tokens are the expensive half of every
# generation and thinking is most of the output, so this is the single biggest
# dial on the nightly bill after the model itself. Medium keeps the honorific
# judgement.
GEN_EFFORT = _env("BJT_GEN_EFFORT", "medium")

# How many discards in a row a shelf tolerates before the night gives up on it.
# A generator that is wrong about a type is wrong about it all night, and every
# further draft costs as much as the first. Three is enough to be sure it is
# the shelf and not bad luck.
SLOT_PATIENCE = int(_env("BJT_SLOT_PATIENCE", "3"))

# The model used for the answerability gate, the discriminator judge and the
# scene reviewer. It must be genuinely capable — the cold/full test only means
# something if the model taking it could pass it ("a strong model should fail
# cold, succeed full") — and Sonnet is. The gate makes six calls per draft, so
# at Opus rates it would be the largest cost of a kept item.
# BJT_JUDGE_MODEL=claude-opus-5 switches it to Opus.
JUDGE_MODEL = _env("BJT_JUDGE_MODEL", "claude-sonnet-5")

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

# ----- the ceilings ------------------------------------------------------
#
# A patient loop and a cheap model are what keep a normal night cheap; these
# are what keep a broken night from being expensive. They are deliberately
# independent of each other, so that a bug in one of them is caught by the
# others.

# The most one process may spend — or one job, when BJT_SPEND_LEDGER names
# the file its steps share (bjt/llm.py `Spend`); the call and minute ceilings
# below are shared the same way — measured from the usage every response
# reports and priced with the table in bjt/llm.py. Checked before each call;
# reached, the run stops with what it has (LLMSpendLimitError, which the
# nightly loop treats like an empty account). Two dollars is a normal night
# on Sonnet with room to spare, and below anything worth being angry about.
RUN_BUDGET_USD = float(_env("BJT_RUN_BUDGET_USD", "2"))

# The most calls one process may make, whatever they cost. The dollar ceiling
# depends on the price table being right; this one does not. Twelve items at
# three attempts, each a generation, a proofread, six gate trials and five
# difficulty probes, is a little over four hundred; a loop that is still
# calling after that is a loop that is wrong.
RUN_MAX_CALLS = int(_env("BJT_RUN_MAX_CALLS", "500"))

# The most minutes one process may run, counted from when it started and
# checked before every call like the two above. A night is minutes, and a run
# still generating after hours is a broken one. The workflow has its own clock
# (timeout-minutes) a little above this one; this one stops with what it
# wrote, that one just stops.
RUN_MAX_MINUTES = float(_env("BJT_RUN_MAX_MINUTES", "30"))

# How long one API call may take before the SDK gives up on it, and how many
# times it may retry a transient failure. A call that hangs is paid for in
# minutes; a call retried many times is paid for in money. The retries are
# made by bjt/llm.py, not the SDK, so each one is counted and checked against
# the ceilings above before it is sent.
API_TIMEOUT_SECONDS = float(_env("BJT_API_TIMEOUT_SECONDS", "300"))
API_MAX_RETRIES = int(_env("BJT_API_MAX_RETRIES", "2"))

# No single call may ask for more output than this, and no generation may
# think harder than this, whatever the caller or an environment variable
# says. Output is the expensive half of every call and thinking is most of
# the output.
MAX_TOKENS_CEILING = int(_env("BJT_MAX_TOKENS_CEILING", "8000"))
EFFORT_CEILING = _env("BJT_EFFORT_CEILING", "high")

# The most a night may be asked to write, whatever the workflow input says.
# A manual run may ask for more than the plan's defaults (plan.DEFAULT_BUDGET
# and DEFAULT_PER_SLOT) up to here and no further, so a number typed into a
# box cannot buy an expensive night.
NIGHT_MAX_BUDGET = int(_env("BJT_NIGHT_MAX_BUDGET", "24"))
NIGHT_MAX_PER_SLOT = int(_env("BJT_NIGHT_MAX_PER_SLOT", "6"))

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

# How many recent topics to feed back into a generation prompt as a
# "do not repeat these" list.
RECENT_TOPICS_WINDOW = int(_env("BJT_RECENT_TOPICS_WINDOW", "25"))

# Answerability gate: run each side this many times and require consistency.
GATE_TRIALS = int(_env("BJT_GATE_TRIALS", "3"))

# The difficulty probe. The gate's full-view rate is a poor difficulty prior
# for an item nobody has answered yet: a strong model with the whole stimulus
# answers nearly everything, so the number is 0.67 or 1.0 and almost always
# 1.0. That is the gate doing its job — "is this answerable at all?" is a
# question a strong reader should say yes to — but a rate that never moves
# carries no information about how hard the item is. A weaker model is the
# better instrument precisely because it fails sometimes: its pass rate spreads
# across items in roughly the order a learner would find them hard, which is
# all a prior needs to do. The proofreader's model is the natural pick — the
# cheapest in the family, already in use. The probe runs after the gate and
# only on items the gate kept, so it costs DIFFICULTY_TRIALS small calls per
# shipped item and nothing per discarded one. Set but empty means unset: the
# nightly workflow passes a repository variable that may not exist.
DIFFICULTY_MODEL = _env("BJT_DIFFICULTY_MODEL", "").strip() or SANITY_MODEL
DIFFICULTY_TRIALS = int(_env("BJT_DIFFICULTY_TRIALS", "5"))

# A prototype, off unless asked for: BJT_DIFFICULTY_MODEL=jev-latest makes the
# probe one call to TypeSafe AI's Jev, which returns a probability for every
# option instead of an answer, and the probability it gives the key is the rate
# (bjt/jev.py). DIFFICULTY_TRIALS does not apply to it. The key is read from
# TYPESAFE_API_KEY when the call is made, as the Anthropic SDK reads its own.
# `bjt probe --compare jev-latest` sets the two instruments side by side and
# writes nothing, which is the evidence to read before letting it write a rate.
JEV_URL = _env("BJT_JEV_URL", "https://api.typesafe.ai/v1/systemone")

# Set BJT_DIFFICULTY=0 to skip it. An item that was not probed carries the
# gate's full-view rate, which is the honest fallback rather than a made-up
# number — see bjt/fidelity/difficulty.py.
DIFFICULTY_ENABLED = _env("BJT_DIFFICULTY", "1").strip().lower() not in ("0", "false", "no", "off")

# The image model that draws the scene bank, and how hard it tries. Medium is a
# quarter of the price of "high" and a flat illustration cannot tell the
# difference. Attempts is how many drafts the review gate may reject before a
# scene ships without a picture; the nightly job only draws once a week.
IMAGE_MODEL = _env("BJT_IMAGE_MODEL", "gpt-image-1")
IMAGE_QUALITY = _env("BJT_IMAGE_QUALITY", "medium")
SCENE_ATTEMPTS = int(_env("BJT_SCENE_ATTEMPTS", "3"))

# How many drafts a scene may be refused over its whole life before the job
# stops drawing it. Counted in the bucket (`rejected/<scene>-<n>.txt`, one
# marker per refused draft), because the runner forgets everything each
# night and the bucket is the only record it has. Without it, a scene the
# reviewer always refuses would be redrawn every week for ever; with it, six
# refusals (two weeks) and the scene ships on its stand-in (bjt/scenes.py
# STAND_INS) until somebody draws it by hand. A per-item picture (画像把握) has
# no stand-in: after this many its item stays unserved, and the summary says so.
SCENE_LIFETIME_ATTEMPTS = int(_env("BJT_SCENE_LIFETIME_ATTEMPTS", "6"))

# The most per-item pictures one run may draft. A picture costs an image call
# and a handful of vision calls per draft, so a night that found forty new
# 画像把握 items in the tree must not draw forty pictures. Four is a night.
NIGHT_MAX_PICTURES = int(_env("BJT_NIGHT_MAX_PICTURES", "4"))

# How hard the image API compresses the WebP it returns (0–100, higher is
# larger). The `scenes` bucket refuses anything over SCENE_MAX_BYTES, which is
# the limit the pipeline keeps for the media bucket in R2,
# and a 1536×1024 "high" draft can exceed it. 80 keeps a flat illustration far
# under the limit with no visible cost, and the limit is checked before a byte
# is sent.
IMAGE_COMPRESSION = int(_env("BJT_IMAGE_COMPRESSION", "80"))
SCENE_MAX_BYTES = 2 * 1024 * 1024

# The `audio` bucket's file_size_limit, from the same migration. A clean 24 kHz
# clip runs to about 48 KB a second, so this is over a minute and a half of
# narration; a clip near it is a planning bug, not a long question.
AUDIO_MAX_BYTES = 5 * 1024 * 1024
