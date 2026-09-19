"""Item-type generators. One module, prompt, and schema per type.

All nine BJT types are represented, plus 画像把握, the picture variant of 場面把握. They are grouped by what their stimulus is
rather than by which section of the exam they belong to, because that is what
decides the shape of the code: an utterance, a heard scene, and a document need
different prompts, different validation, and different audio plans, while two
types from different sections that both hand you a document need the same ones.
"""
from __future__ import annotations

from .gazou_haaku import GazouHaakuGenerator
from .goi_bunpou import GoiBunpouGenerator
from .hatsugen_choukai import HatsugenChoukaiGenerator
from .hyougen import HyougenGenerator
from .listening import BamenHaakuGenerator, SougouChoukaiGenerator
from .reading import (
    JoukyouHaakuGenerator,
    ShiryouChoudokkaiGenerator,
    SougouChoudokkaiGenerator,
    SougouDokkaiGenerator,
)

#: Every generator, keyed by item type. The keys must match `item_types` in the
#: database — supabase/test/run.sh is not the place that checks this, so
#: tests/test_generators.py is.
GENERATORS = {
    g.item_type: g
    for g in (
        # 聴解
        BamenHaakuGenerator,
        GazouHaakuGenerator,
        HatsugenChoukaiGenerator,
        SougouChoukaiGenerator,
        # 聴読解
        JoukyouHaakuGenerator,
        ShiryouChoudokkaiGenerator,
        SougouChoudokkaiGenerator,
        # 読解
        GoiBunpouGenerator,
        HyougenGenerator,
        SougouDokkaiGenerator,
    )
}


def get_generator(item_type: str, store=None):
    if item_type not in GENERATORS:
        raise KeyError(
            f"no generator for {item_type!r}; available: {sorted(GENERATORS)}"
        )
    return GENERATORS[item_type](store=store)
