"""TTS planning — what to synthesise, in which voice, over which channel.

No audio is generated here and nothing is called. This module turns a gated item
into a manifest of clips; a separate offline step feeds that manifest to a TTS
provider and drops the files somewhere the app can fetch them. Splitting it this
way is what keeps the running cost at zero: synthesis happens once, per clip,
only for items that already passed every gate, and never at practice time.

Two decisions are encoded here.

**Voices are cast by role, not per item.** A learner who hears a different voice
for every question is doing speaker identification instead of 敬語. The seed
cell's 関係 decides who is speaking, so the voice follows from the relation and
stays the same across the whole library.

**Clip ids are content hashes.** 「かしこまりました。」 occurs in dozens of items;
hashing (voice, channel, text) means it is synthesised once and cached forever,
and re-running a batch re-uses every clip whose text did not change.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Optional

#: The narrator who reads the situation. Always the same, always neutral — the
#: narration is not part of what is being tested.
NARRATOR_VOICE = "narrator_f"

#: Relation → the voice of the person doing the speaking (the left side of the
#: 関係 arrow). Fixed for the life of the library.
RELATION_VOICES: dict[str, str] = {
    "subordinate_to_superior": "staff_junior_m",
    "junior_to_senior": "staff_junior_f",
    "superior_to_subordinate": "manager_m",
    "peer_to_peer": "staff_mid_f",
    "other_department": "staff_mid_m",
    "staff_to_client": "staff_mid_m",
    "staff_to_visitor": "reception_f",
    "staff_to_customer": "staff_mid_f",
}
_FALLBACK_VOICE = "staff_mid_m"

#: Channel → how the clip is post-processed. The phone profile is deliberately
#: degraded: business phone Japanese is harder to hear than studio audio, and an
#: item about a phone call that sounds like a studio recording is easier than the
#: real thing.
CHANNEL_PROFILES: dict[str, dict] = {
    "in_person": {"sample_rate": 24000, "band": None, "note": "clean room tone"},
    "phone": {
        "sample_rate": 8000,
        "band": [300, 3400],
        "note": "band-limited to a telephone line",
    },
    "video": {
        "sample_rate": 16000,
        "band": [120, 7000],
        "note": "slight compression, as an online meeting",
    },
}


@dataclass
class Clip:
    clip_id: str
    item_id: str
    kind: str  # "narration" | "option"
    index: Optional[int]  # option position, None for narration
    text: str
    voice: str
    channel: str

    def to_dict(self) -> dict:
        return {
            "clip_id": self.clip_id,
            "item_id": self.item_id,
            "kind": self.kind,
            "index": self.index,
            "text": self.text,
            "voice": self.voice,
            "channel": self.channel,
        }


def voice_for(item: dict) -> str:
    relation = (item.get("seed_cell") or {}).get("relation", "")
    return RELATION_VOICES.get(relation, _FALLBACK_VOICE)


def clip_id(voice: str, channel: str, text: str) -> str:
    """Content-addressed, so identical utterances share one audio file."""
    h = hashlib.sha1(f"{voice}|{channel}|{text}".encode("utf-8")).hexdigest()
    return h[:16]


def plan_item(item: dict, item_id: str) -> list[Clip]:
    """Every clip one item needs: the narrated situation, then each utterance.

    The narration is always in-person regardless of the item's channel — the
    narrator is outside the scene. Only the utterances get the phone treatment.
    """
    channel = item.get("channel", "in_person")
    voice = voice_for(item)
    clips = [
        Clip(
            clip_id=clip_id(NARRATOR_VOICE, "in_person", item["stem"]),
            item_id=item_id,
            kind="narration",
            index=None,
            text=item["stem"],
            voice=NARRATOR_VOICE,
            channel="in_person",
        )
    ]
    for i, opt in enumerate(item["options"]):
        clips.append(
            Clip(
                clip_id=clip_id(voice, channel, opt["text"]),
                item_id=item_id,
                kind="option",
                index=i,
                text=opt["text"],
                voice=voice,
                channel=channel,
            )
        )
    return clips


def manifest(items_with_ids: list[tuple[str, dict]]) -> list[dict]:
    """One de-duplicated clip list for a whole bundle."""
    seen: set = set()
    out: list[dict] = []
    for item_id, item in items_with_ids:
        for clip in plan_item(item, item_id):
            if clip.clip_id in seen:
                continue
            seen.add(clip.clip_id)
            out.append(clip.to_dict())
    return out
