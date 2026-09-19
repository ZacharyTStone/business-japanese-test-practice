"""Drawing the scene bank: generate, review, upload.

`bjt/scenes.py` says what the bank needs. This module fills it. They are two
modules because they have two different kinds of trust: the survey is
arithmetic over committed tables, and this is a job that calls two vendors and
writes to a storage bucket.

The shape is the one the item pipeline already has. An image model drafts; a
judge model looks at each draft and checks it against the brief's rules, the
same rules `scenes.prompt_for` gives a human illustrator; only a draft the judge
passes is written under the scene's name. Drafts that fail are kept as well,
under `rejected/`, each with the reason, because a gate that throws away its
evidence cannot be checked afterwards.

The owner asked for this to run with nobody in the loop (2026-09-17). The judge
is what stands where the person stood. The rules it applies are not softer for
being applied by a model: readable text, a logo, a likeness, or a picture that
gives the scenario away each fail the draft outright, and a scene that fails
every attempt ships without a picture, which the app allows.

Nothing here runs at practice time. It runs on a laptop or in the nightly job,
over a bank whose contents are committed.
"""
from __future__ import annotations

import base64
import json
import os
import struct
import urllib.error
import urllib.request
import zlib
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Callable, Protocol

from . import config, scenes

# ----- image providers ------------------------------------------------------


class ImageProvider(Protocol):
    """What an image backend has to do."""

    name: str
    #: File extension of what `generate` returns, and its media type.
    suffix: str
    media_type: str
    #: False for a stand-in whose output must never be mistaken for artwork.
    real: bool

    def generate(self, prompt: str) -> bytes:
        """Brief → image bytes."""
        ...


def _flat_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """A valid PNG of one flat colour, with no image library.

    Enough for the placeholder provider: the file opens, has the bank's 3:2
    shape, and is visibly not an illustration.
    """
    def chunk(kind: bytes, body: bytes) -> bytes:
        return (struct.pack(">I", len(body)) + kind + body
                + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

    row = b"\x00" + bytes(rgb) * width
    raw = row * height
    return b"".join([
        b"\x89PNG\r\n\x1a\n",
        chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
        chunk(b"IDAT", zlib.compress(raw, 9)),
        chunk(b"IEND", b""),
    ])


class PlaceholderProvider:
    """A flat grey rectangle of the right shape.

    The same role `silent` plays for audio: it exercises the whole job —
    drafting, review, the file layout, the SQL, the upload — with no vendor
    account and no network. Its output is written under `placeholder/` so the
    survey never counts it as artwork and nothing ever uploads it.
    """

    name = "placeholder"
    suffix = ".png"
    media_type = "image/png"
    real = False

    def generate(self, prompt: str) -> bytes:
        return _flat_png(96, 64, (0xD8, 0xD8, 0xD8))


class OpenAIImageProvider:
    """OpenAI's image API, over plain HTTPS so no extra package is needed.

    Asked for WebP directly: these are flat illustrations downloaded on a
    phone, and a transcode step would need an image library this tool
    otherwise does without. 1536×1024 is the landscape 3:2 the brief asks for.
    """

    name = "openai"
    suffix = ".webp"
    media_type = "image/webp"
    real = True
    ENDPOINT = "https://api.openai.com/v1/images/generations"
    SIZE = "1536x1024"

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")

    def generate(self, prompt: str) -> bytes:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        body = {
            "model": config.IMAGE_MODEL,
            "prompt": prompt,
            "n": 1,
            "size": self.SIZE,
            "quality": config.IMAGE_QUALITY,
            "output_format": "webp",
            # Without this the API returns a lossless-grade file that can pass
            # the bucket's 2 MiB limit; see config.IMAGE_COMPRESSION.
            "output_compression": config.IMAGE_COMPRESSION,
        }
        data = _json_request(
            "POST", self.ENDPOINT, body,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        try:
            return base64.b64decode(data["data"][0]["b64_json"])
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"unexpected response from the image API: {exc}") from exc


PROVIDERS: dict[str, type] = {
    "placeholder": PlaceholderProvider,
    "openai": OpenAIImageProvider,
}


def get_provider(name: str) -> ImageProvider:
    if name not in PROVIDERS:
        raise KeyError(f"unknown image provider {name!r}; available: {sorted(PROVIDERS)}")
    return PROVIDERS[name]()


# ----- the review gate ------------------------------------------------------


@dataclass(frozen=True)
class Verdict:
    approved: bool
    #: Why not, one entry per rule broken. Empty when approved.
    reasons: tuple[str, ...] = ()


#: What the judge is asked, one flag per rule in the brief. The wording of the
#: rules lives in `scenes.prompt_for`; these are the names the verdict uses.
RULES: dict[str, str] = {
    "readable_text": "readable text, signage, a chart or a user interface is drawn in",
    "logo_or_brand": "a logo or brand mark is drawn in",
    "real_likeness": "a recognisable likeness of a real person",
    "gives_scenario_away": "the picture fixes the situation more tightly than the setting does",
    "anatomy": "malformed hands, extra limbs, or more people than the setting calls for",
    "no_focus": "a second principal figure — a listener or partner drawn as prominently "
                "as the speaker, or a crowd of equals — so it is not clear who is "
                "speaking to the viewer",
    "wrong_setting": "the picture does not show the setting the brief names",
}

#: The rules for a per-item picture. Fewer than the bank's: this picture is
#: allowed — required — to fix the situation, and to have as many people in it
#: as the moment needs. What it may not do is be unclear about it.
PICTURE_RULES: dict[str, str] = {
    "readable_text": "readable text, signage, a chart or a user interface is drawn in",
    "logo_or_brand": "a logo or brand mark is drawn in",
    "real_likeness": "a recognisable likeness of a real person",
    "anatomy": "malformed hands, extra limbs, or more people than the brief calls for",
    "not_the_brief": "the picture does not clearly show what the brief describes",
    "unclear": "what is happening is not readable at a glance — the action, or who is "
               "doing it to whom, could be taken more than one way",
}

Reviewer = Callable[[bytes, str, scenes.Scene], Verdict]


def review_with_model(image: bytes, media_type: str, scene: scenes.Scene) -> Verdict:
    """Show the draft to the judge model with the brief, and read its flags.

    A per-item picture then sits the item itself: the judge is shown the
    picture with the question and the four descriptions, a few times, and the
    draft is refused unless every trial picks the marked one. That is the
    picture's answerability gate — the text gate cannot see it — and it is
    strict on purpose: the owner asked for pictures that are clear and not
    generic (2026-09-19), and a picture two readers describe differently is
    neither.
    """
    from . import config, llm

    if scene.is_picture:
        flags = llm.review_scene_image(image, media_type, scenes.prompt_for(scene), PICTURE_RULES)
        broken = [PICTURE_RULES[rule] for rule in PICTURE_RULES if flags.get(rule)]
        if not broken and scene.options and scene.answer is not None:
            for _ in range(config.GATE_TRIALS):
                try:
                    res = llm.answer_from_image(image, media_type, scene.question, list(scene.options))
                    chosen = int(res.get("choice", -1))
                except (llm.LLMError, ValueError, TypeError):
                    chosen = -1
                if chosen != scene.answer:
                    picked = scene.options[chosen] if 0 <= chosen < len(scene.options) else "nothing"
                    broken.append(f"a reader shown the picture chose {chosen} ({picked}) "
                                  f"rather than the marked description {scene.answer}")
                    break
        return Verdict(approved=not broken, reasons=tuple(broken))

    flags = llm.review_scene_image(image, media_type, scenes.prompt_for(scene), RULES)
    broken = tuple(RULES[rule] for rule in RULES if flags.get(rule))
    return Verdict(approved=not broken, reasons=broken)


def approve_everything(image: bytes, media_type: str, scene: scenes.Scene) -> Verdict:
    """For the placeholder provider only: a grey rectangle has nothing to judge."""
    return Verdict(approved=True)


# ----- the job --------------------------------------------------------------


@dataclass
class Drawn:
    scene_id: str
    #: Storage path of the approved file, or None when every attempt failed.
    path: str | None
    attempts: int
    #: Reasons each rejected attempt was rejected, in order.
    rejected: list[tuple[str, ...]] = field(default_factory=list)
    error: str | None = None
    #: Refused drafts before tonight, from the bucket's ledger.
    prior: int = 0
    #: True when the scene was not drawn because its lifetime allowance of
    #: refused drafts is spent. Not an error: the summary names it and the
    #: scene ships on its stand-in, or (a per-item picture) its item waits.
    given_up: bool = False

    @property
    def ok(self) -> bool:
        return self.path is not None


@dataclass
class DrawResult:
    drawn: list[Drawn]
    provider: str

    @property
    def approved(self) -> list[Drawn]:
        return [d for d in self.drawn if d.ok]

    @property
    def failed(self) -> list[Drawn]:
        return [d for d in self.drawn if not d.ok]

    def summary(self) -> str:
        lines = [
            f"## Scene artwork ({self.provider})",
            "",
            f"{len(self.approved)} approved, {len(self.failed)} without a picture.",
        ]
        if self.provider == "placeholder":
            lines.append("")
            lines.append("**Placeholder provider: nothing here is artwork.** Files are "
                         "under `placeholder/` and are never uploaded.")
        lines.append("")
        lines.append("| scene | result | attempts (before tonight) | rejected because |")
        lines.append("|---|---|---:|---|")
        for d in self.drawn:
            if d.given_up:
                result = "given up: lifetime allowance of refused drafts spent"
            else:
                result = d.path if d.ok else (f"error: {d.error}" if d.error else "no draft passed")
            why = "; ".join(" / ".join(r) for r in d.rejected) or "—"
            lines.append(f"| {d.scene_id} | {result} | {d.attempts} ({d.prior}) | {why} |")
        return "\n".join(lines)


#: Told about each refused draft: (scene_id, lifetime attempt number, reasons).
#: The bucket's ledger is written through this.
OnReject = Callable[[str, int, tuple[str, ...]], None]


def draw(
    wanted: list[scenes.Scene],
    *,
    provider: ImageProvider,
    review: Reviewer,
    media_dir: Path | None = None,
    attempts: int | None = None,
    prior: dict[str, int] | None = None,
    lifetime: int | None = None,
    on_reject: OnReject | None = None,
) -> DrawResult:
    """Draft, review and write each wanted scene.

    Approved files land at `media/scenes/<scene_id><ext>`, which is exactly
    where `scenes.survey` looks, so a scene drawn here counts as having art
    from then on. Rejected drafts go to `media/scenes/rejected/` with a text
    file beside each saying which rule it broke. A provider that is not real
    writes under `placeholder/` instead and its drafts are not reviewed.

    `prior` is how many drafts of each scene were refused on earlier runs
    (the bucket's ledger); a scene at or over `lifetime` is not drawn again,
    and says so. `on_reject` is called for every refused draft with its
    lifetime number, which is how the ledger grows.
    """
    attempts = attempts or config.SCENE_ATTEMPTS
    lifetime = lifetime or config.SCENE_LIFETIME_ATTEMPTS
    prior = prior or {}
    root = Path(media_dir or config.MEDIA_DIR) / "scenes"
    out_dir = root if provider.real else root / "placeholder"
    rejected_dir = root / "rejected"
    out_dir.mkdir(parents=True, exist_ok=True)
    if not provider.real:
        review = approve_everything

    drawn: list[Drawn] = []
    for scene in wanted:
        before = prior.get(scene.scene_id, 0)
        record = Drawn(scene_id=scene.scene_id, path=None, attempts=0, prior=before)
        if provider.real and before >= lifetime:
            record.given_up = True
            drawn.append(record)
            continue
        prompt = scenes.image_prompt(scene)
        # Tonight's drafts stop at the per-run allowance or at the lifetime
        # one, whichever comes first.
        tonight = min(attempts, lifetime - before) if provider.real else attempts
        for n in range(1, tonight + 1):
            record.attempts = n
            try:
                image = provider.generate(prompt)
                verdict = review(image, provider.media_type, scene)
            except Exception as exc:  # a vendor error is a result, not a crash
                record.error = str(exc)
                break
            if verdict.approved:
                (out_dir / f"{scene.scene_id}{provider.suffix}").write_bytes(image)
                rel = scenes.storage_path(scene.scene_id, provider.suffix)
                record.path = rel if provider.real else f"placeholder/{rel}"
                break
            record.rejected.append(verdict.reasons)
            rejected_dir.mkdir(parents=True, exist_ok=True)
            stem = rejected_dir / f"{scene.scene_id}-{before + n}"
            stem.with_suffix(provider.suffix).write_bytes(image)
            stem.with_suffix(".txt").write_text(
                "\n".join(verdict.reasons) + "\n", encoding="utf-8")
            if on_reject is not None:
                try:
                    on_reject(scene.scene_id, before + n, verdict.reasons)
                except RuntimeError as exc:  # the ledger is a courtesy, not the job
                    record.error = f"could not record the refusal: {exc}"
        drawn.append(record)
    return DrawResult(drawn=drawn, provider=provider.name)


# ----- the bucket -----------------------------------------------------------


class Bucket:
    """The `scenes` storage bucket, over Supabase's storage REST API.

    Needs the project URL and the service-role key, because the bucket's write
    policy is "nobody but the service role" — a client that could write here
    could replace the picture of a question with anything at all. The key is
    read from the environment when the bucket is used, never stored in config,
    and it must never reach the client or a commit.
    """

    def __init__(self, name: str = "scenes", url: str | None = None, key: str | None = None):
        self.name = name
        self.url = (url or os.environ.get("SUPABASE_URL") or "").rstrip("/")
        self.key = key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""

    @property
    def configured(self) -> bool:
        return bool(self.url and self.key)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.key}", "apikey": self.key}

    def list(self, prefix: str = "") -> set[str]:
        """Names of the files at the bucket root — the artwork already shipped.

        With a prefix, the names under that folder (without the folder)."""
        if not self.configured:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set")
        rows = _json_request(
            "POST", f"{self.url}/storage/v1/object/list/{self.name}",
            {"prefix": prefix, "limit": 1000, "offset": 0,
             "sortBy": {"column": "name", "order": "asc"}},
            headers=self._headers(),
        )
        names = {row["name"] for row in rows if row.get("id") is not None}  # folders have no id
        if prefix:
            return names
        return {n for n in names if Path(n).suffix in scenes.IMAGE_EXTENSIONS}

    # The ledger of refused drafts: one small text file per refusal, under
    # `rejected/`, named `<scene_id>-<n>.txt`. The runner forgets everything
    # each night; this is how it knows a scene has been refused six times
    # already and is not worth a seventh dollar.
    LEDGER = "rejected/"

    def refusals(self) -> dict[str, int]:
        """scene_id → how many drafts have been refused, over all time."""
        counts: dict[str, int] = {}
        for name in self.list(self.LEDGER):
            stem = Path(name).stem
            scene_id, _, n = stem.rpartition("-")
            if scene_id and n.isdigit():
                counts[scene_id] = max(counts.get(scene_id, 0), int(n))
        return counts

    def record_refusal(self, scene_id: str, n: int, reasons: tuple[str, ...]) -> None:
        body = ("\n".join(reasons) + "\n").encode("utf-8")
        self.upload(f"{self.LEDGER}{scene_id}-{n}.txt", body, "text/plain; charset=utf-8")

    def upload(self, path: str, data: bytes, content_type: str) -> None:
        """Put one file at `path`, replacing whatever is there."""
        if not self.configured:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set")
        headers = {**self._headers(), "Content-Type": content_type, "x-upsert": "true"}
        _request("POST", f"{self.url}/storage/v1/object/{self.name}/{path}", data, headers)


_MEDIA_TYPES = {
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
}


@dataclass
class UploadResult:
    #: Storage paths now in the bucket because of this call.
    sent: list[str] = field(default_factory=list)
    #: (storage path, why) for every local file that did not get there.
    failed: list[tuple[str, str]] = field(default_factory=list)

    @property
    def failed_paths(self) -> set[str]:
        return {path for path, _ in self.failed}

    def summary(self) -> str:
        """Markdown for the run summary. Empty when nothing went wrong."""
        if not self.failed:
            return ""
        lines = [
            "### Not uploaded",
            "",
            f"{len(self.failed)} approved picture(s) did not reach the bucket and are "
            "not pointed at by the database. They are in this run's artifact; the "
            "next night draws them again.",
            "",
            "| file | why |",
            "|---|---|",
        ]
        lines.extend(f"| {path} | {why} |" for path, why in self.failed)
        return "\n".join(lines)


def upload_approved(survey: list[scenes.Scene], bucket: Bucket,
                    media_dir: Path | None = None) -> UploadResult:
    """Push every locally approved file to the bucket.

    One file failing must not stop the rest: the first real night lost ten
    approved pictures because the fourth was over the bucket's size limit and
    the exception ended the loop. A file the bucket would refuse is caught here
    before a byte is sent, and any other failure is recorded against its file
    and the loop goes on. The caller uses `failed_paths` to keep those files out
    of the SQL, so the database is never pointed at a picture that is not there.
    """
    root = Path(media_dir or config.MEDIA_DIR) / "scenes"
    result = UploadResult()
    for scene in survey:
        if not scene.path:
            continue
        local = root / scene.path
        if not local.is_file():
            continue  # known only from the bucket listing; nothing to send
        size = local.stat().st_size
        if size > config.SCENE_MAX_BYTES:
            result.failed.append((
                scene.path,
                f"{size:,} bytes is over the bucket's {config.SCENE_MAX_BYTES:,} byte limit",
            ))
            continue
        try:
            bucket.upload(scene.path, local.read_bytes(), _MEDIA_TYPES[local.suffix])
        except RuntimeError as exc:
            result.failed.append((scene.path, str(exc)))
            continue
        result.sent.append(scene.path)
    return result


def without(survey: list[scenes.Scene], paths: set[str]) -> list[scenes.Scene]:
    """The survey with those files forgotten, as if they had never been drawn.

    For the SQL after an upload with failures: a scene whose file is on this
    machine but not in the bucket must read as having no picture, or the app
    would be pointed at a URL that 404s.
    """
    if not paths:
        return survey
    return [replace(s, path=None) if s.path in paths else s for s in survey]


# ----- HTTP, kept small on purpose -----------------------------------------


def _request(method: str, url: str, body: bytes | None, headers: dict[str, str]) -> bytes:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"{method} {url} → HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {url} failed: {exc.reason}") from exc


def _json_request(method: str, url: str, body: dict, headers: dict[str, str]):
    raw = _request(method, url, json.dumps(body).encode("utf-8"),
                   {**headers, "Content-Type": "application/json"})
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{url} returned something that is not JSON") from exc
