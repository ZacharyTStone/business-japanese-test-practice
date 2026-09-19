"""The offline synthesis job: a checked bundle's manifest → audio files → SQL.

Four properties, each of which is the reason for a decision below.

**It only ever runs over a bundle that already passed.** A clip is expensive and
permanent; an item that has not cleared its gates has no business having a voice
recorded for it.

**It is resumable and idempotent.** Clip ids are content hashes of (voice,
channel, text), so a clip that already exists on disk is skipped. Re-running a
batch after fixing one item re-synthesises that item and nothing else, and
「かしこまりました。」 is paid for once across the whole library.

**Nothing uploads itself.** The job writes files and SQL. Applying the SQL is a
separate, deliberate act, exactly as publishing content is — which is also why no
key that can write media ever has to exist on a build machine.

**Silence is a first-class outcome.** 総合読解 has no audio by design, and the
job says so rather than reporting zero clips as though something went wrong.

**The database is the record of what is live.** On a laptop the `media/`
directory says which clips exist; on a fresh runner it is empty every time, and
the only record of what has already been synthesised and pointed at is
`audio_clips.audio_path` itself. `have` is that list, read out of the database
by the deploy workflow, and a clip on it is neither made, uploaded nor updated
again — which is what keeps every voice in the library the recording the
learner first heard.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .. import config, publish, scene_art
from . import channel as channel_mod
from .providers import Provider, direction_for, get_provider


@dataclass
class ClipResult:
    clip_id: str
    path: str
    duration_ms: int
    reused: bool = False


@dataclass
class SynthReport:
    bundle: str
    written: list[ClipResult] = field(default_factory=list)
    reused: list[ClipResult] = field(default_factory=list)
    #: Clip ids the caller said are already live (see `have`). Nothing to make,
    #: upload or update for these; counted so the summary adds up.
    live: list[str] = field(default_factory=list)
    #: Clip ids that were re-synthesised over a recording that was already
    #: live, because the caller named them (see `remake`). Counted separately
    #: from `written` — which also holds them — so a run that replaces part of
    #: the library says so instead of reading like a run that extended it.
    remade: list[str] = field(default_factory=list)
    failed: list[tuple[str, str]] = field(default_factory=list)
    provider: str = "silent"

    @property
    def clips(self) -> list[ClipResult]:
        """Every clip this run has a file for: the SQL and the upload cover these."""
        return [*self.reused, *self.written]

    def summary(self) -> str:
        if not self.clips and not self.failed and not self.live:
            return f"{self.bundle}: no audio — this item type is read, not heard"
        parts = [f"{len(self.written)} synthesised", f"{len(self.reused)} reused"]
        if self.remade:
            parts.append(f"{len(self.remade)} RE-MADE over a live clip")
        if self.live:
            parts.append(f"{len(self.live)} already live")
        if self.failed:
            parts.append(f"{len(self.failed)} FAILED")
        return f"{self.bundle} ({self.provider}): " + ", ".join(parts)

    def drop(self, clip_ids: set[str]) -> None:
        """Forget clips that did not reach the bucket, so the SQL never points
        the database at a file that is not there."""
        self.written = [c for c in self.written if c.clip_id not in clip_ids]
        self.reused = [c for c in self.reused if c.clip_id not in clip_ids]


def storage_path(clip_id: str, provider_name: str) -> str:
    """Where a clip lives, inside the `audio` bucket.

    Sharded by the first two characters of the id, because a flat directory of
    several thousand files is unpleasant to look at in any storage browser. The
    provider name is in the path so a clip's origin is visible without a
    database lookup — and so a silent placeholder can never be mistaken for a
    real recording.
    """
    return f"{provider_name}/{clip_id[:2]}/{clip_id}.wav"


def synthesise_bundle(
    bundle: dict,
    *,
    provider: Provider | str = "silent",
    out_dir: Path | None = None,
    force: bool = False,
    limit: int | None = None,
    have: set[str] | None = None,
    remake: set[str] | None = None,
) -> SynthReport:
    """Synthesise every clip a bundle's manifest asks for that does not exist.

    `limit` caps how many NEW clips one run may make. A budget rather than a
    debugging convenience: the first time this points at a paid provider it
    should not be able to spend the afternoon's money in one command.

    `have` is the set of clip ids that are already live — synthesised, uploaded
    and pointed at by the database. They are skipped before anything else is
    looked at, so a run on a machine with an empty `media/` still makes only
    what the library lacks.

    `remake` is the one exception to that, and it is deliberately a list of
    named clips rather than a flag. A live clip is not re-made, because a
    learner who hears one item in a different voice from the next is doing
    speaker identification instead of listening to Japanese — but that reason
    cuts both ways. When a handful of clips were made with the wrong delivery,
    leaving them is what makes the library sound like two libraries; replacing
    exactly those is what makes it one again. So the ids are written down,
    reviewed and passed in, a re-make is reported as a re-make, and nothing is
    replaced that was not named.
    """
    if isinstance(provider, str):
        provider = get_provider(provider)
    out_dir = Path(out_dir or config.MEDIA_DIR) / "audio"

    report = SynthReport(bundle=bundle.get("item_type", "bundle"), provider=provider.name)
    manifest = bundle.get("audio_manifest", [])

    made = 0
    for clip in manifest:
        # Named for replacement: neither the database's list of live clips nor
        # a copy sitting on this machine stands in the way.
        named = bool(remake) and clip["clip_id"] in remake
        if have and clip["clip_id"] in have and not named:
            report.live.append(clip["clip_id"])
            continue
        rel = storage_path(clip["clip_id"], provider.name)
        dest = out_dir / rel

        if dest.exists() and not force and not named:
            report.reused.append(
                ClipResult(clip["clip_id"], rel, _duration_of(dest), reused=True)
            )
            continue

        if limit is not None and made >= limit:
            break

        try:
            raw = provider.synthesize(
                clip["text"],
                clip["voice"],
                instructions=direction_for(clip["voice"]),
            )
            processed = channel_mod.apply_channel(raw, clip["channel"])
        except Exception as exc:  # noqa: BLE001 - one bad clip must not stop the run
            # A whole batch failing because one clip did would mean paying for
            # the successful ones again on the retry.
            report.failed.append((clip["clip_id"], str(exc)))
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(processed)
        made += 1
        if named and have and clip["clip_id"] in have:
            report.remade.append(clip["clip_id"])
        report.written.append(
            ClipResult(clip["clip_id"], rel, channel_mod.duration_ms(processed))
        )

    return report


def _duration_of(path: Path) -> int:
    try:
        return channel_mod.duration_ms(path.read_bytes())
    except Exception:  # noqa: BLE001 - a corrupt file should not stop a report
        return 0


def read_have(path: Path) -> set[str]:
    """The clip ids already live, one per line. Blank lines and `#` comments
    are ignored, so the file can be the raw output of a psql query."""
    ids = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            ids.add(line)
    return ids


def upload_clips(report: SynthReport, bucket: scene_art.Bucket,
                 media_dir: Path | None = None) -> scene_art.UploadResult:
    """Put every clip this run has a file for into the `audio` bucket.

    Idempotent — the bucket upserts, and a clip's path is its content hash — and
    one failure does not stop the rest, for the reason the scene uploader gives:
    paying for the successful ones again on a retry. The caller drops the failed
    ids from the report so the SQL describes the bucket, not this machine.
    """
    root = Path(media_dir or config.MEDIA_DIR) / "audio"
    result = scene_art.UploadResult()
    for clip in report.clips:
        local = root / clip.path
        if not local.is_file():
            result.failed.append((clip.path, "file missing on this machine"))
            continue
        size = local.stat().st_size
        if size > config.AUDIO_MAX_BYTES:
            result.failed.append((
                clip.path,
                f"{size:,} bytes is over the bucket's {config.AUDIO_MAX_BYTES:,} byte limit",
            ))
            continue
        try:
            bucket.upload(clip.path, local.read_bytes(), "audio/wav")
        except RuntimeError as exc:
            result.failed.append((clip.path, str(exc)))
            continue
        result.sent.append(clip.path)
    return result


def to_sql(report: SynthReport) -> str:
    """The SQL that tells the database where the audio went.

    An update rather than an upsert: the clip rows were created by `bjt publish`
    from the same manifest, so a row that is missing here means the bundle was
    never published, and inventing one would paper over that.
    """
    if not report.clips:
        if report.live:
            return (
                f"-- Every clip of {report.bundle} is already live "
                f"({len(report.live)} clip(s)).\n-- Nothing to apply.\n"
            )
        return (
            "-- No audio for this bundle: its item type is read, not heard.\n"
            "-- Nothing to apply.\n"
        )

    lines = [
        f"-- Audio paths for {report.bundle}, synthesised by {report.provider}.",
        f"-- {len(report.written)} synthesised, {len(report.reused)} reused, "
        f"{len(report.live)} already live and left alone.",
        *([f"-- {len(report.remade)} of them replace a clip that was already live, "
           f"by name: the file in the bucket and the duration below are the new "
           f"recording."] if report.remade else []),
        "-- Produced by `bjt synth`. Idempotent: re-running sets the same values.",
        "",
        "begin;",
        "",
    ]
    values = ",\n       ".join(
        f"({publish.lit(c.clip_id)}, {publish.lit(c.path)}, {c.duration_ms})"
        for c in sorted(report.clips, key=lambda c: c.clip_id)
    )
    lines += [
        "update public.audio_clips c set",
        "       audio_path  = v.audio_path,",
        "       duration_ms = v.duration_ms",
        "  from (values",
        f"       {values}",
        "       ) as v (id, audio_path, duration_ms)",
        " where c.id = v.id;",
        "",
        "commit;",
        "",
    ]
    return "\n".join(lines)


def write_report(report: SynthReport, path: Path) -> Path:
    """A machine-readable record of what this run did.

    Kept next to the audio rather than in the database: it is an operations
    record — which provider, which clips, how long each came out — and the thing
    to read when a clip sounds wrong six months from now.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "bundle": report.bundle,
                "provider": report.provider,
                "written": [c.__dict__ for c in report.written],
                "reused": [c.__dict__ for c in report.reused],
                "live": list(report.live),
                "failed": [{"clip_id": cid, "error": err} for cid, err in report.failed],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return path
