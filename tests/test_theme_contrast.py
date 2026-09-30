"""The app's colour tokens, held to a contrast ratio a person can read.

The hero on 今日 and on the result screen puts three lines on a violet fill: the
countdown, the headline, and the streak. Two of those are 13px, which needs
4.5:1. A colour too faint for that is easy to miss in review, because it looks
deliberate: it is called `onAccentMuted`, and muted is what it is for.

So the arithmetic is a check rather than a note in a review. It reads the tokens
out of `client/src/ui/theme.ts` — the same file the app imports, so a value that
drifts drifts here too — and asserts the pairings the app actually draws.

What this cannot see is *which* fill a screen chooses: that rule ("an accent fill
that carries text is `accentDeep` or darker") is stated at the top of theme.ts
and kept by a reader. What it can see is that the fills declared for text, and
the text colours declared for them, are legible together — including `badge`,
whose tint is 13px text in a `Tag` as well as an icon in an `IconBadge`, and so
is held to the text bar rather than the graphic one.
"""
import pathlib
import re

import pytest

THEME = (pathlib.Path(__file__).resolve().parents[1]
         / "client" / "src" / "ui" / "theme.ts")

#: WCAG 2.1 AA. 4.5:1 for body text; 3:1 for text at 24px, or 18.66px bold, and
#: for a graphic that carries meaning — a control's edge, a bar that runs out.
AA_SMALL_TEXT = 4.5
AA_GRAPHIC = 3.0


def _tokens() -> dict[str, str]:
    """The `colors` object, as a name → #RRGGBB map."""
    source = THEME.read_text(encoding="utf-8")
    body = re.search(r"export const colors = \{(.*?)\n\} as const;", source, re.S)
    assert body, "theme.ts no longer exports a `colors` object shaped as expected"
    return {m[1]: m[2].upper() for m in re.finditer(
        r"^\s{2}(\w+):\s*\"(#[0-9A-Fa-f]{6})\"", body.group(1), re.M)}


def _badges() -> dict[str, tuple[str, str]]:
    """The `badge` object, as tone → (fg, bg)."""
    source = THEME.read_text(encoding="utf-8")
    body = re.search(r"export const badge = \{(.*?)\n\} as const;", source, re.S)
    assert body, "theme.ts no longer exports a `badge` object shaped as expected"
    tones = {m[1]: (m[2].upper(), m[3].upper()) for m in re.finditer(
        r'^\s{2}(\w+):\s*\{\s*fg:\s*"(#[0-9A-Fa-f]{6})",\s*bg:\s*"(#[0-9A-Fa-f]{6})"\s*\}',
        body.group(1), re.M)}
    assert len(tones) == 5, f"expected five badge tones, found {sorted(tones)}"
    return tones


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

    The hero draws a gradient over itself with an SVG paint server. A browser
    that declines to paint the paint server — the frame before it rasterises, a
    composited layer it does not repaint — would leave `onAccent` white and
    `onAccentMuted` pale violet on the page's own near-white, which is a hero
    nobody can read.

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


#: The conditions that describe a lasting state rather than a finger on the
#: screen. `pressed` and `hovered` are not here on purpose: they last as long
#: as the touch does, and a momentary dip is what direct manipulation looks
#: like everywhere.
STATE_TESTS = ("disabled &&", "disabled ?", "dim &&", "dim ?")


def test_a_state_that_lasts_is_drawn_rather_than_dimmed():
    """A control that cannot be pressed, or an option no longer in play, is
    drawn as one: a flat fill, a grey label, no shadow.

    Fading it to a fraction gets three things wrong at once. It makes every
    colour underneath lie about its own contrast, so the ratios this file checks
    stop describing the screen. It makes two different states — off, and
    not-yet-loaded — look identical. And on a card whose fill is itself only
    half there it leaves text on nothing at all.
    """
    offences = []
    for path in sorted((pathlib.Path(__file__).resolve().parents[1] / "client").rglob("*.tsx")):
        if "node_modules" in path.parts:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "opacity" not in line:
                continue
            if any(flag in line for flag in STATE_TESTS):
                offences.append(f"{path.relative_to(path.parents[2])}:{n}: {line.strip()}")
    assert not offences, (
        "a lasting state is dimmed rather than drawn:\n  " + "\n  ".join(offences)
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


@pytest.mark.parametrize("fill", ["correctSoft", "wrongSoft", "accentSoft"])
def test_the_second_line_is_readable_on_the_soft_fills(fill):
    """`muted` is not only on white. The verdict card writes its second line on
    `correctSoft` / `wrongSoft`, the rudeness meter its advice on the same, and a
    `Tag` with no tone is `muted` on `accentSoft`."""
    colours = _tokens()
    ratio = contrast(colours["muted"], colours[fill])
    assert ratio >= AA_SMALL_TEXT, f"muted on {fill} is {ratio:.2f}:1"


@pytest.mark.parametrize("tone", ["violet", "teal", "pink", "amber", "blue"])
def test_a_tag_is_readable_in_its_own_tint(tone):
    """`Tag` writes 13px bold text in a badge's `fg` on its `bg`, so the pair is
    text, not only the 3:1 graphic an `IconBadge` would need."""
    fg, bg = _badges()[tone]
    ratio = contrast(fg, bg)
    assert ratio >= AA_SMALL_TEXT, f"badge {tone} ({fg} on {bg}) is {ratio:.2f}:1"


@pytest.mark.parametrize("surface", ["surface", "surfaceAlt", "bg"])
def test_a_field_has_an_edge(surface):
    """Something you type into has a visible boundary: 3:1 against whatever it
    sits on. `border`, the card hairline, is 1.2:1 and is not for this."""
    colours = _tokens()
    ratio = contrast(colours["inputBorder"], colours[surface])
    assert ratio >= AA_GRAPHIC, f"inputBorder on {surface} is {ratio:.2f}:1"


@pytest.mark.parametrize("fill", ["surface", "wrongSoft"])
def test_the_warning_amber_is_visible_where_it_is_drawn(fill):
    """`warn` is a shape: the reading clock's bar on white as it runs low, and
    the 場面ちがい meter on the red verdict card."""
    colours = _tokens()
    ratio = contrast(colours["warn"], colours[fill])
    assert ratio >= AA_GRAPHIC, f"warn on {fill} is {ratio:.2f}:1"


def test_the_one_danger_button_is_readable():
    """White on `wrong`: the button that erases the record, once asked for."""
    colours = _tokens()
    ratio = contrast(colours["onAccent"], colours["wrong"])
    assert ratio >= AA_SMALL_TEXT, f"onAccent on wrong is {ratio:.2f}:1"


def test_a_secondary_button_is_readable():
    """`accentDeep` on `accentSoft`: the label of every secondary button — back,
    try again, the second choice on a card. `accent` there was 4.2:1."""
    colours = _tokens()
    ratio = contrast(colours["accentDeep"], colours["accentSoft"])
    assert ratio >= AA_SMALL_TEXT, f"accentDeep on accentSoft is {ratio:.2f}:1"
