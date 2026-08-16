"""Shared generator machinery.

One generator per item type (subclass), each with its own prompt and few-shot
set — never a single generic "generate a BJT question" function with a type
parameter, because the item shapes differ too much and quality collapses when
they share a prompt.

The base handles everything type-independent: loading licensed few-shot examples
from seeds/, assembling the role spec and level descriptor, feeding recent topics
back as a do-not-repeat list, validating against the schema, retrying with the
validation errors appended, and shuffling option order so the correct answer is
never positionally predictable.
"""
from __future__ import annotations

import json
import random
from typing import Optional

from .. import config, levels, llm, schemas
from ..fidelity import roles


def load_seed_json(subdir: str, item_type: str) -> list[dict]:
    """Load a licensed seed file, e.g. seeds/fewshot/goi_bunpou.json. Missing
    files return [] — the caller decides how loudly to complain."""
    path = config.SEEDS_DIR / subdir / f"{item_type}.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []


class Generator:
    item_type: str = ""
    #: One-line label shown in the CLI.
    label: str = ""
    #: Type-specific guidance appended to the system prompt.
    task_spec: str = ""

    def __init__(self, store=None):
        self.store = store

    # -- prompt assembly ---------------------------------------------------

    def _role_spec(self) -> str:
        lines = [
            f"- {r}: {roles.ROLE_DESCRIPTIONS[r]}" for r in roles.DISTRACTOR_ROLES[self.item_type]
        ]
        return (
            "Every wrong option must be wrong for a specific, nameable reason drawn "
            "from this fixed set of distractor roles. Use three DISTINCT roles for the "
            "three distractors (do not reuse a role). Mark the correct option with role "
            "'correct'.\n" + "\n".join(lines)
        )

    def _fewshot_block(self) -> str:
        examples = load_seed_json("fewshot", self.item_type)
        if not examples:
            return ""
        rendered = []
        for ex in examples[:5]:
            rendered.append(json.dumps(ex, ensure_ascii=False, indent=2))
        return (
            "Here are reference examples in the exact target style, including the "
            "official 解説 that explains why each distractor fails. Match this item "
            "shape and this quality of explanation — do not copy their content:\n\n"
            + "\n\n".join(rendered)
        )

    def system_prompt(self, level: str) -> str:
        parts = [
            "You are an item writer for the BJT ビジネス日本語能力テスト "
            "(Business Japanese Proficiency Test). You write a single "
            f"{self.label} item.",
            self.task_spec,
            self._role_spec(),
            f"Target level: {level}. Calibrate difficulty to this descriptor:\n"
            f"{levels.descriptor(level)}",
            "Write the 解説 (explanation) in Japanese: state why the answer is correct "
            "and why each distractor fails, naming the failure. Add a one-line English "
            "gloss. List any business vocabulary worth noting.",
            "Return only the structured JSON object.",
        ]
        fs = self._fewshot_block()
        if fs:
            parts.insert(2, fs)
        return "\n\n".join(parts)

    def user_prompt(self, level: str, avoid_topics: list[str]) -> str:
        u = [f"Write one {self.label} item at level {level}."]
        if avoid_topics:
            joined = "、".join(dict.fromkeys(avoid_topics))  # de-dup, keep order
            u.append(
                "Do NOT reuse any of these recently used business scenarios; pick a "
                f"clearly different one:\n{joined}"
            )
        return "\n\n".join(u)

    # -- generation --------------------------------------------------------

    def generate(self, level: str, *, max_attempts: int = 3, seed: Optional[int] = None) -> dict:
        if not schemas.valid_level(level):
            raise ValueError(f"invalid level {level!r}")

        avoid = []
        if self.store is not None:
            avoid = self.store.recent_topics(self.item_type, config.RECENT_TOPICS_WINDOW)

        schema = schemas.build_item_schema(self.item_type)
        system = self.system_prompt(level)
        user = self.user_prompt(level, avoid)

        last_errors: list[str] = []
        for attempt in range(max_attempts):
            prompt = user
            if last_errors:
                prompt = (
                    user
                    + "\n\nThe previous attempt was rejected for these reasons — fix them:\n"
                    + "\n".join(f"- {e}" for e in last_errors)
                )
            item = llm.generate_structured(system, prompt, schema)
            errors = schemas.validate_item(self.item_type, item)
            if not errors:
                return self._finalize(item, level, seed)
            last_errors = errors

        raise llm.LLMError(
            f"could not produce a valid {self.item_type} item in {max_attempts} attempts; "
            f"last errors: {last_errors}"
        )

    def _finalize(self, item: dict, level: str, seed: Optional[int]) -> dict:
        """Shuffle option order so the correct answer is not positionally
        predictable, and stamp the level."""
        rng = random.Random(seed)
        opts = list(item["options"])
        rng.shuffle(opts)
        item["options"] = opts
        item["level"] = level
        item["item_type"] = self.item_type
        return item
