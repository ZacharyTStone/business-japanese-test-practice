"""The scene bank: which pictures the library needs, and which exist.

Items name a `scene_id` from a small shared bank, never a picture of their own.
That is an economic decision before it is an aesthetic one — a thousand items
cannot have a thousand commissioned drawings — but it has a quality consequence
that matters more: because one picture serves many items, the picture cannot
contain the answer. An illustration specific enough to give the situation away
would make the listening optional.

Which is also why text, names and numbers are never drawn into the artwork. They
are overlaid by the app. One drawing serves many items, and nothing is at the
mercy of an image model's handwriting.

This module does no image generation. It says what is needed, what is present,
and writes the SQL that points the database at what has been approved — the same
split as ``bjt/tts``, and for the same reason: media arrives by review, not by a
job deciding it looks fine. The drawing, the review and the upload live in
``bjt/scene_art.py``; the review there applies the brief in `prompt_for` below,
rule by rule, and a draft that breaks one is rejected outright.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from . import batch as batchmod
from . import config, publish, seedtable, withdrawn

#: Extensions accepted as artwork, in the order preferred when more than one
#: exists for a scene. WebP first: these are flat illustrations, they are
#: downloaded on a phone, and the size difference is not marginal.
IMAGE_EXTENSIONS = (".webp", ".png", ".jpg", ".jpeg", ".svg")


@dataclass
class Scene:
    scene_id: str
    label_ja: str
    #: Which item types ask for this scene. A scene wanted by four types earns
    #: its commission before one wanted by a single cell.
    used_by: tuple[str, ...]
    #: How many seed cells can land on it — the demand for this picture.
    cell_count: int
    #: The approved file, relative to the `scenes` bucket. None means the item
    #: ships without a picture, which is allowed for a bank scene and is why a
    #: per-item picture's item is not served until it exists.
    path: str | None = None
    #: Set for a per-item picture (画像把握): the English brief the item was
    #: written with, and the question it must answer visibly. A bank scene has
    #: none of these — it is drawn from SCENE_BRIEFS and must give nothing away.
    brief: str | None = None
    question: str = ""
    options: tuple[str, ...] = ()
    answer: int | None = None

    @property
    def has_art(self) -> bool:
        return self.path is not None

    @property
    def is_picture(self) -> bool:
        return self.brief is not None


def storage_path(scene_id: str, suffix: str) -> str:
    return f"{scene_id}{suffix}"


#: Per-item pictures are scenes whose id is the item's id under this prefix,
#: so they use the same table, bucket and SQL as the bank and nothing else in
#: the app had to learn a second kind of picture.
PICTURE_PREFIX = "pic_"


def picture_scene_id(item_id: str) -> str:
    return f"{PICTURE_PREFIX}{item_id}"


#: A bank scene with no picture of its own borrows its neighbour's, so an item
#: shows a related room rather than nothing while the real drawing is pending
#: (or given up on). The pairs are settings a listener would not tell apart
#: from the narration: the narration says where you are, the picture only
#: sets a tone. Never the other way round for the per-item pictures, which ARE
#: the question. The owner asked for more reuse of the pictures (2026-09-19).
STAND_INS: dict[str, str] = {
    "scene_phone_mobile_outside": "scene_phone_desk",
    "scene_phone_desk": "scene_office_desk_pair",
    "scene_entrance_lobby": "scene_reception_counter",
    "scene_reception_counter": "scene_entrance_lobby",
    "scene_elevator_hall": "scene_corridor",
    "scene_corridor": "scene_elevator_hall",
    "scene_client_office_sofa": "scene_client_meeting_room",
    "scene_client_meeting_room": "scene_meeting_room_table",
    "scene_meeting_room_table": "scene_client_meeting_room",
    "scene_izakaya_table": "scene_restaurant_private",
    "scene_restaurant_private": "scene_izakaya_table",
    "scene_expo_booth": "scene_seminar_hall",
    "scene_seminar_hall": "scene_meeting_room_table",
    "scene_office_open_floor": "scene_office_desk_pair",
    "scene_office_desk_pair": "scene_office_open_floor",
}


def stand_in_for(scene: Scene, survey_result: list[Scene]) -> Scene | None:
    """The scene whose picture this one may borrow tonight, if any: its named
    stand-in when that has art of its own. One hop only, so a chain of
    missing pictures never lands on something unrelated."""
    if scene.has_art or scene.is_picture:
        return None
    other = STAND_INS.get(scene.scene_id)
    if other is None:
        return None
    match = next((s for s in survey_result if s.scene_id == other), None)
    return match if match is not None and match.has_art else None


def survey(media_dir: Path | None = None, remote: Iterable[str] = ()) -> list[Scene]:
    """Every scene the committed seed tables can ask for, and whether it exists.

    Demand is counted across all item types, because the bank is shared: a
    reception counter used by 場面把握 and 状況把握 and 発言聴解 is one drawing,
    and the point of the survey is to commission it before a scene that only one
    cell wants.

    `remote` is the listing of the storage bucket, when the caller has one. A
    scene whose file is already in the bucket has art even on a machine with an
    empty `media/` — the nightly runner, every night — and must not be drawn
    again. A local file wins over a remote one, because local is what has just
    been made and is about to be uploaded.
    """
    media_dir = Path(media_dir or config.MEDIA_DIR) / "scenes"
    remote = set(remote)

    labels: dict[str, str] = {}
    used_by: dict[str, set[str]] = {}
    demand: dict[str, int] = {}

    for item_type in seedtable.available():
        table = seedtable.load(item_type)
        labels.update(table.scene_labels)
        for cell in table.cells():
            for scene_id in cell.scenes:
                used_by.setdefault(scene_id, set()).add(item_type)
                demand[scene_id] = demand.get(scene_id, 0) + 1

    def existing(scene_id: str) -> str | None:
        for ext in IMAGE_EXTENSIONS:
            if (media_dir / f"{scene_id}{ext}").exists():
                return storage_path(scene_id, ext)
        for ext in IMAGE_EXTENSIONS:
            if storage_path(scene_id, ext) in remote:
                return storage_path(scene_id, ext)
        return None

    scenes = []
    for scene_id in sorted(used_by):
        scenes.append(
            Scene(
                scene_id=scene_id,
                label_ja=labels.get(scene_id, scene_id),
                used_by=tuple(sorted(used_by[scene_id])),
                cell_count=demand[scene_id],
                path=existing(scene_id),
            )
        )
    # Then the per-item pictures the committed bundles ask for. They come
    # after the bank in the commissioning order: a bank picture serves many
    # items, one of these serves one.
    for item_type, item in picture_items():
        scene_id = item["scene_id"]
        scenes.append(
            Scene(
                scene_id=scene_id,
                label_ja=item.get("topic", "") or scene_id,
                used_by=(item_type,),
                cell_count=1,
                path=existing(scene_id),
                brief=item["image_brief"],
                question=item.get("stem", ""),
                options=tuple(o["text"] for o in item.get("options", [])),
                answer=item.get("correct_index"),
            )
        )
    # Most-wanted first: this list is a commissioning order.
    return sorted(scenes, key=lambda s: (s.has_art, s.is_picture, -s.cell_count, s.scene_id))


def picture_items() -> list[tuple[str, dict]]:
    """Every committed item that carries its own picture brief, with its type.

    Read from the bundles rather than the seed tables, because a per-item
    picture is decided by the item (the generator writes the brief with the
    options) and not by the setting. A withdrawn item is left out: nobody will
    see its picture, so nobody should pay for one.
    """
    out: list[tuple[str, dict]] = []
    gone = withdrawn.ids()
    for path in batchmod.bundles():
        try:
            bundle = batchmod.load(path)
        except (OSError, ValueError):
            continue
        for item in withdrawn.live_items(bundle, gone):
            if item.get("image_brief") and str(item.get("scene_id", "")).startswith(PICTURE_PREFIX):
                out.append((bundle.get("item_type", ""), item))
    return out


#: The style every scene shares. One sentence, so that sixteen pictures drawn
#: on sixteen different nights still look like one bank.
STYLE = ("A clean editorial illustration of a Japanese workplace, flat colour, consistent "
         "line weight across the whole bank, neutral professional clothing, landscape 3:2.")

#: What each scene is, in the words an image model draws from. The seed
#: tables carry only a Japanese label, and the first brief glossed every one
#: of them as "a Japanese office setting" — so the restaurant's private room
#: came out as a meeting room and the outdoor phone call was drawn indoors,
#: three times, and rightly rejected each time (2026-09-19). The place is
#: stated here, once per scene, with the channel the picture must show.
#: Channel: in_person — the speaker is in the room with the viewer;
#: phone — the speaker is on a call, the viewer is the other end of the line;
#: video — the speaker is on the viewer's screen.
SCENE_BRIEFS: dict[str, tuple[str, str]] = {
    "scene_phone_desk": ("at their own desk in a Japanese office, on the desk telephone "
                         "(a handset, cord to a desk phone), other desks behind", "phone"),
    "scene_phone_mobile_outside": ("outdoors on a city street or a station concourse in "
                                   "Japan, daytime, on a mobile phone; buildings or a "
                                   "platform behind, no office interior", "phone"),
    "scene_meeting_room_table": ("a meeting room in a Japanese office, across the table, "
                                 "whiteboard blank, glass wall to the corridor", "in_person"),
    "scene_office_desk_pair": ("two desks facing each other on an open office floor in "
                               "Japan; the speaker has turned from their desk toward the "
                               "viewer's", "in_person"),
    "scene_video_call_laptop": ("seen on a laptop screen in a video call, head and "
                                "shoulders in a small home-office or meeting-room "
                                "background, as the viewer's screen shows them", "video"),
    "scene_corridor": ("a corridor in a Japanese office building, stopped for a word, "
                       "doors and a window along the wall", "in_person"),
    "scene_seminar_hall": ("a seminar hall with rows of chairs and a lectern, the "
                           "speaker at the front or in the aisle", "in_person"),
    "scene_office_open_floor": ("an open-plan office floor in Japan, standing between the "
                                "desks, colleagues working further back", "in_person"),
    "scene_izakaya_table": ("a table at a Japanese izakaya after work: wooden interior, "
                            "lanterns, small dishes and glasses on the table, no readable "
                            "menu", "in_person"),
    "scene_restaurant_private": ("a private room (個室) in a Japanese restaurant: tatami "
                                 "or a low table, closed sliding doors, no other diners "
                                 "visible at all — only the people at this table",
                                 "in_person"),
    "scene_elevator_hall": ("an elevator hall in an office building, elevator doors and "
                            "a call button, waiting for the lift", "in_person"),
    "scene_client_meeting_room": ("a meeting room at a client company, across the table, "
                                  "business cards and a glass of water on the table",
                                  "in_person"),
    "scene_expo_booth": ("a trade-show booth in an exhibition hall, a counter with "
                         "brochures (blank), banners without text, visitors in the "
                         "distance", "in_person"),
    "scene_entrance_lobby": ("the entrance lobby of a Japanese office building: high "
                             "ceiling, security gates, a reception counter further back",
                             "in_person"),
    "scene_reception_counter": ("the reception counter of the viewer's own company, the "
                                "speaker standing at the counter", "in_person"),
    "scene_client_office_sofa": ("a reception room at a client company: sofas and a low "
                                 "table, tea served, the speaker seated opposite",
                                 "in_person"),
}


def brief_for(scene_id: str) -> tuple[str, str]:
    """The English setting and the channel, or a safe generic for a scene the
    table does not know yet (a new seed table lands before its brief does)."""
    return SCENE_BRIEFS.get(scene_id, ("a Japanese business setting", "in_person"))


#: Who is in the picture. Every item that uses a scene is somebody speaking
#: to the learner: in 発言聴解 the learner chooses the reply, so the learner is
#: the one spoken to and is never in the picture — the viewer is the camera.
#: The speaker is the one principal figure, addressing the viewer. On the
#: phone the other end of the line is the viewer, so the speaker is alone;
#: on a video call the speaker is on the viewer's screen. Anyone else is
#: scenery. The first drafts were crowds of equals, and then, briefly, a
#: speaker and a listener drawn side by side even on the phone (the owner,
#: 2026-09-19). What is being said stays invisible — this is who, not what.
COMPOSITION: dict[str, str] = {
    "in_person": (
        "Composition: one principal figure — the person speaking — in the "
        "foreground, turned toward the viewer and addressing them, mid-sentence, "
        "with an open, addressing posture. The viewer is the person being spoken "
        "to and is NOT drawn: no second figure faces the speaker, no listener in "
        "the frame. If the setting needs other people, they are small, further "
        "back, muted, and plainly not part of the conversation. The speaker's "
        "expression and gesture are neutral and give nothing away about what is "
        "being said."
    ),
    "phone": (
        "Composition: one principal figure — the person speaking — on the phone, "
        "mid-call, in the foreground. The person they are talking to is the viewer, "
        "on the other end of the line, so nobody in the picture is being addressed: "
        "no listener beside them, no second principal figure. Others, if the "
        "setting needs them, are small, distant and uninvolved. Expression and "
        "gesture neutral; nothing about what is being said."
    ),
    "video": (
        "Composition: one principal figure — the person speaking — as they appear "
        "in a video-call window on the viewer's screen: head and shoulders, facing "
        "the camera and addressing it. The viewer is the other participant and is "
        "not drawn. No readable interface, no text, no second person on screen. "
        "Expression neutral; nothing about what is being said."
    ),
}


def composition_for(scene_id: str) -> str:
    return COMPOSITION[brief_for(scene_id)[1]]


#: What a draft may not contain. Each clause is here because its absence
#: produces an unusable image: readable text ruins reuse and gets the kanji
#: wrong, a recognisable face makes the picture a person, and a scene that
#: gives the scenario away makes the listening optional. The reviewer in
#: `scene_art` checks these same clauses, one flag each.
FORBIDDEN = (
    "any readable text, signage, logo, brand mark, chart or user interface "
    "(labels are overlaid by the app, so drawn text makes the picture single-use "
    "and gets the kanji wrong)",
    "a recognisable likeness of any real person",
    "anything that fixes the situation more tightly than the setting does — this "
    "picture is shared by many items, and an illustration that gives the scenario "
    "away makes the listening optional",
    "malformed hands, extra limbs, or more people than the setting calls for",
    "a second principal figure — a listener or partner drawn as prominently as "
    "the speaker, or a crowd of equals — so that it is not clear who is speaking "
    "to the viewer (the viewer is the one spoken to and is never in the picture)",
)


#: What a per-item picture may not contain. Shorter than the bank's list on
#: purpose: this picture is the question, so "gives the scenario away" and
#: "a second principal figure" are not faults here — they are the point.
PICTURE_FORBIDDEN = (
    "any readable text, signage, logo, brand mark, chart or user interface "
    "(the app overlays nothing on these, but drawn text gets the kanji wrong and "
    "a sign would answer the question for the listener)",
    "a recognisable likeness of any real person",
    "malformed hands, extra limbs, or more people than the brief calls for",
    "anything the brief does not describe that a viewer could take for the "
    "action being asked about — one clear thing is happening, and nothing "
    "else in the picture competes with it",
)


def prompt_for(scene: Scene) -> str:
    """The brief for one scene, as a contract rather than a wish."""
    if scene.is_picture:
        return picture_prompt_for(scene)
    return "\n".join([
        f"scene_id: {scene.scene_id}",
        f"設定: {scene.label_ja}",
        f"使用する問題タイプ: {'、'.join(scene.used_by)}",
        "",
        STYLE,
        "",
        f"The place: {brief_for(scene.scene_id)[0]}.",
        "",
        composition_for(scene.scene_id),
        "",
        "Must NOT contain:",
        *(f"  - {clause};" for clause in FORBIDDEN),
    ])


def picture_prompt_for(scene: Scene) -> str:
    """The brief for a per-item picture, for the reviewer: what it must show,
    and the four descriptions it must separate."""
    numbered = "\n".join(f"  {i}. {o}" for i, o in enumerate(scene.options))
    return "\n".join([
        f"scene_id: {scene.scene_id}  (a picture drawn for one 画像把握 item)",
        f"題材: {scene.label_ja}",
        "",
        STYLE,
        "",
        "What the picture must show, unmistakably, so that exactly one of the "
        "descriptions below is true of it and the other three are visibly false:",
        scene.brief or "",
        "",
        f"The question the learner hears: {scene.question}",
        "The four descriptions (the correct one is marked):",
        numbered.replace(f"  {scene.answer}. ", f"  {scene.answer}. ✔ ") if scene.answer is not None else numbered,
        "",
        "Must NOT contain:",
        *(f"  - {clause};" for clause in PICTURE_FORBIDDEN),
    ])


def image_prompt(scene: Scene) -> str:
    """The same brief, addressed to an image model rather than a person.

    The setting is stated first and positively, because that is what an image
    model draws; the prohibitions follow in the same words the reviewer uses,
    so a draft is judged by the rule it was given.
    """
    if scene.is_picture:
        return "\n".join([
            f"{STYLE} This picture is a test question: it must show one clear, "
            "specific moment at work, readable at a glance, and nothing generic.",
            "",
            f"Show exactly this: {scene.brief}",
            "",
            "The people are in ordinary Japanese office clothing, drawn clearly, with "
            "their action and posture unmistakable; the setting is recognisable and "
            "uncluttered. Everything in the frame supports the one action described.",
            "",
            "The image must not contain:",
            *(f"- {clause}." for clause in PICTURE_FORBIDDEN),
            "",
            "No words or letters anywhere in the picture, in any language. Signs, "
            "screens, papers and whiteboards are blank.",
        ])
    return "\n".join([
        f"{STYLE} The setting: {scene.label_ja} — {brief_for(scene.scene_id)[0]}. "
        "Show that place, unmistakably, mid-moment, with nothing that says what "
        "is being said.",
        "",
        composition_for(scene.scene_id),
        "",
        "The image must not contain:",
        *(f"- {clause}." for clause in FORBIDDEN),
        "",
        "No words or letters anywhere in the picture, in any language. Signs, "
        "screens, papers and whiteboards are blank.",
    ])


def to_sql(scenes: list[Scene]) -> str:
    """Point the database at the approved artwork.

    Only scenes that have a file. A scene with no art is left exactly as it is —
    `image_path` stays null, the app draws the item without a picture, and
    nothing about that is an error.
    """
    with_art = [s for s in scenes if s.has_art]
    borrowed = [(s, stand_in_for(s, scenes)) for s in scenes]
    borrowed = [(s, other) for s, other in borrowed if other is not None]
    if not with_art:
        return (
            "-- No approved scene artwork found. Nothing to apply.\n"
            "-- Put files in media/scenes/<scene_id>.webp and re-run `bjt scenes`.\n"
        )

    rows = [(s.scene_id, s.label_ja, s.path) for s in with_art]
    # A scene without a picture of its own shows its stand-in's until its own
    # is drawn; the upsert overwrites the borrowed path the night that happens.
    rows += [(s.scene_id, s.label_ja, other.path) for s, other in borrowed]
    values = ",\n       ".join(
        f"({publish.lit(sid)}, {publish.lit(label)}, {publish.lit(path)})"
        for sid, label, path in sorted(rows)
    )
    notes = [f"-- Artwork for {len(with_art)} scene(s)."]
    for s, other in sorted(borrowed, key=lambda pair: pair[0].scene_id):
        notes.append(f"-- {s.scene_id} has no picture of its own and borrows "
                     f"{other.scene_id}'s until it does.")
    return "\n".join([
        *notes,
        "-- Produced by `bjt scenes --sql`. Idempotent: re-running sets the same values.",
        "",
        "begin;",
        "",
        "insert into public.scenes (id, label_ja, image_path)",
        f"values {values}",
        "on conflict (id) do update set",
        "       label_ja   = excluded.label_ja,",
        "       image_path = excluded.image_path;",
        "",
        "commit;",
        "",
    ])
