"""The one HTTP helper Jev, the voices, the image model and the buckets share.

Faked at `http._open`, the single place a connection is made, so what is
tested is the helper itself: how a failure reads, and which requests are
tried again.
"""
import io
import json
import urllib.error

import pytest

from bjt import http, r2, scene_art

CREDS = r2.Credentials("acct", "k", "s")


@pytest.fixture
def wire(monkeypatch):
    """Answers each request with the next of `.replies`: bytes, or an
    exception to raise. `.sent` keeps the requests; `.slept` the waits."""
    class Wire:
        replies: list = []
        sent: list = []
        slept: list = []

    w = Wire()
    w.replies, w.sent, w.slept = [], [], []

    def open_(req, timeout):
        w.sent.append((req, timeout))
        reply = w.replies.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        return reply

    monkeypatch.setattr(http, "_open", open_)
    monkeypatch.setattr(http, "_sleep", w.slept.append)
    return w


def _status(code, body=b""):
    return urllib.error.HTTPError("https://x.example/p", code, "err", {}, io.BytesIO(body))


def test_a_status_keeps_its_code_and_what_the_body_said(wire):
    wire.replies = [_status(402, b'{"error": "insufficient_quota"}')]
    with pytest.raises(http.RequestFailed) as err:
        http.request("POST", "https://x.example/p", b"{}", {"A": "b"})
    assert err.value.status == 402
    assert "insufficient_quota" in err.value.detail
    assert str(err.value).startswith("POST https://x.example/p → HTTP 402:")


def test_no_response_at_all_has_no_status(wire):
    wire.replies = [urllib.error.URLError("egress blocked")]
    with pytest.raises(http.RequestFailed) as err:
        http.request("GET", "https://x.example/p")
    assert err.value.status is None and "egress blocked" in str(err.value)


def test_nothing_is_retried_unless_asked(wire):
    wire.replies = [_status(503)]
    with pytest.raises(http.RequestFailed):
        http.request("POST", "https://x.example/p", b"x")
    assert len(wire.sent) == 1 and wire.slept == []


def test_an_idempotent_request_is_tried_again_on_a_transient_failure(wire):
    wire.replies = [_status(503), urllib.error.URLError("reset"), b"ok"]
    assert http.request("POST", "https://x.example/list", b"{}", retries=2) == b"ok"
    assert len(wire.sent) == 3 and len(wire.slept) == 2


def test_a_failure_that_would_repeat_is_not_retried(wire):
    wire.replies = [_status(400, b"bad request")]
    with pytest.raises(http.RequestFailed):
        http.request("POST", "https://x.example/list", b"{}", retries=5)
    assert len(wire.sent) == 1


def test_the_timeout_is_the_callers(wire):
    wire.replies = [b"ok", b"ok"]
    http.request("GET", "https://x.example/p")
    http.request("GET", "https://x.example/p", timeout=12)
    assert [t for _, t in wire.sent] == [http.DEFAULT_TIMEOUT, 12]


def test_a_json_request_says_so_and_reads_the_reply(wire):
    wire.replies = [json.dumps({"ok": True}).encode()]
    assert http.json_request("POST", "https://x.example/p", {"a": 1}, {"X-Key": "k"}) == {"ok": True}
    req, _ = wire.sent[0]
    assert req.get_header("Content-type") == "application/json"
    assert req.get_header("X-key") == "k"
    assert json.loads(req.data) == {"a": 1}


def test_a_reply_that_is_not_json_names_the_url(wire):
    wire.replies = [b"<html>gateway</html>"]
    with pytest.raises(RuntimeError, match="x.example"):
        http.json_request("POST", "https://x.example/p", {})


def test_the_bucket_listing_survives_a_dropped_request(wire):
    listing = ('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
               "<IsTruncated>false</IsTruncated><Contents><Key>scenes/a.webp</Key></Contents>"
               "</ListBucketResult>").encode()
    wire.replies = [_status(502), listing]
    bucket = scene_art.Bucket(creds=CREDS)
    assert bucket.list() == {"a.webp"}


def test_an_upload_is_never_sent_twice(wire):
    """A retried upload that had in fact arrived would come back as "already
    there" — and be counted as live when it is tonight's file."""
    wire.replies = [_status(503)]
    bucket = scene_art.Bucket(creds=CREDS)
    with pytest.raises(http.RequestFailed):
        bucket.upload("a.webp", b"x", "image/webp")
    assert len(wire.sent) == 1
