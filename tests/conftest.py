import copy
import os

import pytest

from bjt import fixtures, http, llm, seedtable
from bjt.db import Store

#: Environment variables that hold a credential or point at a live service.
#: `bjt.config` loads `.env` at import, and a developer's shell or a CI job may
#: carry any of these; a test must never see them, so a model call nobody
#: faked cannot quietly find a key and spend it.
_LIVE_ENV_PREFIXES = ("ANTHROPIC_", "OPENAI_", "TYPESAFE_", "SUPABASE_", "GEMINI_", "GOOGLE_")
_LIVE_ENV_NAMES = ("BJT_SPEND_LEDGER",)


class UnmockedCall(AssertionError):
    """A test reached a network seam it did not replace.

    An AssertionError rather than an `LLMError` on purpose: the tolerant
    call sites (the proofreader, the probe) turn an `LLMError` into "did not
    run", so a test that forgot to fake a call would pass on that path and
    say nothing. This one goes straight through them and fails the test.
    """


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "unmocked_seams: the test replaces what sits behind a network seam (the SDK "
        "module itself) and needs the real seam function; every other test gets a "
        "seam that refuses")


@pytest.fixture(autouse=True)
def no_network(request, monkeypatch):
    """No test reaches a vendor: no credential in the environment, and every
    function that would open a connection replaced by one that fails loudly.
    A test that wants a reply fakes the seam itself, on top of this."""
    for name in list(os.environ):
        if name.startswith(_LIVE_ENV_PREFIXES) or name in _LIVE_ENV_NAMES:
            monkeypatch.delenv(name, raising=False)
    # A bill of its own for every test, and never a shared ledger file: the
    # process's `llm.spend` was made at import, before the environment above
    # was cleaned, and a test must not add to (or be stopped by) a real job's.
    monkeypatch.setattr(llm, "spend", llm.Spend())
    if request.node.get_closest_marker("unmocked_seams"):
        return

    def refuse(what):
        def seam(*args, **kwargs):
            raise UnmockedCall(f"{what} was called for real; fake it in the test")
        return seam

    # Two seams reach the network: the Anthropic SDK, and bjt/http.py's one
    # connection, which Jev, the voices, the image model and the buckets share.
    monkeypatch.setattr(llm, "_client", None)
    monkeypatch.setattr(llm, "_get_client", refuse("llm._get_client (the Anthropic API)"))
    monkeypatch.setattr(http, "_open", refuse("http._open (Jev, TTS, images, storage)"))


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "test.db")
    yield s
    s.close()


@pytest.fixture
def goi_item():
    return copy.deepcopy(fixtures.FIXTURES["goi_bunpou"])


@pytest.fixture
def hyougen_item():
    return copy.deepcopy(fixtures.FIXTURES["hyougen"])


@pytest.fixture
def seeds_dir(tmp_path, monkeypatch):
    """A temp seeds/ dir the test can populate; points bjt.config at it."""
    d = tmp_path / "seeds"
    (d / "vocab").mkdir(parents=True)
    monkeypatch.setattr("bjt.config.SEEDS_DIR", d)
    return d


@pytest.fixture
def goi_cell():
    """A real goi_bunpou seed cell. Every type whose variety comes from the
    table refuses to generate without one, so the tests hand it a genuine cell
    rather than a stub — a stub would let the assignment drift out of sync with
    the committed table without anything noticing."""
    return seedtable.load("goi_bunpou").cells("J2")[0]
