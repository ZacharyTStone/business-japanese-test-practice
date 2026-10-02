"""The Worker's Access settings are filled in, and filled in plausibly.

`client/worker/access.ts` refuses every query when either is empty, which is
the safe failure but still an app that is down for everybody: the merge that
shipped the token check with both left blank did exactly that. These are the
two values the Worker pins — the team whose keys must sign a token, and the
Access application it must be for — so their shape is checked here, offline,
before a deploy can carry a blank or a typo.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
WRANGLER = ROOT / "client/wrangler.jsonc"


def _var(name: str) -> str:
    text = WRANGLER.read_text(encoding="utf-8")
    found = re.findall(rf'^\s*"{name}"\s*:\s*"([^"]*)"', text, re.M)
    assert len(found) == 1, f"{name} should be set once in wrangler.jsonc vars, found {len(found)}"
    return found[0]


def test_the_access_team_domain_is_a_team_domain():
    assert re.fullmatch(r"[a-z0-9-]+\.cloudflareaccess\.com", _var("ACCESS_TEAM_DOMAIN")), (
        "ACCESS_TEAM_DOMAIN must be <team>.cloudflareaccess.com (Zero Trust → Settings)"
    )


def test_the_access_aud_is_an_aud_tag():
    assert re.fullmatch(r"[0-9a-f]{64}", _var("ACCESS_AUD")), (
        "ACCESS_AUD must be the Access application's 64-character AUD tag (the Worker's Access tab)"
    )
