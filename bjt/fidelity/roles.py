"""Distractor roles: the fixed enum of *why each wrong option is wrong*, per item
type, plus validation.

This is fidelity mechanism #1. Real BJT distractors each fail for a specific,
nameable reason that the official 解説 spell out; encoding that reason as a
required, enum-constrained field is what forces the generator to build traps the
way the exam does, and lets us reject sloppy items mechanically.

Enums are derived from the official 解説 for each item type. Listening types are
stubbed here and will be filled in the same way when we reach them.
"""
from __future__ import annotations

# The role attached to the single correct option.
CORRECT = "correct"

# Distractor role enums, one list per item type.
DISTRACTOR_ROLES: dict[str, list[str]] = {
    # 語彙・文法問題
    "goi_bunpou": [
        "opposite_valence",           # correct register, inverted meaning (せい where おかげ is needed)
        "wrong_grammatical_category",  # real word, cannot attach in this slot (使いはじめ)
        "nonexistent_form",           # morphologically plausible, not a real word (使いづくめ)
        "real_form_wrong_context",     # genuine expression, licensing conditions fail (〜てこそ before a negative)
        "set_phrase_misfit",          # a real greeting/idiom dropped into a grammatical slot (ごくろうさま)
    ],
    # 表現読解問題
    "hyougen": [
        "wrong_honorific_direction",       # 尊敬語/謙譲語 swapped relative to the speaker
        "register_too_casual",             # plain/casual form to a superior or client
        "register_insulting",              # grammatical but demeaning (お食事をあげましょうか)
        "correct_keigo_wrong_speech_act",  # correct honorific verb, wrong illocutionary act
    ],
    # 発言聴解問題 — the situation is narrated, the four options are spoken
    # utterances, and the test-taker picks the one that fits. The failure modes
    # below are the ones the official 解説 name for this section: they are almost
    # all about *direction* of respect and about 場面 fit, not about grammar.
    "hatsugen_choukai": [
        "wrong_honorific_direction",   # 尊敬語/謙譲語 pointed at the wrong party
        "wrong_uchi_soto",             # in-group treated as out-group or vice versa
        "register_too_casual",         # plain/casual form where the relation forbids it
        "over_polite_misfit",          # 二重敬語・過剰敬語 — polite enough to be wrong
        "wrong_speech_act",            # right keigo, wrong act (an offer where a request is needed)
        "set_phrase_wrong_situation",  # a real set phrase, wrong 場面 or wrong moment
        "phone_protocol_violation",    # breaks the fixed shape of a business phone call
        "content_mismatch",            # natural and polite, but does not do what the situation requires
    ],
    # 場面把握問題 — a narrated situation, and the question is about the
    # situation itself: where this is, who is talking, what happens next. The
    # traps are therefore about mis-locating the scene rather than about 敬語.
    "bamen_haaku": [
        "wrong_participant",           # a person who is present, but not the one asked about
        "adjacent_setting",            # a setting next door to the real one (受付 for 応接室)
        "right_scene_wrong_moment",    # the right situation, at the wrong stage of it
        "plausible_but_unmentioned",   # something that would make sense, but was not said
    ],
    # 総合聴解問題 — a meeting or presentation heard once, then questions about
    # it. Everything here is a memory trap: each distractor was true at some
    # point, or true of somebody else.
    "sougou_choukai": [
        "stated_by_wrong_speaker",     # said in the conversation, by a different person
        "superseded_by_later_turn",    # true earlier, revised before the end
        "unsupported_but_plausible",   # consistent with the world, never said
        "surface_keyword_match",       # reuses a salient word with the wrong referent
    ],
    # 状況把握問題 — read the notice, hear the request, choose the action. The
    # whole type is about combining two sources, so the traps are about using
    # only one of them.
    "joukyou_haaku": [
        "ignores_the_document",        # answers the request, contradicts what is posted
        "ignores_the_request",         # follows the document, not what was actually asked
        "wrong_action_owner",          # the right action, done by the wrong person
        "right_action_wrong_condition",  # an action that applies only under a condition not met
    ],
    # 資料聴読解問題 — a document on the page, a prompt in the ear, usually a
    # value to find. The classic failure is reading the document and ignoring
    # the change announced aloud.
    "shiryou_choudokkai": [
        "reads_wrong_row",             # a plausible neighbouring row, column or entry
        "ignores_the_spoken_change",   # the document's original value, after it was revised aloud
        "wrong_timeframe",             # confuses completed work with planned work
        "surface_keyword_match",       # reuses a salient word with the wrong referent
    ],
    # 総合聴読解問題 — a longer exchange plus its documents. Both of the
    # single-source traps apply, and one more: pairing the right document with
    # the wrong turn of the conversation.
    "sougou_choudokkai": [
        "combines_wrong_pair",         # the right document read against the wrong turn
        "stated_by_wrong_speaker",     # said in the exchange, by a different person
        "unsupported_but_plausible",   # consistent with the documents, stated in neither
        "wrong_action_owner",          # the right action, assigned to the wrong person
    ],
    # 総合読解問題
    "sougou_dokkai": [
        "unsupported_but_plausible",           # true of the world, not stated in the passage
        "stated_but_answers_different_question",  # true in the passage, irrelevant to the question
        "wrong_timeframe",                     # confuses completed work with planned work
        "surface_keyword_match",               # reuses a salient word with the wrong referent
    ],
}

# Human-readable descriptions, shown to the study user after they answer and
# fed to the generator so it builds each trap to spec.
ROLE_DESCRIPTIONS: dict[str, str] = {
    CORRECT: "the correct option",
    "opposite_valence": "correct register, but inverted meaning (e.g. せい where おかげ is needed)",
    "wrong_grammatical_category": "a real word that cannot grammatically attach in this slot",
    "nonexistent_form": "morphologically plausible but not an actual word",
    "real_form_wrong_context": "a genuine expression used where its licensing conditions fail",
    "set_phrase_misfit": "a real greeting or idiom dropped into a grammatical slot",
    "wrong_honorific_direction": "尊敬語 and 謙譲語 swapped relative to the speaker",
    "wrong_uchi_soto": "ウチ/ソト handled backwards — e.g. honorifics on one's own boss to a client",
    "over_polite_misfit": "二重敬語 or otherwise over-polite to the point of being wrong",
    "wrong_speech_act": "the keigo is right but the act is wrong (an offer where a request was needed)",
    "set_phrase_wrong_situation": "a genuine set phrase used in the wrong 場面 or at the wrong moment",
    "phone_protocol_violation": "breaks the fixed shape of a business phone call (naming oneself, relaying absence, transferring)",
    "content_mismatch": "natural and polite, but does not do what the situation requires",
    "register_too_casual": "plain or casual form addressed to a superior or client",
    "register_insulting": "grammatical but demeaning to the listener",
    "correct_keigo_wrong_speech_act": "correct honorific verb, but the wrong illocutionary act",
    "wrong_participant": "a person who is present in the situation, but not the one asked about",
    "adjacent_setting": "a setting next door to the real one (受付 for 応接室)",
    "right_scene_wrong_moment": "the right situation, but at the wrong stage of it",
    "plausible_but_unmentioned": "something that would make sense here, but was never said",
    "stated_by_wrong_speaker": "said in the conversation, but by a different person",
    "superseded_by_later_turn": "true earlier in the conversation, revised before it ended",
    "ignores_the_document": "answers the spoken request while contradicting what is posted",
    "ignores_the_request": "follows the document, but not what was actually asked",
    "wrong_action_owner": "the right action, carried out by the wrong person",
    "right_action_wrong_condition": "an action that applies only under a condition this situation does not meet",
    "reads_wrong_row": "a plausible neighbouring row, column or entry in the document",
    "ignores_the_spoken_change": "the document's original value, after it was revised aloud",
    "combines_wrong_pair": "the right document read against the wrong turn of the conversation",
    "unsupported_but_plausible": "true of the world, but not stated in the passage",
    "stated_but_answers_different_question": "true in the passage, but irrelevant to the question asked",
    "wrong_timeframe": "confuses completed work with planned work",
    "surface_keyword_match": "reuses a salient word from the passage with the wrong referent",
}


def role_enum(item_type: str) -> list[str]:
    """Every valid role for an item type: the distractor roles plus `correct`."""
    if item_type not in DISTRACTOR_ROLES:
        raise KeyError(f"unknown item type: {item_type!r}")
    return [CORRECT, *DISTRACTOR_ROLES[item_type]]


def validate_roles(item_type: str, options: list[dict]) -> list[str]:
    """Return a list of role errors (empty == valid).

    Enforces: exactly four options, exactly one `correct`, every other role drawn
    from this item type's enum, and no duplicate distractor roles.
    """
    errors: list[str] = []
    valid = set(DISTRACTOR_ROLES.get(item_type, []))
    if not valid:
        return [f"unknown item type: {item_type!r}"]

    if len(options) != 4:
        errors.append(f"expected 4 options, got {len(options)}")

    roles = [o.get("role") for o in options]
    n_correct = roles.count(CORRECT)
    if n_correct != 1:
        errors.append(f"expected exactly 1 correct option, got {n_correct}")

    distractor_roles = [r for r in roles if r != CORRECT]
    for r in distractor_roles:
        if r not in valid:
            errors.append(f"role {r!r} is not in the {item_type} enum")
    dupes = {r for r in distractor_roles if distractor_roles.count(r) > 1}
    if dupes:
        errors.append(f"duplicate distractor role(s): {sorted(dupes)}")

    return errors
