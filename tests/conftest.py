import copy
import pathlib

import pytest

from bjt import fixtures, seedtable
from bjt.db import Store


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


@pytest.fixture
def hyougen_cell():
    return seedtable.load("hyougen").cells("J2")[0]
