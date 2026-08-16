import copy
import pathlib

import pytest

from bjt import fixtures
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
