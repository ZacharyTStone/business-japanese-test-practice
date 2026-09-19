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

from . import config, publish, seedtable

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
    #: ships without a picture, which is allowed.
    path: str | None = None

    @property
    def has_art(self) -> bool:
        return self.path is not None


def storage_path(scene_id: str, suffix: str) -> str:
    return f"{scene_id}{suffix}"


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

    scenes = []
    for scene_id in sorted(used_by):
        path = None
        for ext in IMAGE_EXTENSIONS:
            candidate = media_dir / f"{scene_id}{ext}"
            if candidate.exists():
                path = storage_path(scene_id, ext)
                break
        if path is None:
            for ext in IMAGE_EXTENSIONS:
                if storage_path(scene_id, ext) in remote:
                    path = storage_path(scene_id, ext)
                    break
        scenes.append(
            Scene(
                scene_id=scene_id,
                label_ja=labels.get(scene_id, scene_id),
                used_by=tuple(sorted(used_by[scene_id])),
                cell_count=demand[scene_id],
                path=path,
            )
        )
    # Most-wanted first: this list is a commissioning order.
    return sorted(scenes, key=lambda s: (s.has_art, -s.cell_count, s.scene_id))


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


def prompt_for(scene: Scene) -> str:
    """The brief for one scene, as a contract rather than a wish."""
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


def image_prompt(scene: Scene) -> str:
    """The same brief, addressed to an image model rather than a person.

    The setting is stated first and positively, because that is what an image
    model draws; the prohibitions follow in the same words the reviewer uses,
    so a draft is judged by the rule it was given.
    """
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
    if not with_art:
        return (
            "-- No approved scene artwork found. Nothing to apply.\n"
            "-- Put files in media/scenes/<scene_id>.webp and re-run `bjt scenes`.\n"
        )

    values = ",\n       ".join(
        f"({publish.lit(s.scene_id)}, {publish.lit(s.label_ja)}, {publish.lit(s.path)})"
        for s in sorted(with_art, key=lambda s: s.scene_id)
    )
    return "\n".join([
        f"-- Artwork for {len(with_art)} scene(s).",
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
