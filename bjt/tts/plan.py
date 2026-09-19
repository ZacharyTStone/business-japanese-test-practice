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


#: What is spoken, per item type.
#:
#: This is the axis that actually differs between the nine types, and getting it
#: wrong is expensive in both directions: synthesising a document would be
#: nonsense and would also hand the learner the reading half for free, while
#: failing to synthesise a dialogue leaves an integrated listening item with
#: nothing to listen to.
#:
#: `stem` — the narrator reads the situation or the question.
#: `options` — the four options are spoken (only 発言聴解: there, the options ARE
#:   the utterances under test; everywhere else they are statements on the page
#:   and speaking them would turn a reading choice into a memory test).
#: `dialogue` — the multi-speaker exchange is played.
TYPE_AUDIO: dict[str, dict] = {
    "bamen_haaku":        {"stem": True,  "options": False, "dialogue": False},
    # The four descriptions of the picture are read by the narrator, as on the
    # exam: nobody in the picture is speaking them. One voice across every
    # item of the type is also what lets a description recur as one clip.
    "gazou_haaku":        {"stem": True,  "options": True,  "dialogue": False,
                           "options_by_narrator": True},
    "hatsugen_choukai":   {"stem": True,  "options": True,  "dialogue": False},
    "sougou_choukai":     {"stem": True,  "options": False, "dialogue": True},
    "joukyou_haaku":      {"stem": True,  "options": False, "dialogue": False},
    "shiryou_choudokkai": {"stem": True,  "options": False, "dialogue": False},
    "sougou_choudokkai":  {"stem": True,  "options": False, "dialogue": True},
    "goi_bunpou":         {"stem": False, "options": False, "dialogue": False},
    "hyougen":            {"stem": False, "options": False, "dialogue": False},
    "sougou_dokkai":      {"stem": False, "options": False, "dialogue": False},
}

#: Fallback for a type not yet in the table: narrate the stem and nothing else.
#: Silent would be worse — a listening item with no audio at all is a bug that
#: looks like a missing file.
_DEFAULT_AUDIO = {"stem": True, "options": False, "dialogue": False}

#: Voices for the extra speakers a dialogue needs. A conversation cast from
#: RELATION_VOICES alone would put every turn in one voice, since the relation
#: is a property of the item rather than of the turn. These are assigned in
#: order of first appearance and stay stable for the life of an item, because
#: the clip id hashes the voice: re-running a batch must not re-cast it.
DIALOGUE_VOICES = ["manager_m", "staff_junior_m", "staff_mid_f", "staff_mid_m", "reception_f"]


def audio_policy(item_type: str) -> dict:
    return TYPE_AUDIO.get(item_type, _DEFAULT_AUDIO)


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


def _dialogue_casting(turns: list[dict]) -> dict:
    """speaker_role → voice, assigned in order of first appearance.

    Stable by construction: the same dialogue always produces the same casting,
    so re-running a batch re-uses every clip instead of re-synthesising the lot
    under new voices.
    """
    casting: dict[str, str] = {}
    for turn in turns:
        role = turn.get("speaker_role")
        if role and role not in casting:
            casting[role] = DIALOGUE_VOICES[len(casting) % len(DIALOGUE_VOICES)]
    return casting


def plan_item(item: dict, item_id: str) -> list[Clip]:
    """Every clip one item needs, according to its type's audio policy.

    The narration is always in-person regardless of the item's channel — the
    narrator is outside the scene. Only what happens *inside* the scene (the
    utterances, the dialogue turns) gets the phone or video treatment.

    A type whose policy speaks nothing returns no clips at all. That is the
    right answer for 総合読解: it is a reading item, and an empty plan is how
    the pipeline says so.
    """
    policy = audio_policy(item.get("item_type", ""))
    channel = item.get("channel", "in_person")
    if channel not in CHANNEL_PROFILES:
        # `written` reaches here for a type that nonetheless narrates something.
        # The narration is still spoken aloud by a person, so it gets the
        # ordinary in-person treatment rather than no treatment at all.
        channel = "in_person"
    voice = voice_for(item)
    clips: list[Clip] = []

    if policy["stem"] and item.get("stem"):
        clips.append(
            Clip(
                clip_id=clip_id(NARRATOR_VOICE, "in_person", item["stem"]),
                item_id=item_id,
                kind="narration",
                index=None,
                text=item["stem"],
                voice=NARRATOR_VOICE,
                channel="in_person",
            )
        )

    if policy["dialogue"]:
        turns = item.get("dialogue") or []
        casting = _dialogue_casting(turns)
        for i, turn in enumerate(turns):
            turn_voice = casting.get(turn.get("speaker_role", ""), _FALLBACK_VOICE)
            clips.append(
                Clip(
                    clip_id=clip_id(turn_voice, channel, turn["text"]),
                    item_id=item_id,
                    kind="dialogue",
                    index=i,
                    text=turn["text"],
                    voice=turn_voice,
                    channel=channel,
                )
            )

    if policy["options"]:
        if policy.get("options_by_narrator"):
            voice, channel = NARRATOR_VOICE, "in_person"
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
