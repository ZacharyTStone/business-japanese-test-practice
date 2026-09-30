"""HTTPS for the vendors that have no SDK here, done one way.

Jev (bjt/jev.py), the voices (bjt/tts/providers.py), the image model and the
storage buckets (bjt/scene_art.py) are each a JSON request over the standard
library, and each used to carry its own copy of the same dozen lines with its
own timeout and its own wording of a failure. They share this one instead:
the timeout is said at the call, a failure is a `RequestFailed` that keeps the
status and the part of the body that says what went wrong (the caller decides
what that means — an empty account, a file already there), and a request that
is safe to send twice may say how many times to try.

Retrying is opt-in and meant for what is idempotent: reading a bucket's
listing, which an overloaded server can drop and the next attempt answers.
Never an upload, a generation or a paid call — a response lost after the
server acted would be the same money or the same file twice.

`_open` is the one place a connection is made, which is the seam the tests
refuse (tests/conftest.py) and the fakes stand in front of.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Optional

#: Seconds a request may take unless the caller says otherwise. A picture or a
#: clip takes a while to make; three minutes is well over it.
DEFAULT_TIMEOUT = 180.0

#: The statuses worth a second try: a timeout, a rate limit, a server that was
#: overloaded or briefly down. Anything else would fail the same way again.
RETRY_STATUSES = (408, 429, 500, 502, 503, 504)

_sleep = time.sleep


class RequestFailed(RuntimeError):
    """A request that did not succeed. `status` is the HTTP status, or None
    when there was no response at all; `detail` is the first few hundred
    characters of the body (or the network's reason), the part of a vendor's
    error that actually says what was wrong."""

    def __init__(self, message: str, *, status: Optional[int], detail: str):
        super().__init__(message)
        self.status = status
        self.detail = detail


def _open(req: urllib.request.Request, timeout: float) -> bytes:
    """Send one request and read the whole body."""
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def request(method: str, url: str, body: Optional[bytes] = None,
            headers: Optional[dict[str, str]] = None, *,
            timeout: float = DEFAULT_TIMEOUT, retries: int = 0) -> bytes:
    """One request; the response body. Raises `RequestFailed`.

    `retries` extra attempts on a transient failure (no response, or one of
    RETRY_STATUSES), with a short doubling wait — for idempotent requests only.
    """
    attempt = 0
    while True:
        req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
        try:
            return _open(req, timeout)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:500]
            failure = RequestFailed(f"{method} {url} → HTTP {exc.code}: {detail}",
                                    status=exc.code, detail=detail)
            transient = exc.code in RETRY_STATUSES
            cause: BaseException = exc
        except OSError as exc:  # URLError, a timeout, a reset connection
            reason = getattr(exc, "reason", None) or exc
            failure = RequestFailed(f"{method} {url} failed: {reason}",
                                    status=None, detail=str(reason))
            transient = True
            cause = exc
        if not transient or attempt >= retries:
            raise failure from cause
        _sleep(min(8.0, 0.5 * 2 ** attempt))
        attempt += 1


def json_request(method: str, url: str, body: Any, headers: Optional[dict[str, str]] = None, *,
                 timeout: float = DEFAULT_TIMEOUT, retries: int = 0) -> Any:
    """`request` with a JSON body and a JSON reply. A reply that is not JSON
    is a RuntimeError naming the URL."""
    raw = request(method, url, json.dumps(body).encode("utf-8"),
                  {**(headers or {}), "Content-Type": "application/json"},
                  timeout=timeout, retries=retries)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{url} returned something that is not JSON") from exc
