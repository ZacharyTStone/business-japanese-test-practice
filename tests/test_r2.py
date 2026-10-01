"""The media bucket's S3 calls: signed the way AWS documents, and a live clip
never overwritten. Offline: `http.request` is faked, as everywhere."""
import datetime as dt
import hashlib

import pytest

from bjt import http, r2

WHEN = dt.datetime(2013, 5, 24, tzinfo=dt.timezone.utc)
KEY, SECRET = "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
HOST = "examplebucket.s3.amazonaws.com"
CREDS = r2.Credentials("acct", "key-id", "secret")


def _signature(headers: dict) -> str:
    return headers["Authorization"].rsplit("Signature=", 1)[1]


# The three worked examples of the Signature Version 4 documentation for S3:
# a hand-rolled signer that matches them signs the way R2 checks.

def test_signs_the_documented_get_object():
    h = r2.sign("GET", HOST, "/test.txt", {}, {"Range": "bytes=0-9"}, r2._EMPTY_SHA256,
                KEY, SECRET, when=WHEN, region="us-east-1")
    assert _signature(h) == "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    assert "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date" in h["Authorization"]


def test_signs_the_documented_listing():
    h = r2.sign("GET", HOST, "/", {"max-keys": "2", "prefix": "J"}, {}, r2._EMPTY_SHA256,
                KEY, SECRET, when=WHEN, region="us-east-1")
    assert _signature(h) == "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"


def test_signs_the_documented_put_object():
    body = b"Welcome to Amazon S3."
    h = r2.sign("PUT", HOST, "/test$file.text", {},
                {"Date": "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY"},
                hashlib.sha256(body).hexdigest(), KEY, SECRET, when=WHEN, region="us-east-1")
    assert _signature(h) == "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"


def test_credentials_need_all_three_parts(monkeypatch):
    monkeypatch.setenv("R2_ACCOUNT_ID", "acct")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key-id")
    monkeypatch.delenv("R2_SECRET_ACCESS_KEY", raising=False)
    assert r2.Credentials.from_env() is None
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("R2_BUCKET", "other")
    assert r2.Credentials.from_env() == r2.Credentials("acct", "key-id", "secret", "other")


def test_a_put_is_signed_and_names_the_object(monkeypatch):
    seen = {}

    def fake(method, url, body, headers, **kw):
        seen.update(method=method, url=url, body=body, headers=headers)
        return b""

    monkeypatch.setattr(http, "request", fake)
    r2.put(CREDS, "audio/openai/ab/ab12.wav", b"RIFF", "audio/wav")
    assert seen["method"] == "PUT"
    assert seen["url"] == "https://acct.r2.cloudflarestorage.com/business-japanese-drill-media/audio/openai/ab/ab12.wav"
    assert seen["body"] == b"RIFF"
    assert seen["headers"]["Authorization"].startswith("AWS4-HMAC-SHA256 Credential=key-id/")
    assert "/auto/s3/aws4_request" in seen["headers"]["Authorization"]
    assert seen["headers"]["x-amz-content-sha256"] == hashlib.sha256(b"RIFF").hexdigest()
    assert "if-none-match" not in seen["headers"]


def test_a_put_that_must_not_overwrite_says_so_and_hears_412_as_taken(monkeypatch):
    def taken(method, url, body, headers, **kw):
        assert headers["if-none-match"] == "*"
        raise http.RequestFailed("PUT → HTTP 412", status=412, detail="PreconditionFailed")

    monkeypatch.setattr(http, "request", taken)
    with pytest.raises(r2.AlreadyExists):
        r2.put(CREDS, "audio/x.wav", b"x", "audio/wav", overwrite=False)


def test_any_other_refusal_is_a_failure(monkeypatch):
    def refused(method, url, body, headers, **kw):
        raise http.RequestFailed("PUT → HTTP 403", status=403, detail="AccessDenied")

    monkeypatch.setattr(http, "request", refused)
    with pytest.raises(http.RequestFailed) as err:
        r2.put(CREDS, "audio/x.wav", b"x", "audio/wav", overwrite=False)
    assert not isinstance(err.value, r2.AlreadyExists)


def test_a_listing_is_read_page_by_page_and_may_be_retried(monkeypatch):
    ns = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"'
    pages = iter([
        f"<ListBucketResult {ns}><IsTruncated>true</IsTruncated><NextContinuationToken>t/1+</NextContinuationToken>"
        "<Contents><Key>audio/a.wav</Key></Contents></ListBucketResult>".encode(),
        f"<ListBucketResult {ns}><IsTruncated>false</IsTruncated>"
        "<Contents><Key>audio/b.wav</Key></Contents></ListBucketResult>".encode(),
    ])
    calls = []

    def fake(method, url, body, headers, **kw):
        calls.append((method, url, kw.get("retries")))
        return next(pages)

    monkeypatch.setattr(http, "request", fake)
    assert r2.list_keys(CREDS, "audio/") == ["audio/a.wav", "audio/b.wav"]
    assert [c[0] for c in calls] == ["GET", "GET"]
    assert all(c[2] == 2 for c in calls)
    assert "continuation-token=t%2F1%2B" in calls[1][1]
