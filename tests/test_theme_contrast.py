"""The app's colour tokens, held to a contrast ratio a person can read.

The hero on 今日 and on the result screen puts three lines on a violet fill: the
countdown, the headline, and the streak. Two of those are 13px, and they were
`#DBD5FF` on `#6C5CE7` — 3.46:1, well under the 4.5:1 that small text needs, and
reported from a phone as simply unreadable. Nothing caught it, because the colour
that was wrong looked deliberate: it is called `onAccentMuted`, and muted is what
it was for.

So the arithmetic is a check rather than a note in a review. It reads the tokens
out of `client/src/ui/theme.ts` — the same file the app imports, so a value that
drifts drifts here too — and asserts the pairings the app actually draws.

What this cannot see is *which* fill a screen chooses: that rule ("an accent fill
that carries text is `accentDeep` or darker") is stated at the top of theme.ts
and kept by a reader. What it can see is that the fills declared for text, and
the text colours declared for them, are legible together — which is the half that
was wrong.

One pairing is deliberately not asserted here: `badge`, whose five tints are
2.6:1 to 4.2:1 against their own backgrounds. They are fine as `IconBadge`, where
the tint is a 3:1 graphic, and short of 4.5:1 as `Tag`, where it is 13px text.
Fixing that is a decision about the palette rather than a bug in it, so it is
written down rather than silently held to a bar it does not meet.
"""
import pathlib
import re

import pytest

THEME = (pathlib.Path(__file__).resolve().parents[1]
         / "client" / "src" / "ui" / "theme.ts")

#: WCAG 2.1 AA. 4.5:1 for body text; 3:1 for text at 24px, or 18.66px bold, and
#: for a graphic that carries meaning. Everything measured here is small text.
AA_SMALL_TEXT = 4.5


def _tokens() -> dict[str, str]:
    """The `colors` object, as a name → #RRGGBB map."""
    source = THEME.read_text(encoding="utf-8")
    body = re.search(r"export const colors = \{(.*?)\n\} as const;", source, re.S)
    assert body, "theme.ts no longer exports a `colors` object shaped as expected"
    return {m[1]: m[2].upper() for m in re.finditer(
        r"^\s{2}(\w+):\s*\"(#[0-9A-Fa-f]{6})\"", body.group(1), re.M)}


def _relative_luminance(hex_colour: str) -> float:
    channels = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
              for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(foreground: str, background: str) -> float:
    """WCAG 2.1 contrast ratio, 1:1 to 21:1."""
    a, b = _relative_luminance(foreground), _relative_luminance(background)
    lighter, darker = max(a, b), min(a, b)
    return (lighter + 0.05) / (darker + 0.05)


def test_the_maths_is_the_maths():
    """Two ends of the scale, so a broken formula fails here and not in the UI."""
    assert contrast("#000000", "#FFFFFF") == pytest.approx(21.0)
    assert contrast("#777777", "#FFFFFF") == pytest.approx(4.48, abs=0.01)


# Every text colour the app puts on an accent fill, against both ends of the
# hero's gradient. `accentDeep` is the light end — the corner the countdown sits
# in — so it is the one that decides.
@pytest.mark.parametrize("text", ["onAccent", "onAccentMuted"])
@pytest.mark.parametrize("fill", ["accentDeep", "accentInk"])
def test_text_on_an_accent_fill_is_readable(text, fill):
    colours = _tokens()
    ratio = contrast(colours[text], colours[fill])
    assert ratio >= AA_SMALL_TEXT, (
        f"{text} ({colours[text]}) on {fill} ({colours[fill]}) is {ratio:.2f}:1, "
        f"under the {AA_SMALL_TEXT}:1 that 13px text needs"
    )


def test_the_hero_card_carries_its_own_fill():
    """The contrast above is only true if the violet is actually there.

    The hero draws a gradient over itself with an SVG paint server, and for a
    while that was the *only* thing painting it: `gradientCard` set no
    background at all. A browser that declines to paint the paint server — the
    frame before it rasterises, a composited layer it does not repaint — left
    `onAccent` white and `onAccentMuted` pale violet on the page's own
    near-white, which is a hero nobody can read. Reported from a phone and
    reproduced by deleting the `<svg>` from the built page (2026-09-20).

    So the fill is a property of the card, and the check is that it is one of
    the fills the test above approves rather than any violet at all.
    """
    source = (pathlib.Path(__file__).resolve().parents[1]
              / "client" / "src" / "ui" / "components.tsx").read_text(encoding="utf-8")
    card = re.search(r"gradientCard:\s*\{(.*?)\n  \},", source, re.S)
    assert card, "components.tsx no longer declares a `gradientCard` style"
    fill = re.search(r"backgroundColor:\s*colors\.(\w+)", card.group(1))
    assert fill, "the hero card has no background of its own — the gradient is not a fill"
    assert fill.group(1) in ("accentDeep", "accentInk"), (
        f"the hero card is filled with `{fill.group(1)}`; a fill that carries text is "
        f"accentDeep or darker (theme.ts)"
    )


def test_muted_is_quieter_than_loud_but_still_text():
    """Muted has a job: it is the second line, and it has to look like one.

    Lifting it to white would pass the check above and lose the hierarchy, which
    is the other way to get this wrong.
    """
    colours = _tokens()
    loud = contrast(colours["onAccent"], colours["accentDeep"])
    quiet = contrast(colours["onAccentMuted"], colours["accentDeep"])
    assert quiet < loud, "onAccentMuted is no quieter than onAccent"


def test_body_text_on_the_page_is_readable():
    """The other pairing the whole app rests on: prose on a card, and the small
    grey under it."""
    colours = _tokens()
    for text in ("text", "muted"):
        for surface in ("surface", "bg", "surfaceAlt"):
            ratio = contrast(colours[text], colours[surface])
            assert ratio >= AA_SMALL_TEXT, (
                f"{text} on {surface} is {ratio:.2f}:1"
            )


@pytest.mark.parametrize("ink,soft", [("correct", "correctSoft"),
                                      ("wrong", "wrongSoft")])
@pytest.mark.parametrize("fill", ["soft", "surface"])
def test_the_verdict_is_readable_where_it_is_written(ink, soft, fill):
    """`correct` and `wrong` are text, not only a border.

    「正解」 is drawn in `correct` on a `correctSoft` card, and the review marks
    each option in one of the two on the matching soft fill — so both have to
    clear the small-text bar on their own background, and on plain white where
    the history screen writes them.
    """
    colours = _tokens()
    background = colours[soft if fill == "soft" else "surface"]
    ratio = contrast(colours[ink], background)
    assert ratio >= AA_SMALL_TEXT, (
        f"{ink} ({colours[ink]}) on {background} is {ratio:.2f}:1"
    )


def test_the_verdict_colours_are_still_the_colours_they_mean():
    """Darker, not different. Green stays greenest in green, red reddest in red —
    a check against a fix that passes the arithmetic by muddying the hue.
    """
    colours = _tokens()
    def rgb(c):
        return [int(c[i:i + 2], 16) for i in (1, 3, 5)]
    r, g, b = rgb(colours["correct"])
    assert g > r and g > b, f"correct ({colours['correct']}) is not green"
    r, g, b = rgb(colours["wrong"])
    assert r > g and r > b, f"wrong ({colours['wrong']}) is not red"
