"""Channel treatment: making a studio recording sound like a telephone.

This is post-processing, never a second voice. The cast is fixed by relation
(see ``plan.py``) and a "phone voice" would break that — a learner would start
telling phone items from in-person ones by timbre instead of by listening to the
Japanese. So one recording of 「かしこまりました。」 is made once and the channel
is applied on top.

The treatment is not decoration. Business telephone Japanese genuinely is harder
to hear than studio audio: the band is narrow, the consonants that distinguish
いたします from いただきます sit near the top of it, and an item about a phone call
that sounds like a studio recording is an easier question than the exam asks.

Everything here is pure Python over 16-bit PCM WAV. No numpy, no ffmpeg, no
`audioop` — the first two are dependencies a laptop job does not need, and the
third was deprecated in 3.11 and removed in 3.13, which is not a thing to build
the audio pipeline on.
"""
from __future__ import annotations

import io
import math
import struct
import wave

from .plan import CHANNEL_PROFILES


def _decode(data: bytes) -> tuple[list[int], int, int]:
    """WAV bytes → (samples, sample_rate, channels). Mono-mixed."""
    with wave.open(io.BytesIO(data), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError(f"expected 16-bit PCM, got {w.getsampwidth() * 8}-bit")
        rate, channels, n = w.getframerate(), w.getnchannels(), w.getnframes()
        raw = w.readframes(n)

    samples = list(struct.unpack(f"<{len(raw) // 2}h", raw))
    if channels > 1:
        # Speech is mono. A stereo file from a provider is the same signal
        # twice, so averaging costs nothing and halves everything downstream.
        samples = [
            sum(samples[i:i + channels]) // channels
            for i in range(0, len(samples) - channels + 1, channels)
        ]
    return samples, rate, 1


def _encode(samples: list[int], rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return buf.getvalue()


def _resample(samples: list[int], src_rate: int, dst_rate: int) -> list[int]:
    """Linear interpolation.

    Good enough on purpose: the next thing that happens to this signal is being
    band-limited to a telephone line, and a sinc kernel's advantage lives in
    exactly the frequencies that are about to be thrown away.
    """
    if src_rate == dst_rate or not samples:
        return samples
    ratio = dst_rate / src_rate
    out_len = max(1, int(len(samples) * ratio))
    out = []
    for i in range(out_len):
        pos = i / ratio
        left = int(pos)
        right = min(left + 1, len(samples) - 1)
        frac = pos - left
        out.append(int(samples[left] * (1 - frac) + samples[right] * frac))
    return out


def _one_pole_low_pass(samples: list[int], rate: int, cutoff: float) -> list[int]:
    alpha = _alpha(rate, cutoff)
    out, prev = [], 0.0
    for s in samples:
        prev += alpha * (s - prev)
        out.append(int(prev))
    return out


def _one_pole_high_pass(samples: list[int], rate: int, cutoff: float) -> list[int]:
    """A low-pass subtracted from the signal — the standard one-pole trick."""
    alpha = _alpha(rate, cutoff)
    out, prev = [], 0.0
    for s in samples:
        prev += alpha * (s - prev)
        out.append(int(s - prev))
    return out


def _alpha(rate: int, cutoff: float) -> float:
    dt = 1.0 / rate
    rc = 1.0 / (2 * math.pi * cutoff)
    return dt / (rc + dt)


def _clip(samples: list[int]) -> list[int]:
    return [max(-32768, min(32767, s)) for s in samples]


def normalise(samples: list[int], target_peak: float = 0.89) -> list[int]:
    """Bring the loudest sample to a fixed level.

    Peak rather than loudness: these clips are one or two sentences each and a
    proper LUFS measurement over that is mostly measuring the silence at the
    ends. What actually matters is that the option clips within one item are the
    same loudness as each other — a learner should not be able to hear which one
    was recorded differently.
    """
    peak = max((abs(s) for s in samples), default=0)
    if peak == 0:
        return samples
    gain = (target_peak * 32767) / peak
    return _clip([int(s * gain) for s in samples])


def apply_channel(wav_bytes: bytes, channel: str) -> bytes:
    """Apply a channel profile to a WAV clip.

    An unknown channel is a pass-through rather than an error. `written` reaches
    here only if something upstream planned a clip for a reading item, and the
    right response to that is a clean recording plus a failing test somewhere
    else, not a crash in the middle of a batch of two hundred files.
    """
    profile = CHANNEL_PROFILES.get(channel)
    if profile is None:
        return wav_bytes

    samples, rate, _ = _decode(wav_bytes)
    target_rate = profile["sample_rate"]
    samples = _resample(samples, rate, target_rate)

    band = profile.get("band")
    if band:
        low, high = band
        # High-pass first: removing the rumble before the low-pass keeps the
        # filters from fighting over headroom in the part of the band that
        # actually carries the consonants.
        samples = _one_pole_high_pass(samples, target_rate, low)
        samples = _one_pole_low_pass(samples, target_rate, min(high, target_rate / 2 - 1))
        samples = _clip(samples)

    return _encode(normalise(samples), target_rate)


def duration_ms(wav_bytes: bytes) -> int:
    """How long a clip is. Stored alongside the file so the app can lay out a
    play button without downloading the audio to find out."""
    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
        return round(1000 * w.getnframes() / w.getframerate())


def wrap_pcm(pcm: bytes, rate: int) -> bytes:
    """Raw 16-bit mono PCM → a WAV container. For providers that return the
    samples without a header."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm[: len(pcm) - len(pcm) % 2])
    return buf.getvalue()


def silence(seconds: float, rate: int = 24000) -> bytes:
    """A valid, silent WAV. Used by the offline provider."""
    return _encode([0] * max(1, int(seconds * rate)), rate)
