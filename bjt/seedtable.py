"""The seed table — where item diversity actually comes from.

The temptation with a generator is to make the prompt say "be varied" and hope.
That produces the same three scenarios forever. Instead, variety is a property of
the *input*: a committed table of axes (場面 × 関係 × 機能 × レベル) is enumerated
into concrete cells, each cell is consumed at most once, and the generator is
handed one cell per item. A run of ten items is ten different cells by
construction, not by luck.

The table is our own design, not licensed material, so unlike ``seeds/`` it is
committed. Each cell also carries the reusable scene ids for its setting: images
are drawn from a small shared bank (one picture per item is not affordable and
not necessary), so the setting decides which bank entries are legal.

A cell is valid when all three constraints hold:
  * the relation is one the setting can plausibly contain (``setting_relations``)
  * the relation is one the function can be performed on (``function.relations``)
  * the setting's channel is one the function can occur over (``function.channels``)

That last one is what stops "来客を迎えて案内する" from being generated over the
phone.
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass
from typing import Iterable, Optional

from . import config

# Keyed by (directory, item_type) so pointing config.SEEDTABLE_DIR somewhere
# else — as the tests do — does not serve a stale table.
_CACHE: dict[tuple[str, str], "SeedTable"] = {}


@dataclass(frozen=True)
class Cell:
    """One generation assignment: a specific situation to write an item about."""

    item_type: str
    setting: str
    relation: str
    function: str
    level: str
    channel: str
    scenes: tuple[str, ...]
    # Japanese labels, carried along so the prompt and the CLI can show them.
    setting_ja: str
    relation_ja: str
    function_ja: str
    #: Document templates this setting may be rendered in — the reading types'
    #: equivalent of `scenes`. Empty for types whose stimulus is not a document.
    templates: tuple[str, ...] = ()

    @property
    def id(self) -> str:
        return f"{self.setting}+{self.relation}+{self.function}@{self.level}"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "setting": self.setting,
            "relation": self.relation,
            "function": self.function,
            "level": self.level,
            "channel": self.channel,
        }

    def describe_ja(self) -> str:
        return f"{self.setting_ja} / {self.relation_ja} / {self.function_ja}（{self.level}）"


class SeedTable:
    def __init__(self, item_type: str, data: dict):
        self.item_type = item_type
        self.data = data
        self.levels: list[str] = data.get("levels", [])
        self._settings = {s["id"]: s for s in data.get("settings", [])}
        self._relations = {r["id"]: r for r in data.get("relations", [])}
        self._functions = {f["id"]: f for f in data.get("functions", [])}
        self._setting_relations: dict[str, list[str]] = data.get("setting_relations", {})
        self._cells = tuple(self._enumerate())

    # -- enumeration -------------------------------------------------------

    def _enumerate(self) -> Iterable[Cell]:
        for s_id, s in self._settings.items():
            allowed_relations = set(self._setting_relations.get(s_id, []))
            for f_id, f in self._functions.items():
                if s["channel"] not in f.get("channels", []):
                    continue
                for r_id in f.get("relations", []):
                    if r_id not in allowed_relations or r_id not in self._relations:
                        continue
                    for level in self.levels:
                        yield Cell(
                            item_type=self.item_type,
                            setting=s_id,
                            relation=r_id,
                            function=f_id,
                            level=level,
                            channel=s["channel"],
                            scenes=tuple(s.get("scenes", [])),
                            templates=tuple(s.get("templates", [])),
                            setting_ja=s.get("ja", s_id),
                            relation_ja=self._relations[r_id].get("ja", r_id),
                            function_ja=f.get("ja", f_id),
                        )

    def cells(self, level: Optional[str] = None) -> list[Cell]:
        return [c for c in self._cells if level is None or c.level == level]

    def get(self, cell_id: str) -> Optional[Cell]:
        return next((c for c in self._cells if c.id == cell_id), None)

    @property
    def scene_bank(self) -> list[str]:
        """Every scene id the table can ask for — the image bank to commission."""
        seen: list[str] = []
        for s in self._settings.values():
            for sc in s.get("scenes", []):
                if sc not in seen:
                    seen.append(sc)
        return seen

    @property
    def template_bank(self) -> list[str]:
        """Every document template this table can ask for. The reading types'
        counterpart of `scene_bank`: the set a batch's documents must come
        from, known before any document is written."""
        seen: list[str] = []
        for s in self._settings.values():
            for t in s.get("templates", []):
                if t not in seen:
                    seen.append(t)
        return seen

    @property
    def scene_labels(self) -> dict:
        """scene id → what the picture shows. Lives in the table rather than
        being inferred from the settings that use it: a scene like
        `scene_phone_desk` is shared by several settings, and guessing its label
        from whichever one happens to come first gets it wrong."""
        return dict(self.data.get("scenes", {}))

    # -- sampling ----------------------------------------------------------

    def sample(
        self,
        n: int,
        *,
        level: Optional[str] = None,
        exclude_ids: Iterable[str] = (),
        seed: Optional[int] = None,
    ) -> list[Cell]:
        """Pick n unused cells, spread as widely as the axes allow.

        Uniform random sampling clumps: with 22 functions and 10 settings you can
        easily draw three 電話 items in a row. So we sample greedily instead —
        each pick prefers a setting and a function not yet used in this batch,
        and only starts reusing an axis value once every value has been used
        once. That is what makes "ten items" mean "ten genuinely different
        situations".
        """
        excluded = set(exclude_ids)
        pool = [c for c in self.cells(level) if c.id not in excluded]
        rng = random.Random(seed)
        rng.shuffle(pool)

        picked: list[Cell] = []
        used_settings: dict[str, int] = {}
        used_functions: dict[str, int] = {}
        for _ in range(min(n, len(pool))):
            best = min(
                pool,
                key=lambda c: (
                    used_settings.get(c.setting, 0) + used_functions.get(c.function, 0),
                    used_functions.get(c.function, 0),
                ),
            )
            pool.remove(best)
            picked.append(best)
            used_settings[best.setting] = used_settings.get(best.setting, 0) + 1
            used_functions[best.function] = used_functions.get(best.function, 0) + 1
        return picked

    # -- reporting ---------------------------------------------------------

    def coverage(self, used_ids: Iterable[str]) -> dict:
        used = set(used_ids)
        total = len(self._cells)
        by_function: dict[str, int] = {f: 0 for f in self._functions}
        by_setting: dict[str, int] = {s: 0 for s in self._settings}
        for c in self._cells:
            if c.id in used:
                by_function[c.function] += 1
                by_setting[c.setting] += 1
        return {
            "total_cells": total,
            "used_cells": len(used & {c.id for c in self._cells}),
            "by_function": by_function,
            "by_setting": by_setting,
            "scene_bank": len(self.scene_bank),
        }


def load(item_type: str) -> SeedTable:
    """Load (and cache) the seed table for an item type.

    Raises FileNotFoundError when a type has no table yet — that is deliberate:
    a generator without a seed table would fall back to prompt-driven variety,
    which is the failure mode this whole module exists to prevent.
    """
    key = (str(config.SEEDTABLE_DIR), item_type)
    if key in _CACHE:
        return _CACHE[key]
    path = config.SEEDTABLE_DIR / f"{item_type}.json"
    if not path.exists():
        raise FileNotFoundError(f"no seed table for {item_type!r} at {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    table = SeedTable(item_type, data)
    _CACHE[key] = table
    return table


def available() -> list[str]:
    """Item types that have a seed table committed."""
    if not config.SEEDTABLE_DIR.exists():
        return []
    return sorted(p.stem for p in config.SEEDTABLE_DIR.glob("*.json"))
