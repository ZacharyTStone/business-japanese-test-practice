"""Fidelity mechanism #3 — the discriminator loop.

Mix official sample items with generated ones and ask a judge model to identify
which are synthetic. Above-chance discrimination means there is a tell; the judge
is asked *why*, so its stated reasons can be folded back into the generator
prompt as explicit constraints. The discrimination rate is the headline fidelity
metric and should trend toward 50% (chance) over time.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from .. import llm, schemas, textutil


@dataclass
class DiscriminatorResult:
    item_type: str
    n_generated: int
    n_official: int
    discrimination_rate: float  # fraction the judge labelled correctly (0.5 == chance)
    reasons: list[str] = field(default_factory=list)


def _carries(items: list[dict], part: str) -> int:
    if part == "資料":
        return sum(1 for it in items if schemas.documents_of(it))
    return sum(1 for it in items if it.get("dialogue"))


def _refuse_lopsided(generated: list[dict], official: list[dict]) -> None:
    """Refuse a comparison that would measure the seed files instead of the items.

    The judge is shown the whole stimulus, 資料 and 会話 included. If every
    generated item has a 資料 and no official sample does — which is how
    `seeds/official/*.json` arrives, since transcribing a printed table is work
    somebody has to do by hand — then "has a 資料" separates the two sides
    perfectly and the rate is 100% no matter how good the items are. That would
    be bad enough as a wrong number on a dashboard. It is worse than that here,
    because `bjt discriminate` folds the judge's stated tells back into the
    generator prompt: the next night's items would be written to avoid having a
    document at all.

    So this is a fault in the comparison, not a result to report. It says which
    seed file to fix.
    """
    for part in ("資料", "会話"):
        ours, theirs = _carries(generated, part), _carries(official, part)
        if ours and not theirs:
            raise ValueError(
                f"every one of the {ours} generated item(s) with a {part} is being "
                f"compared against official samples that have none, so the judge "
                f"can separate the two sides on that alone. Add the {part} to the "
                f"official samples in seeds/official/, or discriminate a type that "
                f"does not have one."
            )


def run_discriminator(
    item_type: str,
    generated_items: list[dict],
    official_items: list[dict],
    *,
    seed: int | None = None,
) -> DiscriminatorResult:
    if not generated_items or not official_items:
        raise ValueError("need at least one generated and one official item")

    _refuse_lopsided(generated_items, official_items)

    rng = random.Random(seed)
    labelled = [(textutil.render_for_discriminator(it), "synthetic") for it in generated_items]
    labelled += [(textutil.render_for_discriminator(it), "official") for it in official_items]
    rng.shuffle(labelled)

    rendered = [r for r, _ in labelled]
    truth = [t for _, t in labelled]

    result = llm.judge_synthetic(rendered)
    guesses = result.get("labels", [])
    reasons = result.get("reasons", [])

    # If the judge returned the wrong number of labels, score only the aligned prefix.
    n = min(len(guesses), len(truth))
    correct = sum(1 for i in range(n) if guesses[i] == truth[i])
    rate = correct / n if n else 0.0

    return DiscriminatorResult(
        item_type=item_type,
        n_generated=len(generated_items),
        n_official=len(official_items),
        discrimination_rate=rate,
        reasons=reasons,
    )
