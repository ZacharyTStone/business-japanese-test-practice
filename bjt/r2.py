"""The media bucket: Cloudflare R2, over its S3 API, signed by hand.

The app serves every clip and picture from one private R2 bucket through its
Worker (client/worker/media.ts), at the key `<folder>/<path>` — `audio/…` for
the clips, `scenes/…` for the pictures — where `<path>` is exactly what the
database holds (`audio_clips.audio_path`, `scenes.image_path`). This module is
how the pipeline puts them there.

Three operations, which is all the pipeline needs: put an object (optionally
only if nothing is there yet — R2 honours `If-None-Match: *` and answers 412
when the key is taken), and list the keys under a prefix. Each is one request
through `bjt/http.py`, signed with AWS Signature Version 4, which R2 speaks
with the region `auto`. No SDK: the signing is forty lines of the standard
library, and the S3 SDK would be the largest dependency in the project for
three calls.

The credentials are an R2 API token's S3 pair, read from the environment when
the bucket is used, never stored in config:

    R2_ACCOUNT_ID         the Cloudflare account id (the endpoint's host)
    R2_ACCESS_KEY_ID      the token's access key id
    R2_SECRET_ACCESS_KEY  the token's secret
    R2_BUCKET             the bucket, `business-japanese-drill-media` by default

A token scoped to that one bucket, with object read and write, is all it
needs; it must never reach the client or a commit.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import os
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Optional

from . import http

DEFAULT_BUCKET = "business-japanese-drill-media"
REGION = "auto"
SERVICE = "s3"
_S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
_EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()

def _now() -> dt.datetime:
    """The signing clock; the tests' seam."""
    return dt.datetime.now(dt.timezone.utc)


@dataclass(frozen=True)
class Credentials:
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket: str = DEFAULT_BUCKET

    @property
    def host(self) -> str:
        return f"{self.account_id}.r2.cloudflarestorage.com"

    @classmethod
    def from_env(cls) -> Optional["Credentials"]:
        """The environment's pair, or None when any part of it is missing."""
        account = os.environ.get("R2_ACCOUNT_ID", "").strip()
        key_id = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
        secret = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
        bucket = os.environ.get("R2_BUCKET", "").strip() or DEFAULT_BUCKET
        if not (account and key_id and secret):
            return None
        return cls(account, key_id, secret, bucket)


NOT_CONFIGURED = "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are not set"


# ----- Signature Version 4 ----------------------------------------------------


def _quote(text: str, safe: str = "-_.~") -> str:
    return urllib.parse.quote(text, safe=safe)


def canonical_uri(path: str) -> str:
    """Each segment percent-encoded once, the slashes kept (S3 does not
    double-encode)."""
    return "/".join(_quote(seg) for seg in path.split("/"))


def canonical_query(query: dict[str, str]) -> str:
    return "&".join(f"{_quote(k)}={_quote(v)}" for k, v in sorted(query.items()))


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def sign(method: str, host: str, path: str, query: dict[str, str], headers: dict[str, str],
         payload_sha256: str, access_key_id: str, secret: str, *,
         when: dt.datetime, region: str = REGION, service: str = SERVICE) -> dict[str, str]:
    """The headers to send: `headers` plus host, the date, the payload hash and
    the Authorization that signs every one of them."""
    amz_date = when.strftime("%Y%m%dT%H%M%SZ")
    day = when.strftime("%Y%m%d")
    out = {**headers, "host": host, "x-amz-date": amz_date, "x-amz-content-sha256": payload_sha256}
    lower = {k.lower(): " ".join(str(v).split()) for k, v in out.items()}
    signed = ";".join(sorted(lower))
    canonical = "\n".join([
        method,
        canonical_uri(path),
        canonical_query(query),
        "".join(f"{k}:{lower[k]}\n" for k in sorted(lower)),
        signed,
        payload_sha256,
    ])
    scope = f"{day}/{region}/{service}/aws4_request"
    to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        scope,
        hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    ])
    key = _hmac(_hmac(_hmac(_hmac(f"AWS4{secret}".encode("utf-8"), day), region), service), "aws4_request")
    signature = hmac.new(key, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    out["Authorization"] = (f"AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, "
                            f"SignedHeaders={signed}, Signature={signature}")
    return out


# ----- the three calls -----------------------------------------------------------


class AlreadyExists(RuntimeError):
    """The bucket already holds an object at that key, and it was not replaced."""


def _request(creds: Credentials, method: str, key: str, *, query: Optional[dict[str, str]] = None,
             body: bytes = b"", headers: Optional[dict[str, str]] = None, retries: int = 0) -> bytes:
    path = f"/{creds.bucket}" + (f"/{key}" if key else "")
    query = query or {}
    signed = sign(method, creds.host, path, query, headers or {},
                  hashlib.sha256(body).hexdigest() if body else _EMPTY_SHA256,
                  creds.access_key_id, creds.secret_access_key, when=_now())
    url = f"https://{creds.host}{canonical_uri(path)}"
    if query:
        url += "?" + canonical_query(query)
    signed.pop("host")  # urllib sets it, from the same URL
    return http.request(method, url, body if method == "PUT" else None, signed, retries=retries)


def put(creds: Credentials, key: str, data: bytes, content_type: str, *, overwrite: bool = True) -> None:
    """Put one object. Without `overwrite`, an object already at `key` is left
    alone and `AlreadyExists` says so."""
    headers = {"content-type": content_type}
    if not overwrite:
        headers["if-none-match"] = "*"
    try:
        _request(creds, "PUT", key, body=data, headers=headers)
    except http.RequestFailed as exc:
        if not overwrite and exc.status == 412:
            raise AlreadyExists(f"{key} is already in the bucket") from exc
        raise


def list_keys(creds: Credentials, prefix: str, *, delimiter: Optional[str] = None) -> list[str]:
    """Every key under `prefix`, a page at a time. With a delimiter, only the
    keys directly under it (no "folders")."""
    keys: list[str] = []
    token: Optional[str] = None
    while True:
        query = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if delimiter:
            query["delimiter"] = delimiter
        if token:
            query["continuation-token"] = token
        # A listing is safe to ask for twice.
        root = ET.fromstring(_request(creds, "GET", "", query=query, retries=2))
        keys += [el.text or "" for el in root.iter(f"{_S3_NS}Key")]
        truncated = (root.findtext(f"{_S3_NS}IsTruncated") or "false").lower() == "true"
        token = root.findtext(f"{_S3_NS}NextContinuationToken")
        if not truncated or not token:
            return keys
