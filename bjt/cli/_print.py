"""Printing an item to a terminal: the question, then the answer and its traps."""
from __future__ import annotations

import textwrap

from .. import schemas
from ..fidelity import roles

LETTERS = ["A", "B", "C", "D"]


def print_question(item: dict) -> None:
    print()
    print(f"  [{item.get('item_type','')} · {item.get('level','')}]  {item.get('topic','')}")
    if item.get("speaker_role"):
        chan = {"phone": "電話", "video": "オンライン", "in_person": "対面"}.get(
            item.get("channel", ""), item.get("channel", "")
        )
        print(f"  {item['speaker_role']} → {item.get('listener_role','')}"
              f"（{chan} / {item.get('scene_id','')}）")
    print()
    for line in textwrap.wrap(item["stem"], width=64):
        print(f"  {line}")
    print()
    for i, o in enumerate(item["options"]):
        print(f"    {LETTERS[i]}. {o['text']}")
    print()


def print_answer(item: dict) -> None:
    ci = schemas.correct_index(item["options"])
    print(f"  正解: {LETTERS[ci]}. {item['options'][ci]['text']}")
    print()
    for line in textwrap.wrap(item["explanation_ja"], width=60):
        print(f"  解説  {line}")
    print(f"  EN    {item['explanation_en']}")
    print()
    print("  なぜ各選択肢が罠なのか (distractor roles):")
    for i, o in enumerate(item["options"]):
        if o["role"] == roles.CORRECT:
            continue
        print(f"    {LETTERS[i]}. {o['role']} — {roles.ROLE_DESCRIPTIONS.get(o['role'], '')}")
        for line in textwrap.wrap(o.get("why", ""), width=56):
            print(f"        {line}")
    notes = item.get("vocab_notes") or []
    if notes:
        print("\n  語彙:")
        for n in notes:
            print(f"    {n['term']}（{n['reading']}） — {n['meaning']}")
    print()
