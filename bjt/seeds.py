"""Seeds the repository can make for itself.

`seeds/` is where licensed material goes — official sample items, the official
vocabulary list, the official level descriptors — and it is gitignored for that
reason. The generators read few-shot examples from it, and the few-shot
examples are most of what keeps a generated item close to the exam.

But the repository already holds examples in exactly that shape: the reference
batches in `batches/`, every item of which was composed by hand, reviewed by
the owner, and passed the same checks generated items must pass. They are
original work, not licensed text. When there is no licensed seed material —
no laptop with the files, no secret carrying them — this module builds a
`seeds/` from those batches instead, so the nightly job can write items whose
few-shot examples are the bank's own best ones rather than nothing at all.

What it does NOT make up: official items (`official/`, which the discriminator
and calibration need and which only the licence holder can supply), the JLPT
kanji tiers (a partial list would make the vocab gate strict about the wrong
set, so it is left absent and the gate stays permissive and says so), and the
level descriptors (the neutral built-in wording is used). A `BOOTSTRAPPED`
file is left in the directory saying all this, so nobody mistakes it for the
real thing, and the licensed material always wins when it is present.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from . import config

#: Fields of a published item that are about the bundle or the bank rather
#: than the item as an example: identity, provenance, media, the answer key
#: (the correct option is already marked by its role).
_NOT_AN_EXAMPLE_FIELD = ("id", "item_type", "level", "seed_cell", "audio", "correct_index")

#: The generator shows at most this many examples, and so does the bootstrap.
PER_TYPE = 5

MARKER = "BOOTSTRAPPED"


@dataclass
class Bootstrap:
    seeds_dir: Path
    fewshot: dict[str, int] = field(default_factory=dict)
    business_terms: int = 0
    skipped: str | None = None

    def summary(self) -> str:
        if self.skipped:
            return self.skipped
        lines = [
            f"Built {self.seeds_dir} from the reference batches:",
            *(f"  fewshot/{t}.json: {n} example(s)" for t, n in sorted(self.fewshot.items())),
            f"  vocab/business_terms.txt: {self.business_terms} term(s)",
            "  no official/ items, no JLPT kanji tiers, no level descriptors — "
            "those are licensed material and only a real seeds/ carries them.",
        ]
        return "\n".join(lines)


def has_licensed_seeds(seeds_dir: Path | None = None) -> bool:
    """True when `seeds/` holds anything a person put there.

    A bootstrapped directory is recognised by its marker and does not count:
    the licensed material must always be able to replace it.
    """
    seeds_dir = Path(seeds_dir or config.SEEDS_DIR)
    if not seeds_dir.exists() or (seeds_dir / MARKER).exists():
        return False
    return any((seeds_dir / sub).glob("*.json") for sub in ("fewshot", "official"))


def examples_from_batches(batch_dir: Path | None = None) -> dict[str, list[dict]]:
    """Up to PER_TYPE items per type, spread across the levels the bank has.

    Spread rather than the first five, so a type with items at three levels
    shows the model all three registers instead of five J3s.
    """
    batch_dir = Path(batch_dir or config.BATCH_DIR)
    by_type: dict[str, dict[str, list[dict]]] = {}
    for path in sorted(batch_dir.glob("*.json")):
        if path.name.endswith(".source.json"):
            continue
        try:
            bundle = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        items = bundle.get("items")
        if not isinstance(items, list) or not bundle.get("item_type"):
            continue
        shelf = by_type.setdefault(bundle["item_type"], {}).setdefault(bundle.get("level", "?"), [])
        shelf.extend(items)

    out: dict[str, list[dict]] = {}
    for item_type, levels in by_type.items():
        chosen: list[dict] = []
        queues = [list(levels[lvl]) for lvl in sorted(levels)]
        while len(chosen) < PER_TYPE and any(queues):
            for queue in queues:
                if queue and len(chosen) < PER_TYPE:
                    chosen.append(queue.pop(0))
        out[item_type] = [
            {k: v for k, v in item.items() if k not in _NOT_AN_EXAMPLE_FIELD}
            for item in chosen
        ]
    return out


def bootstrap(seeds_dir: Path | None = None, batch_dir: Path | None = None,
              example_dir: Path | None = None, *, force: bool = False) -> Bootstrap:
    """Write a `seeds/` the generators can use, from committed material only."""
    seeds_dir = Path(seeds_dir or config.SEEDS_DIR)
    example_dir = Path(example_dir or (config.ROOT / "seeds.example"))
    result = Bootstrap(seeds_dir=seeds_dir)

    if has_licensed_seeds(seeds_dir) and not force:
        result.skipped = (f"{seeds_dir} already holds seed material that is not bootstrapped; "
                          "leaving it alone (--force overrides).")
        return result

    (seeds_dir / "fewshot").mkdir(parents=True, exist_ok=True)
    (seeds_dir / "vocab").mkdir(parents=True, exist_ok=True)

    for item_type, examples in examples_from_batches(batch_dir).items():
        (seeds_dir / "fewshot" / f"{item_type}.json").write_text(
            json.dumps(examples, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        result.fewshot[item_type] = len(examples)

    # The business-term list in seeds.example is our own short list, not the
    # licensed one; it only ever adds a positive note to the quality report.
    terms_src = example_dir / "vocab" / "business_terms.txt"
    if terms_src.exists():
        terms = [ln.strip() for ln in terms_src.read_text(encoding="utf-8").splitlines()
                 if ln.strip() and not ln.startswith("#")]
        (seeds_dir / "vocab" / "business_terms.txt").write_text(
            "\n".join(terms) + "\n", encoding="utf-8")
        result.business_terms = len(terms)

    (seeds_dir / MARKER).write_text(
        "This seeds/ was built by `bjt seeds --bootstrap` from the reference batches in\n"
        "batches/. It holds no licensed material: no official items, no JLPT kanji\n"
        "tiers, no official level descriptors. Replace it with the real thing when you\n"
        "have it — `bjt seeds --bootstrap` will not overwrite a real seeds/.\n",
        encoding="utf-8",
    )
    return result
