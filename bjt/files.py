"""Writing a file so that it is either the old one or the new one, never half.

A bundle, its SQL, a clip or a picture is read by something that trusts it:
the next night counts a bundle's cells as spent, the deploy applies the SQL,
the survey counts a picture on disk as artwork and the upload sends it. A
process stopped part-way through a plain `write_text` — the job's clock, a
full disk, Ctrl-C — leaves a truncated file that every one of those readers
takes for the real thing. So the bytes go to a temporary file beside the
target and are moved over it in one step (`os.replace`, atomic on the same
filesystem); a write that fails leaves the old file exactly as it was.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def write_atomic(path: Path, data: "bytes | str", *, encoding: str = "utf-8") -> Path:
    """Write `data` to `path` whole, or leave `path` as it was."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = data.encode(encoding) if isinstance(data, str) else data
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(body)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return path
