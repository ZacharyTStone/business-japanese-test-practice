"""Shared generator machinery.

One generator per item type (subclass), each with its own prompt and few-shot
set — never a single generic "generate a BJT question" function with a type
parameter, because the item shapes differ too much and quality collapses when
they share a prompt.

The base handles everything type-independent: loading licensed few-shot examples
from seeds/, assembling the role spec and level descriptor, handing the model one
seed-table cell to write about, feeding recent topics back as a do-not-repeat
list, validating against the schema, retrying with the validation errors
appended, and shuffling option order so the correct answer is never positionally
predictable.
"""
from __future__ import annotations

import json
import random
import re
from typing import Optional

from .. import batch as batchmod
from .. import config, levels, llm, phrasebook, render, schemas, seedtable
from ..fidelity import naturalness, roles


#: What a relation means when its label cannot carry all of it. Almost every
#: label can: 部下 → 上司 says everything a writer needs. ウチ/ソト cannot, because
#: the person the item turns on is neither of the two people talking — it is the
#: one being talked about — and a model shown only the arrow writes an ordinary
#: 社外 item in which nobody from the speaker's own side is mentioned at all.
#: The relation exists so a batch can aim at that on purpose.
RELATION_NOTES: dict[str, str] = {
    "uchi_to_soto": (
        "関係 is ウチ/ソト: the speaker is addressing someone outside the company — a "
        "client, a visitor, a customer — ABOUT someone inside it, usually their own "
        "superior. Toward an outsider one's own people are ウチ: named without a title "
        "or さん, given no 尊敬語, what they do said in 謙譲語 （「部長の田中は外出して"
        "おります」「田中がよろしくと申しておりました」, never 「田中部長はお出かけに"
        "なっています」）. Put that colleague at the centre of what has to be said — "
        "their absence, their message, their apology, their regards — so that the item "
        "turns on how they are referred to."
    ),
}


def relation_note(cell) -> str:
    """The note for this cell's relation, or "" for the ones whose label says it."""
    return RELATION_NOTES.get(getattr(cell, "relation", ""), "")


def with_relation_note(spec: str, cell) -> str:
    """A cell spec with its relation's note after it, when the relation has one.
    Every `cell_spec` ends here, so a relation that needs saying is said to
    every type whose table offers it."""
    note = relation_note(cell)
    return f"{spec}\n{note}" if note else spec


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
    #: When true, generation refuses to run without a seed-table cell. Types that
    #: get their variety from the table rather than from the prompt set this, so
    #: nobody can accidentally fall back to "write me a varied item".
    requires_cell: bool = False

    def __init__(self, store=None):
        self.store = store

    # -- prompt assembly ---------------------------------------------------

    def _role_spec(self) -> str:
        lines = [
            f"- {r}: {roles.ROLE_DESCRIPTIONS[r]}" for r in roles.DISTRACTOR_ROLES[self.item_type]
        ]
        return (
            "Every wrong option must be wrong for a specific, nameable reason drawn "
            "from this fixed set of distractor roles. Write exactly FOUR options: the "
            "correct one and three distractors with three DISTINCT roles (do not reuse a "
            "role). The set below has more roles than that, so at least one goes unused "
            "— never write one option per role. Mark the correct option with role "
            "'correct'. Every option also carries a `why`: one Japanese sentence naming "
            "the concrete reason THIS wording fails here — not a restatement of the role "
            "label.\n" + "\n".join(lines) + "\n\n"
            # The answerability gate's cold side shows a strong reader the four
            # options with the stem withheld and discards the item if the key
            # can be picked anyway. A distractor that is wrong on its own — a
            # malformed conjugation, a phrase nobody says — leaves the key as
            # the one option that reads well. Saying so here is the cheapest
            # fix there is, and it is exactly what the gate tests.
            "The four options, read on their own with the situation hidden, must "
            "look equally plausible: every distractor must be a real, well-formed "
            "expression a native speaker would use in SOME other business situation, "
            "and wrong only for this one. A distractor that is ungrammatical, "
            "misspelled, or awkward in isolation gives the answer away and fails "
            "review. The difficulty must live in the situation, never in the options."
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

    def _length_spec(self) -> str:
        """How long an item of this type is on the real paper.

        Read from the same table the offline check measures against
        (`batch.LENGTH_BANDS`), so the instruction and the check cannot disagree
        — and so that re-calibrating the exam's shapes moves both at once.

        Length is worth spending prompt on because it is most of what makes an
        item feel like the exam rather than like a textbook exercise, and it is
        the part a model gets wrong by default in a consistent direction: asked
        for a business reading passage it writes two hundred characters where
        the paper sets seven hundred, and asked for four options it writes four
        sentences where the paper prints four words.
        """
        bands = batchmod.LENGTH_BANDS.get(self.item_type)
        if not bands:
            return ""
        names = {
            "stem": "the stem (`stem`)",
            "option": "each option",
            "document": "all the documents together",
        }
        lines = [
            f"- {names.get(f, f)}: {low}–{high} characters"
            for f, (low, high) in bands.items()
        ]
        return (
            "Length, in Japanese characters, as the real paper sets it. These are "
            "the ranges an item of this type falls in; write to them rather than to "
            "whatever length the content happens to come out at, because length is "
            "most of what makes an item feel like the exam:\n" + "\n".join(lines)
        )

    def _discriminator_constraints(self) -> str:
        """Fold the judge's most recent tells back into the prompt as explicit
        constraints — this is what closes the discriminator loop (fidelity #3)."""
        if self.store is None:
            return ""
        tells = self.store.latest_tells(self.item_type)
        if not tells:
            return ""
        lines = "\n".join(f"- {t}" for t in tells)
        return (
            "A judge recently distinguished synthetic items from official ones using "
            "the tells below. Write this item so none of them apply — make it "
            "indistinguishable from an official item:\n" + lines
        )

    def cell_spec(self, cell: seedtable.Cell) -> str:
        """Render the seed cell as a hard assignment. Overridden by types that
        need to say more about their cell (scenes, channel, and so on)."""
        return with_relation_note(
            "Write this item for the following assigned situation. These are "
            "requirements, not suggestions — do not substitute a different "
            "setting, relationship, or communicative function:\n"
            f"- 場面: {cell.setting_ja}\n"
            f"- 関係: {cell.relation_ja}\n"
            f"- 機能（この発話でしたいこと）: {cell.function_ja}",
            cell,
        )

    def system_prompt(self, level: str) -> str:
        parts = [
            "You are an item writer for the BJT ビジネス日本語能力テスト "
            "(Business Japanese Proficiency Test). You write a single "
            f"{self.label} item.",
            self.task_spec,
            self._role_spec(),
            # Right after the roles, because most of it is about how a
            # distractor may be wrong. The principle in the role spec does not
            # hold on its own: asked for an over-polite distractor, a model
            # invents a keigo stack.
            naturalness.PROMPT,
            f"Target level: {level}. Calibrate difficulty to this descriptor:\n"
            f"{levels.descriptor(level)}",
            "Write the 解説 (explanation) in Japanese: state why the answer is correct "
            "and why each distractor fails, naming the failure. Add a one-line English "
            "gloss. List any business vocabulary worth noting.",
            "Return only the structured JSON object.",
        ]
        lengths = self._length_spec()
        if lengths:
            # After the task spec and the role spec, before the level: it is a
            # constraint on the shape rather than on the difficulty.
            parts.insert(3, lengths)
        fs = self._fewshot_block()
        if fs:
            parts.insert(2, fs)
        # For the spoken types only: the stock lines in the one wording the
        # library already has a voice for (bjt/phrasebook.py).
        stock = phrasebook.prompt_block(self.item_type)
        if stock:
            parts.insert(-1, stock)
        constraints = self._discriminator_constraints()
        if constraints:
            parts.insert(-1, constraints)  # just before the "return only JSON" line
        return "\n\n".join(parts)

    def user_prompt(self, level: str, avoid_topics: list[str], cell=None,
                    feedback: Optional[str] = None) -> str:
        u = [f"Write one {self.label} item at level {level}."]
        if cell is not None:
            u.append(self.cell_spec(cell))
        if avoid_topics:
            joined = "、".join(dict.fromkeys(avoid_topics))  # de-dup, keep order
            u.append(
                "Do NOT reuse any of these recently used business scenarios; pick a "
                f"clearly different one:\n{joined}"
            )
        if feedback:
            # What review said about the last draft for this shelf. A generator
            # that is wrong about a type is wrong about it all night unless it
            # is told; this is the one sentence that tells it, and it costs a
            # few tokens on the uncached half of the prompt.
            u.append(
                "The previous item written for this shelf tonight was REJECTED by "
                f"review: {feedback}. Write this one so that cannot happen."
            )
        return "\n\n".join(u)

    # -- validation hook ---------------------------------------------------

    def validate_extra(self, item: dict, cell=None) -> list[str]:
        """Type-specific checks beyond the shared schema. Default: none."""
        return []

    # -- generation --------------------------------------------------------

    def generate(
        self,
        level: Optional[str] = None,
        *,
        cell=None,
        max_attempts: int = 3,
        seed: Optional[int] = None,
        feedback: Optional[str] = None,
    ) -> dict:
        if cell is not None:
            level = cell.level
        if self.requires_cell and cell is None:
            raise ValueError(
                f"{self.item_type} requires a seed-table cell; variety for this type "
                "comes from the table, not from the prompt (see bjt/seedtable.py)"
            )
        if level is None or not schemas.valid_level(level):
            raise ValueError(f"invalid level {level!r}")

        avoid = []
        if self.store is not None:
            avoid = self.store.recent_topics(self.item_type, config.RECENT_TOPICS_WINDOW)

        schema = schemas.build_item_schema(self.item_type)
        system = self.system_prompt(level)
        user = self.user_prompt(level, avoid, cell, feedback)

        last_errors: list[str] = []
        for _attempt in range(max_attempts):
            prompt = user
            if last_errors:
                prompt = (
                    user
                    + "\n\nThe previous attempt was rejected for these reasons — fix them:\n"
                    + "\n".join(f"- {e}" for e in last_errors)
                )
            item = llm.generate_structured(system, prompt, schema)
            # The model's output does not name its own type — the schema has
            # no item_type field — and everything below that looks a document
            # up by type (documents_of, and through it the pruning) reads
            # item["item_type"]. Stamp it first, or the pruning below finds no
            # document and every blank callout costs the full three attempts.
            item["item_type"] = self.item_type
            # Every block field is required, so the unused ones arrive empty;
            # take them off first. Then a blank heading or callout is a model
            # tic, not a fault in the item; drop it rather than spend an
            # attempt asking for it back.
            for doc in schemas.documents_of(item):
                render.drop_unused_fields(doc)
                render.prune_empty_blocks(doc)
            # Numbers spelled out in kanji are the same kind of tic and get the
            # same answer: rewritten here rather than costing the draft, and
            # rewritten *before* the gate, the proofreader and the
            # discriminator see it, so all three judge the item as it will
            # ship. `to_bundle_item` does this too — this is the copy that
            # makes the fidelity checks honest.
            batchmod.normalise_numerals(item)
            repair_surplus_options(item)
            errors = schemas.validate_item(self.item_type, item)
            errors.extend(self.validate_extra(item, cell))
            # The tells a pattern can see — invented keigo, a placeholder, a
            # bracket in something heard, a narration that says the answer —
            # cost a retry here rather than a proofreader's call, and the
            # retry is told which line and why.
            errors.extend(naturalness.faults(item))
            if not errors:
                return self._finalize(item, level, seed, cell)
            last_errors = errors

        raise llm.LLMError(
            f"could not produce a valid {self.item_type} item in {max_attempts} attempts; "
            f"last errors: {last_errors}"
        )

    def _finalize(self, item: dict, level: str, seed: Optional[int], cell=None) -> dict:
        """Shuffle option order so the correct answer is not positionally
        predictable, and stamp the level and the cell it came from."""
        rng = random.Random(seed)
        opts = list(item["options"])
        rng.shuffle(opts)
        item["options"] = opts
        item["level"] = level
        item["item_type"] = self.item_type
        if cell is not None:
            item["seed_cell"] = cell.to_dict()
        return item


def repair_surplus_options(item: dict) -> list[str]:
    """Trim a draft with more than four options down to four, in place.

    A fifth option is the one schema fault the structured-output schema cannot
    forbid (the API's JSON-schema subset has no `maxItems`), and regenerating
    for it costs a whole generation per occurrence. The surplus is always a
    spare distractor: keep the correct option and the first three distractors
    with distinct roles, drop the rest, and let the ordinary validation and the
    gate judge what is left. Returns the texts dropped, for the log. A draft
    with fewer than four options, or with no single correct one, is left alone
    for the validator to reject.

    The 解説 was written about all five, so the sentences that quote a dropped
    option go with it (`drop_sentences_about`). Left in, they described an
    option the item no longer has, the proofreader rejected the draft as
    `explanation_mismatch`, and the trim saved nothing: 表現読解 J3 lost every
    draft that way on 2026-09-28 and 2026-10-01.
    """
    options = item.get("options")
    if not isinstance(options, list) or len(options) <= 4:
        return []
    correct = [o for o in options if isinstance(o, dict) and o.get("role") == roles.CORRECT]
    if len(correct) != 1:
        return []
    kept: list[dict] = [correct[0]]
    seen_roles: set[str] = set()
    dropped: list[str] = []
    for o in options:
        if o is correct[0]:
            continue
        role = o.get("role") if isinstance(o, dict) else None
        if len(kept) < 4 and role and role not in seen_roles:
            kept.append(o)
            seen_roles.add(role)
        else:
            dropped.append(str((o or {}).get("text", "")) if isinstance(o, dict) else str(o))
    # Keep the model's own order for what survives.
    item["options"] = [o for o in options if any(o is k for k in kept)]
    kept_texts = [str(o.get("text", "")) for o in kept if isinstance(o, dict)]
    for field in ("explanation_ja", "explanation_en"):
        if isinstance(item.get(field), str):
            item[field] = drop_sentences_about(item[field], dropped, kept_texts)
    return dropped


#: Quotation marks a 解説 quotes an option in: 「」『』 and the double quotes.
_QUOTED = re.compile(r"「([^」]+)」|『([^』]+)』|“([^”]+)”|\"([^\"]+)\"")
#: One sentence with its own ending and the space after it: up to 。！？, to
#: .!? before a space (so 1.5 stays whole), or to a line break. The pieces
#: join back into exactly the text they came from.
_SENTENCE = re.compile(r".+?(?:[。！？]+|[.!?]+(?=\s|$)|\n|$)\s*", re.S)


def _bare(text: str) -> str:
    return text.strip().rstrip("。．.！!？?").strip()


def drop_sentences_about(text: str, dropped: list[str], kept: list[str]) -> str:
    """`text` without the sentences that quote a dropped option.

    A sentence goes if it quotes something found in a dropped option and in no
    kept one — a 解説 often quotes a fragment （「遅れられまして」）, not the whole
    line — or carries a dropped option whole. Everything else stays, in order.
    If that would leave nothing, the text is returned as it was, for the
    proofreader to judge.
    """
    gone = [_bare(d) for d in dropped if _bare(d)]
    if not gone:
        return text
    keep = [_bare(k) for k in kept]

    def about_dropped(sentence: str) -> bool:
        for match in _QUOTED.finditer(sentence):
            quote = _bare(next(g for g in match.groups() if g))
            if len(quote) >= 2 and any(quote in d for d in gone) and not any(quote in k for k in keep):
                return True
        return any(d in sentence for d in gone)

    sentences = _SENTENCE.findall(text)
    survivors = [s for s in sentences if not about_dropped(s)]
    if len(survivors) == len(sentences) or not any(s.strip() for s in survivors):
        return text
    return "".join(survivors).strip()
