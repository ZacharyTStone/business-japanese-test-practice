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

from .. import llm, textutil


@dataclass
class DiscriminatorResult:
    item_type: str
    n_generated: int
    n_official: int
    discrimination_rate: float  # fraction the judge labelled correctly (0.5 == chance)
    reasons: list[str] = field(default_factory=list)


def run_discriminator(
    item_type: str,
    generated_items: list[dict],
    official_items: list[dict],
    *,
    seed: int | None = None,
) -> DiscriminatorResult:
    if not generated_items or not official_items:
        raise ValueError("need at least one generated and one official item")

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
