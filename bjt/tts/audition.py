"""The listening comparison: the same lines, every cast voice, every provider.

The choice of provider is a decision about how the whole library will sound
for as long as it exists, and it cannot be made from a spec sheet. What it
needs is a native speaker with headphones and five minutes: the same seven
lines from each configured provider, laid out side by side, judged on the
things that matter for this exam — a name, a date, a number, a business term
the dictionary covers, keigo said the way a person says it, and the phone
treatment on top of one of them.

Nothing here touches a bundle, the database or a bucket. It writes into
`media/audition/` and an `index.html` next to the files, which is the whole
deliverable: open it, listen, then pin the winner with `BJT_TTS_PROVIDER`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from html import escape
from pathlib import Path

from .. import config
from . import channel as channel_mod
from .plan import NARRATOR_VOICE
from .providers import OpenAIProvider, Provider, available, direction_for, get_provider

#: One line per cast voice. Original compositions, in the register the role
#: speaks in, each carrying something a TTS model can get wrong: a surname, a
#: time, a counted number, a dictionary reading (代替, 早急), a set phrase.
LINES: list[tuple[str, str, str]] = [
    (NARRATOR_VOICE, "in_person",
     "取引先の担当者から、上司の田中部長あてに電話がかかってきました。"
     "田中部長は外出していて、三時ごろ戻る予定です。こんなとき、何と言いますか。"),
    ("staff_junior_m", "in_person",
     "お世話になっております。山田商事の佐藤でございます。"
     "恐れ入りますが、営業部の田中様はいらっしゃいますでしょうか。"),
    ("staff_junior_f", "in_person",
     "お忙しいところ恐れ入ります。明日の会議の資料を、お目通しいただけますでしょうか。"),
    ("staff_mid_m", "in_person",
     "申し訳ございません。田中はただいま外出しておりまして、三時ごろ戻る予定でございます。"
     "戻りましたら、こちらからご連絡いたしましょうか。"),
    ("staff_mid_f", "in_person",
     "来週の十五日、午後二時からでしたら、会議室が空いております。ご都合はいかがでしょうか。"),
    ("manager_m", "in_person",
     "この件は早急に対応してください。代替案を三つ、明日の朝までにまとめてもらえますか。"),
    ("reception_f", "in_person",
     "いらっしゃいませ。恐れ入りますが、お名前とご用件をお伺いしてもよろしいでしょうか。"),
    # The same utterance again down a telephone line: the treatment is part of
    # what is being judged, because a phone item that sounds like a studio
    # recording is an easier question than the exam asks.
    ("staff_mid_m", "phone",
     "申し訳ございません。田中はただいま外出しておりまして、三時ごろ戻る予定でございます。"
     "戻りましたら、こちらからご連絡いたしましょうか。"),
]


@dataclass
class AuditionReport:
    root: Path
    providers: list[str] = field(default_factory=list)
    written: list[Path] = field(default_factory=list)
    failed: list[tuple[str, str, str]] = field(default_factory=list)  # provider, voice, why

    def summary(self) -> str:
        parts = [f"{len(self.written)} clip(s) written for {', '.join(self.providers) or 'nobody'}"]
        if self.failed:
            parts.append(f"{len(self.failed)} FAILED")
        return "; ".join(parts)


def file_name(voice: str, channel: str) -> str:
    return f"{voice}.wav" if channel == "in_person" else f"{voice}.{channel}.wav"


#: For `--voices`: one line said by every voice the chosen provider offers, so
#: a role can be recast by ear. A mid-career line rather than the narration,
#: because register is what the cast is about.
VOICES_LINE = LINES[3][2]


def run(providers: list[str] | None = None, *, media_dir: Path | None = None,
        force: bool = False, voices: bool = False) -> AuditionReport:
    """Synthesise every line through every named provider (default: all that
    have credentials) and write the comparison page. With `voices`, also every
    candidate voice of the library's provider saying one line."""
    names = providers if providers is not None else available()
    root = Path(media_dir or config.MEDIA_DIR) / "audition"
    report = AuditionReport(root=root, providers=list(names))

    if voices:
        provider = OpenAIProvider()
        for candidate in OpenAIProvider.CANDIDATE_VOICES:
            dest = root / "openai-voices" / f"{candidate}.wav"
            if dest.exists() and not force:
                report.written.append(dest)
                continue
            try:
                # Every candidate is asked for as staff_mid_m so the direction is
                # the same; only the voice id differs.
                raw = provider.synthesize(VOICES_LINE, "staff_mid_m",
                                          instructions=direction_for("staff_mid_m"),
                                          provider_voice=candidate)
            except Exception as exc:  # noqa: BLE001
                report.failed.append(("openai-voices", candidate, str(exc)))
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(channel_mod.apply_channel(raw, "in_person"))
            report.written.append(dest)

    for name in names:
        provider: Provider = get_provider(name)
        for voice, channel, text in LINES:
            dest = root / provider.name / file_name(voice, channel)
            if dest.exists() and not force:
                report.written.append(dest)
                continue
            try:
                raw = provider.synthesize(text, voice, instructions=direction_for(voice))
                processed = channel_mod.apply_channel(raw, channel)
            except Exception as exc:  # noqa: BLE001 - one provider's outage must not hide the others
                report.failed.append((provider.name, voice, str(exc)))
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(processed)
            report.written.append(dest)

    (root / "index.html").parent.mkdir(parents=True, exist_ok=True)
    (root / "index.html").write_text(page(report), encoding="utf-8")
    return report


def page(report: AuditionReport) -> str:
    """One table: a row per line, a column per provider. Static HTML, no script,
    so it opens from the file system."""
    cols = report.providers
    failed = {(p, v) for p, v, _ in report.failed}
    rows = []
    for voice, channel, text in LINES:
        cells = []
        for name in cols:
            rel = f"{name}/{file_name(voice, channel)}"
            if (name, voice) in failed and not (report.root / rel).exists():
                cells.append('<td class="x">failed</td>')
            else:
                cells.append(f'<td><audio controls preload="none" src="{escape(rel)}"></audio></td>')
        label = voice if channel == "in_person" else f"{voice} · {channel}"
        rows.append(
            f"<tr><th>{escape(label)}</th><td class=\"t\">{escape(text)}</td>{''.join(cells)}</tr>"
        )
    head = "".join(f"<th>{escape(c)}</th>" for c in cols)
    voices = ""
    if (report.root / "openai-voices").is_dir():
        items = "".join(
            f"<tr><th>{escape(v)}</th>"
            f'<td><audio controls preload="none" src="openai-voices/{escape(v)}.wav"></audio></td></tr>'
            for v in OpenAIProvider.CANDIDATE_VOICES
            if (report.root / "openai-voices" / f"{v}.wav").exists()
        )
        voices = (f"<h2>Every OpenAI voice, one line</h2><p>{escape(VOICES_LINE)}</p>"
                  f"<table><tbody>{items}</tbody></table>")
    return f"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Audition</title>
<style>
 body {{ font: 15px/1.5 system-ui, sans-serif; margin: 2rem; color: #222; }}
 table {{ border-collapse: collapse; }}
 th, td {{ border-bottom: 1px solid #ddd; padding: .6rem .8rem; text-align: left; vertical-align: top; }}
 th {{ white-space: nowrap; }}
 td.t {{ max-width: 28rem; }}
 td.x {{ color: #b00; }}
 audio {{ width: 16rem; }}
</style></head><body>
<h1>Audition</h1>
<p>The same lines from each provider. Judge names, dates, numbers, the dictionary readings
(代替・早急), keigo said the way a person says it, and the telephone treatment on the last row —
not a general sense of "nice". The library's voice is OpenAI; the other columns are for comparison.</p>
<table><thead><tr><th>voice</th><th>line</th>{head}</tr></thead>
<tbody>{''.join(rows)}</tbody></table>
{voices}
</body></html>
"""
