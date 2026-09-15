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
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .. import config, publish
from . import channel as channel_mod
from .providers import Provider, VOICE_DIRECTION, get_provider


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
    failed: list[tuple[str, str]] = field(default_factory=list)

    @property
    def clips(self) -> list[ClipResult]:
        return [*self.reused, *self.written]

    def summary(self) -> str:
        if not self.clips and not self.failed:
            return f"{self.bundle}: no audio — this item type is read, not heard"
        parts = [f"{len(self.written)} synthesised", f"{len(self.reused)} reused"]
        if self.failed:
            parts.append(f"{len(self.failed)} FAILED")
        return f"{self.bundle}: " + ", ".join(parts)


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
) -> SynthReport:
    """Synthesise every clip a bundle's manifest asks for that does not exist.

    `limit` caps how many NEW clips one run may make. A budget rather than a
    debugging convenience: the first time this points at a paid provider it
    should not be able to spend the afternoon's money in one command.
    """
    if isinstance(provider, str):
        provider = get_provider(provider)
    out_dir = Path(out_dir or config.MEDIA_DIR) / "audio"

    report = SynthReport(bundle=bundle.get("item_type", "bundle"))
    manifest = bundle.get("audio_manifest", [])

    made = 0
    for clip in manifest:
        rel = storage_path(clip["clip_id"], provider.name)
        dest = out_dir / rel

        if dest.exists() and not force:
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
                instructions=VOICE_DIRECTION.get(clip["voice"], ""),
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
        report.written.append(
            ClipResult(clip["clip_id"], rel, channel_mod.duration_ms(processed))
        )

    return report


def _duration_of(path: Path) -> int:
    try:
        return channel_mod.duration_ms(path.read_bytes())
    except Exception:  # noqa: BLE001 - a corrupt file should not stop a report
        return 0


def to_sql(report: SynthReport) -> str:
    """The SQL that tells the database where the audio went.

    An update rather than an upsert: the clip rows were created by `bjt publish`
    from the same manifest, so a row that is missing here means the bundle was
    never published, and inventing one would paper over that.
    """
    if not report.clips:
        return (
            "-- No audio for this bundle: its item type is read, not heard.\n"
            "-- Nothing to apply.\n"
        )

    lines = [
        f"-- Audio paths for {report.bundle}.",
        f"-- {len(report.written)} synthesised, {len(report.reused)} reused.",
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
                "written": [c.__dict__ for c in report.written],
                "reused": [c.__dict__ for c in report.reused],
                "failed": [{"clip_id": cid, "error": err} for cid, err in report.failed],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return path
