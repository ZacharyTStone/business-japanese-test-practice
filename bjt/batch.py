"""Batch generation and the bundle format.

Items are never generated while somebody is practising. Generation is a batch job
run here, on a laptop, against a seed table; what ships is a plain JSON bundle
plus an audio manifest. That is the whole reason the running cost of the app is
zero, and it is also why the quality gates can afford to be expensive — they run
once per item, offline, before anything is published.

A bundle is self-contained and app-facing: it carries the items with their
answers and 解説, the clip ids the audio files will be named after, and the scene
ids the images come from.

``check_bundle`` is the part that runs without an API key. It catches the
failures that survive a per-item gate but only show up across a batch — the same
question asked twice, the answer drifting to position C, the correct option being
the longest one every time. That last pair matter more than they look: they are
how a test-taker learns to score without understanding anything.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from . import config, schemas, seedtable
from .fidelity import dedupe, roles
from .tts import plan as tts_plan

#: 2 — audio clip ids are filed by role (`narration` / `options` / `dialogue`)
#: rather than by position, and items may carry `documents` and `dialogue`.
#: Version 1 bundles are not read anywhere: the source files are the authority,
#: so a format change means re-running `importbatch`, not a compatibility path.
BUNDLE_VERSION = 2

#: A listening stem is heard once. Shorter than this and it cannot have set up a
#: situation; longer and the test-taker is being tested on memory.
STEM_MIN_CHARS = 20
STEM_MAX_CHARS = 140


def item_id(item: dict) -> str:
    """Stable id: derived from the seed cell, so regenerating a cell replaces its
    item rather than adding a second copy."""
    key = (item.get("seed_cell") or {}).get("id") or item.get("stem", "")
    return hashlib.sha1(f"{item.get('item_type','')}|{key}".encode("utf-8")).hexdigest()[:10]


def _documents_of(item: dict) -> list[dict]:
    """A type's documents, always as a list.

    The schema calls it `document` for the three types that have one and
    `documents` for the one type that has two. Everything downstream — the
    database column, the app's renderer — would rather deal with one shape than
    with that distinction, so the bundle normalises it here and the singular
    never leaves the generator.
    """
    field = schemas.DOCUMENT_FIELDS.get(item.get("item_type", ""))
    if field is None:
        return []
    value = item.get(field)
    if isinstance(value, list):
        return [d for d in value if isinstance(d, dict)]
    return [value] if isinstance(value, dict) else []


def to_bundle_item(item: dict) -> dict:
    """One item in app-facing shape: answer resolved to an index, audio clip ids
    attached, documents normalised to a list, our internal metrics left out."""
    iid = item_id(item)
    clips = tts_plan.plan_item(item, iid)
    by_kind: dict[str, list] = {}
    for clip in clips:
        by_kind.setdefault(clip.kind, []).append(clip)
    narration = by_kind.get("narration") or []
    out = {
        "id": iid,
        "item_type": item.get("item_type"),
        "level": item.get("level"),
        "seed_cell": item.get("seed_cell"),
        "topic": item.get("topic", ""),
        "stem": item["stem"],
        "options": [
            {"text": o["text"], "role": o["role"], "why": o.get("why", "")}
            for o in item["options"]
        ],
        "correct_index": schemas.correct_index(item["options"]),
        "explanation_ja": item.get("explanation_ja", ""),
        "explanation_en": item.get("explanation_en", ""),
        "vocab_notes": item.get("vocab_notes", []),
        # Clip ids by role rather than by position. The old shape assumed
        # "narration first, options after", which is true of exactly one of the
        # nine types: a dialogue type would have had its turns filed as options,
        # and a reading type has no clips at all to take a first element from.
        "audio": {
            "narration": narration[0].clip_id if narration else None,
            "options": [c.clip_id for c in by_kind.get("option", [])],
            "dialogue": [c.clip_id for c in by_kind.get("dialogue", [])],
        },
    }

    documents = _documents_of(item)
    if documents:
        out["documents"] = documents

    turns = item.get("dialogue")
    if turns:
        dialogue_clips = by_kind.get("dialogue", [])
        out["dialogue"] = [
            {
                "speaker_role": t.get("speaker_role", ""),
                "text": t.get("text", ""),
                "clip_id": dialogue_clips[i].clip_id if i < len(dialogue_clips) else None,
            }
            for i, t in enumerate(turns)
        ]

    for key in ("scene_id", "speaker_role", "listener_role", "channel"):
        if key in item:
            out[key] = item[key]

    # How often the answerability gate answered this item correctly with the full
    # stimulus. Absent for hand-written batches, which are the one path that
    # skips the gate — and absent is the honest value there, not 1.0. The
    # practice queue reads it as the difficulty prior for an item nobody has met
    # yet, and replaces it with the measured rate as soon as the shared bank has
    # one.
    if item.get("model_p_correct") is not None:
        out["model_p_correct"] = item["model_p_correct"]
    return out


def build_bundle(item_type: str, level: str, items: list[dict], model: str) -> dict:
    bundle_items = [to_bundle_item(it) for it in items]
    manifest = tts_plan.manifest([(bi["id"], raw) for bi, raw in zip(bundle_items, items)])
    scenes = sorted({bi["scene_id"] for bi in bundle_items if bi.get("scene_id")})
    return {
        "bundle_version": BUNDLE_VERSION,
        "item_type": item_type,
        "level": level,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "generator_model": model,
        "items": bundle_items,
        "audio_manifest": manifest,
        "scenes": scenes,
    }


def save(bundle: dict, path: Optional[Path] = None) -> Path:
    path = path or default_path(bundle["item_type"], bundle["level"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def load(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def bundles(item_type: Optional[str] = None) -> list[Path]:
    """Every committed bundle, optionally narrowed to one item type.

    `.source.json` files are the hand-written inputs to `importbatch`, not
    bundles, so they are skipped — counting both would double every cell a
    hand-written batch spends.
    """
    if not config.BATCH_DIR.exists():
        return []
    out = []
    for p in sorted(config.BATCH_DIR.glob("*.json")):
        if p.name.endswith(".source.json"):
            continue
        if item_type and not p.name.startswith(f"{item_type}_"):
            continue
        out.append(p)
    return out


def spent_cell_ids(item_type: str) -> set[str]:
    """Seed cells already spent by the bundles in this repository.

    The local SQLite database also knows this, but it is gitignored: a fresh
    clone reports nothing spent even with forty items committed, and the next
    `bjt batch` on that machine quietly re-spends cells the library already
    used. Since `item_id` is a hash of (item type, cell), the second item would
    REPLACE the first on publish — the library would shrink without saying so.

    The bundles are the thing that actually ships, so they are the ledger. The
    database is still consulted as well (it holds cells spent on items that have
    not been bundled yet); the two are unioned at the call sites.
    """
    spent: set[str] = set()
    for path in bundles(item_type):
        try:
            bundle = load(path)
        except (OSError, json.JSONDecodeError):
            continue
        if bundle.get("item_type") != item_type:
            continue
        for item in bundle.get("items", []):
            cell_id = (item.get("seed_cell") or {}).get("id")
            if cell_id:
                spent.add(cell_id)
    return spent


def default_path(item_type: str, level: str) -> Path:
    """Next free numbered bundle for this type and level."""
    config.BATCH_DIR.mkdir(parents=True, exist_ok=True)
    n = 1
    while True:
        p = config.BATCH_DIR / f"{item_type}_{level}_{n:03d}.json"
        if not p.exists():
            return p
        n += 1


# ----- offline batch checks ---------------------------------------------

@dataclass
class Check:
    name: str
    status: str  # "pass" | "warn" | "fail"
    detail: str


@dataclass
class BundleReport:
    checks: list[Check] = field(default_factory=list)

    @property
    def failed(self) -> list[Check]:
        return [c for c in self.checks if c.status == "fail"]

    @property
    def warned(self) -> list[Check]:
        return [c for c in self.checks if c.status == "warn"]

    @property
    def ok(self) -> bool:
        return not self.failed


def check_bundle(bundle: dict, *, threshold: float = dedupe.DEFAULT_THRESHOLD) -> BundleReport:
    """Every check that needs no API key. Run on every batch before it ships."""
    items = bundle.get("items", [])
    item_type = bundle.get("item_type", "")
    report = BundleReport()
    add = lambda name, status, detail: report.checks.append(Check(name, status, detail))  # noqa: E731

    if not items:
        add("non-empty", "fail", "bundle contains no items")
        return report

    # 1. Every item still validates on its own.
    invalid = []
    for it in items:
        errs = schemas.validate_item(item_type, _as_generator_shape(it))
        if errs:
            invalid.append(f"{it.get('id')}: {errs}")
    add(
        "item validity",
        "fail" if invalid else "pass",
        "; ".join(invalid) if invalid else f"all {len(items)} items valid",
    )

    # 2. One item per seed cell.
    cells = [(it.get("seed_cell") or {}).get("id") for it in items]
    missing = sum(1 for c in cells if not c)
    used = [c for c in cells if c]
    dupes = {c for c in used if used.count(c) > 1}
    if missing:
        add("seed cells present", "fail", f"{missing} item(s) carry no seed cell")
    elif dupes:
        add("seed cells distinct", "fail", f"cells used more than once: {sorted(dupes)}")
    else:
        add("seed cells distinct", "pass", f"{len(set(used))} distinct cells")

    # 3. Near-duplicate questions.
    pairs = dedupe.find_duplicates(items, threshold)
    if pairs:
        detail = "; ".join(
            f"#{p.i}({p.topic_i}) ≈ #{p.j}({p.topic_j}) at {p.score:.2f}" for p in pairs[:5]
        )
        add("no near-duplicates", "fail", detail)
    else:
        worst = _worst_pair_score(items)
        add("no near-duplicates", "pass", f"closest pair {worst:.2f} (threshold {threshold:.2f})")

    # 4. Answer position must not drift. A learner who notices C is right half the
    #    time can score without listening.
    n = len(items)
    counts = [0, 0, 0, 0]
    for it in items:
        ci = it.get("correct_index", 0)
        if 0 <= ci < 4:
            counts[ci] += 1
    worst_share = max(counts) / n
    positions_used = sum(1 for c in counts if c)
    # Two rules, because one of them was blind to exactly the batch a new item
    # type starts as. The share rule needs eight items before a 45% lean means
    # anything; a batch of six with every answer at A sailed past it, and
    # "the answer is always A" is the most exploitable pattern there is.
    if n >= 8 and worst_share > 0.45:
        add("answer position spread", "warn",
            f"positions {counts} — {worst_share:.0%} on one position; reshuffle")
    elif n >= 4 and positions_used < 3:
        add("answer position spread", "warn",
            f"positions {counts} — the answer only ever lands in {positions_used} "
            f"of 4 places; reshuffle")
    else:
        add("answer position spread", "pass", f"positions {counts}")

    # 5. Length must not give the answer away. "Pick the longest / most elaborate
    #    option" is the single easiest way to pass a 敬語 item without knowing any.
    longest = sum(1 for it in items if _correct_is_extreme(it, longest=True))
    shortest = sum(1 for it in items if _correct_is_extreme(it, longest=False))
    if n >= 8 and (longest / n > 0.5 or shortest / n > 0.5):
        add("length does not leak", "warn",
            f"correct option is the longest in {longest}/{n} and the shortest in {shortest}/{n}")
    else:
        add("length does not leak", "pass", f"longest {longest}/{n}, shortest {shortest}/{n}")

    # 6. Distractor roles actually get exercised — an enum of eight used as three
    #    is a prompt that has settled into a rut.
    enum = roles.DISTRACTOR_ROLES.get(item_type, [])
    used_roles = {o["role"] for it in items for o in it["options"] if o["role"] != roles.CORRECT}
    unused = [r for r in enum if r not in used_roles]
    if enum and len(used_roles) < min(4, len(enum)):
        add("distractor role coverage", "warn",
            f"only {len(used_roles)}/{len(enum)} roles used; unused: {unused}")
    else:
        add("distractor role coverage", "pass",
            f"{len(used_roles)}/{len(enum)} roles used" + (f"; unused: {unused}" if unused else ""))

    # 7. The per-option reason has to say something. An empty or one-word `why`
    #    means the app has nothing to show after a wrong answer.
    thin = [f"{it['id']}#{i}" for it in items for i, o in enumerate(it["options"])
            if len(o.get("why", "")) < 12]
    add("per-option why", "fail" if thin else "pass",
        f"too thin: {thin}" if thin else "every option explains itself")

    # 8. Listening-specific: stem length, and the scene must exist in the bank.
    if item_type == "hatsugen_choukai":
        bad_len = [f"{it['id']}({len(it['stem'])}字)" for it in items
                   if not STEM_MIN_CHARS <= len(it["stem"]) <= STEM_MAX_CHARS]
        add("stem length for listening", "warn" if bad_len else "pass",
            f"outside {STEM_MIN_CHARS}-{STEM_MAX_CHARS}字: {bad_len}" if bad_len
            else f"all stems within {STEM_MIN_CHARS}-{STEM_MAX_CHARS}字")

        try:
            bank = set(seedtable.load(item_type).scene_bank)
        except FileNotFoundError:
            bank = set()
        if bank:
            unknown = sorted({it.get("scene_id") for it in items
                              if it.get("scene_id") and it["scene_id"] not in bank})
            n_scenes = len({it.get("scene_id") for it in items if it.get("scene_id")})
            add("scenes come from the bank", "fail" if unknown else "pass",
                f"not in the bank: {unknown}" if unknown
                else f"{n_scenes} scene(s) reused across {n} items")

    # 9. Shared utterances are supposed to collapse into one file, so the
    #    manifest should be smaller than the clips the items ask for between
    #    them. The old form of this check assumed five clips per item —
    #    narration plus four spoken options — which is true of exactly one of
    #    the nine types. A dialogue item plans more than five and made the
    #    check report a manifest larger than its own stated maximum; a reading
    #    item plans none.
    clips = bundle.get("audio_manifest", [])
    planned = sum(
        len(tts_plan.plan_item(_as_generator_shape(it), it["id"])) for it in items
    )
    if not planned:
        add("audio manifest", "pass", "no audio — this item type is read, not heard")
    elif len(clips) > planned:
        add("audio manifest", "fail",
            f"{len(clips)} clip(s) for {planned} planned — the manifest has entries "
            "no item asked for")
    else:
        saved = planned - len(clips)
        add("audio manifest", "pass",
            f"{len(clips)} clip(s) for {n} items"
            + (f" — {saved} shared utterance(s) collapsed" if saved else ""))

    return report


def _as_generator_shape(bundle_item: dict) -> dict:
    """Turn a bundle item back into what the generator emitted, so the same
    validator can be re-run over it.

    Mostly this drops bundle-only keys. The one real translation is documents:
    the bundle normalises them to a list under `documents`, because everything
    downstream would rather deal with one shape — but the validator checks the
    type's own field, singular for the three types that have exactly one. Left
    untranslated, every committed document item failed its own re-validation
    with "missing field: document" while being perfectly well formed.
    """
    it = dict(bundle_item)
    it.pop("correct_index", None)
    it.pop("audio", None)
    it.pop("id", None)
    it.pop("model_p_correct", None)

    field = schemas.DOCUMENT_FIELDS.get(it.get("item_type", ""))
    documents = it.pop("documents", None)
    if field and documents is not None:
        it[field] = documents if field == "documents" else (documents or [None])[0]

    dialogue = it.get("dialogue")
    if isinstance(dialogue, list):
        # The bundle staples a clip id onto each turn; the generator did not.
        it["dialogue"] = [
            {"speaker_role": t.get("speaker_role", ""), "text": t.get("text", "")}
            for t in dialogue
            if isinstance(t, dict)
        ]
    return it


def _worst_pair_score(items: list[dict]) -> float:
    worst = 0.0
    sigs = [dedupe.item_signature(it) for it in items]
    for i in range(len(sigs)):
        for j in range(i + 1, len(sigs)):
            worst = max(worst, dedupe.similarity(sigs[i], sigs[j]))
    return worst


def _correct_is_extreme(item: dict, *, longest: bool) -> bool:
    lengths = [len(o["text"]) for o in item["options"]]
    target = max(lengths) if longest else min(lengths)
    ci = item.get("correct_index", 0)
    # Ties do not count as a leak — if two options share the extreme, length
    # does not single the answer out.
    return lengths[ci] == target and lengths.count(target) == 1
