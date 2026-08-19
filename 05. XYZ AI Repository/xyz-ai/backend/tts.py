"""
Text-to-speech via a locally-hosted AI4Bharat Indic Parler-TTS model.

Design principle, same as ai.py: this module never decides *what* to say —
app.py hands it text that was already generated/authorized elsewhere. This
module's only job is turning that text into natural-sounding audio in the
right language and persona voice.

Runs fully offline/locally via ai4bharat/indic-parler-tts (Hugging Face) —
no API key, no per-request cost, no external network call at inference
time. The model is loaded once, lazily, on the first call, and kept in
memory for the life of the process. A CUDA GPU is used automatically if
available (torch.cuda.is_available()); on CPU-only machines generation is
much slower - fine for local dev, but budget real time (seconds to tens of
seconds per reply) on CPU, and prefer a GPU box for a live demo.

This module never downloads the model weights itself (local_files_only=True
below) - it only ever loads them from the local Hugging Face cache. Run
`python download_tts_model.py` once, separately, before starting the server
(see README). If the weights aren't cached yet, loading just fails fast and
falls back to browser speech synthesis - nothing else breaks.

Voice selection: Indic Parler-TTS is *prompted*, not given a voiceId - you
describe the speaker in a natural-language "description" alongside the
text. SPEAKER_MAP below anchors that description to one of the model's
documented named speakers per language + a persona-appropriate style, for
voice consistency across turns. See
https://huggingface.co/ai4bharat/indic-parler-tts for the current speaker
roster and full language list before a demo; a language missing a named
speaker below still gets synthesized (the model detects language from the
prompt's script) but without a fixed voice identity, so update the map as
you confirm more names.

No word-level timing is available from this model (unlike Murf, which some
plans exposed), so the avatar always drives its mouth via live
audio-amplitude analysis of the generated clip (already supported by the
frontend for any provider that returns no word_durations).

If the model/weights aren't available yet (dependencies not installed,
download_tts_model.py hasn't been run yet, out of memory, etc.)
synthesize() returns None and app.py's /api/tts/speak returns
{"provider": "browser"} so the frontend falls back to the browser's
built-in speech synthesis - nothing breaks either way.
"""
import asyncio
import io
import logging
import os
import re
import time
import uuid
from pathlib import Path

logger = logging.getLogger("xyzai.tts")

AUDIO_DIR = Path(__file__).parent / "audio_cache"
AUDIO_DIR.mkdir(exist_ok=True)

# Cap how long generated clips are kept around, so a long-running demo
# process doesn't slowly fill the disk with old replies.
AUDIO_MAX_AGE_SECONDS = 60 * 30

# If the model load fails (deps missing, weights not downloaded yet via
# download_tts_model.py, out of memory, etc.), don't retry the heavy load on
# every single chat message — that's what actually made TTS *look* broken:
# every reply would silently stall for the full load attempt and then fall
# back to the browser voice, over and over. Instead, remember the failure
# and back off for a while, still logging so the real cause is visible in
# server logs instead of being swallowed.
LOAD_RETRY_COOLDOWN_SECONDS = 5 * 60
_load_failed_at = None

MODEL_ID = os.environ.get("INDIC_TTS_MODEL", "ai4bharat/indic-parler-tts")

# This app's i18n language code -> {"female": speaker name, "male": speaker name},
# taken from the ai4bharat/indic-parler-tts model card's documented
# per-language named-speaker roster (check the model card for updates -
# these are illustrative anchors, not a guaranteed-exhaustive list).
SPEAKER_MAP = {
    "en": {"female": "Mary", "male": "Thoma"},
    "hi": {"female": "Divya", "male": "Rohit"},
    "ta": {"female": "Kavitha", "male": "Jaya"},
    "te": {"female": "Lalitha", "male": "Prakash"},
    "mr": {"female": "Sunita", "male": "Sanjay"},
    "bn": {"female": "Aditi", "male": "Arjun"},
    "gu": {"female": "Neha", "male": "Yash"},
    "pa": {"female": "Divjot", "male": "Gurpreet"},
    "kn": {"female": "Anu", "male": "Suresh"},
    "ml": {"female": "Anjali", "male": "Harish"},
    # "ur" intentionally left out: Urdu is on the model's officially
    # supported language list, but no named speaker for it is documented
    # as of writing. It still gets synthesized via the unnamed fallback
    # description below - check the model card and fill in a name here
    # once you've confirmed one that sounds right for Urdu script input.
}

# Same persona split used for Murf's PERSONA_STYLE previously: a female
# voice for the warmer, informal personas and a male voice for the more
# formal ones, purely for some out-of-the-box variety. Override per-role
# if you'd rather every role sound the same.
PERSONA_GENDER = {"student": "female", "parent": "female", "teacher": "male", "principal": "male"}
PERSONA_STYLE = {
    "student": "speaks with a friendly, upbeat, encouraging tone at a moderate pace",
    "parent": "speaks with a warm, caring, reassuring tone at a gentle, moderate pace",
    "teacher": "speaks with a clear, professional, efficient tone at a moderate pace",
    "principal": "speaks with a measured, professional, authoritative tone at a moderate pace",
}

_model = None
_tokenizer = None
_description_tokenizer = None
_device = "cpu"
_load_lock = asyncio.Lock()


def _load_model():
    """Blocking model load - only ever called once, off the event loop
    (see _ensure_model). Imports are local so the rest of the app still
    starts up fine even if torch/parler-tts aren't installed; only TTS
    itself degrades (to the browser fallback) in that case.

    local_files_only=True everywhere: this function only ever loads
    already-cached weights, it never reaches out to the network. Run
    `python download_tts_model.py` once beforehand to populate the cache -
    see that file / the README."""
    global _model, _tokenizer, _description_tokenizer, _device
    import torch
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    _device = "cuda:0" if torch.cuda.is_available() else "cpu"
    logger.info("Loading Indic Parler-TTS model %s onto %s from local cache...", MODEL_ID, _device)
    try:
        _model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL_ID, local_files_only=True).to(_device)
        _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, local_files_only=True)
        _description_tokenizer = AutoTokenizer.from_pretrained(
            _model.config.text_encoder._name_or_path, local_files_only=True
        )
    except Exception:
        logger.error(
            "Indic Parler-TTS weights aren't cached locally yet. Run "
            "`python download_tts_model.py` in backend/ once, then restart the server."
        )
        raise
    logger.info("Indic Parler-TTS model loaded and ready.")


async def _ensure_model():
    global _load_failed_at
    if _model is not None:
        return
    if _load_failed_at is not None and (time.time() - _load_failed_at) < LOAD_RETRY_COOLDOWN_SECONDS:
        # Already know it's broken right now - fail fast instead of hanging
        # every request behind a doomed retry.
        raise RuntimeError("indic-parler-tts previously failed to load; still in cooldown")
    async with _load_lock:
        if _model is None:  # re-check: another request may have loaded it while we waited for the lock
            try:
                await asyncio.to_thread(_load_model)
                _load_failed_at = None
            except Exception:
                _load_failed_at = time.time()
                logger.exception("Failed to load Indic Parler-TTS model - falling back to browser speech synthesis.")
                raise


def preload():
    """Fire-and-forget model warmup, called once from app.py on startup so
    the *first* chat reply of the demo doesn't stall on the multi-second
    load of already-cached weights into memory. Safe to call even if
    dependencies aren't installed, or the weights haven't been downloaded
    yet via download_tts_model.py - the failure is logged (see
    _ensure_model) rather than silently swallowed, and TTS just stays on
    the browser-fallback path until it's fixed."""
    async def _warm():
        try:
            await _ensure_model()
        except Exception:
            pass
    asyncio.ensure_future(_warm())


def status() -> dict:
    """Cheap, synchronous snapshot of where TTS is at - never triggers a
    load itself. "ready": model loaded, replies will use the real voice.
    "failed": load attempted and failed - most commonly because
    download_tts_model.py hasn't been run yet (see server logs); browser
    voice is used until the cooldown above lets it retry.
    "loading_or_not_started": neither yet - either preload()'s background
    task hasn't finished, or nothing has requested it yet."""
    if _model is not None:
        return {"state": "ready", "device": _device, "model": MODEL_ID}
    if _load_failed_at is not None:
        retry_in = max(0, LOAD_RETRY_COOLDOWN_SECONDS - (time.time() - _load_failed_at))
        return {"state": "failed", "retry_in_seconds": round(retry_in)}
    return {"state": "loading_or_not_started", "model": MODEL_ID}


def ensure_ready_sync():
    """Blocking, synchronous model load for use *before* the server starts
    accepting requests - e.g. from start.sh/start.bat, so voice is either
    confirmed ready or its failure is printed before the first chat reply,
    instead of the normal lazy/background preload() above. Only ever loads
    already-cached weights (see _load_model) - it does not download
    anything. Raises on failure so the caller can decide whether to abort
    or continue in browser-voice-only mode."""
    if _model is not None:
        return
    _load_model()


def _build_description(language: str, role: str) -> str:
    gender = PERSONA_GENDER.get(role, "female")
    speaker = SPEAKER_MAP.get(language, {}).get(gender)
    style = PERSONA_STYLE.get(role, "speaks in a warm, natural tone at a moderate pace")
    who = speaker if speaker else "The speaker"
    return f"{who} {style}. The recording is of very high quality, with clear audio and no background noise."


def _generate_wav_bytes(text: str, language: str, role: str) -> bytes:
    """Blocking inference - only ever run off the event loop via asyncio.to_thread."""
    import soundfile as sf

    description = _build_description(language, role)
    description_ids = _description_tokenizer(description, return_tensors="pt").to(_device)
    prompt_ids = _tokenizer(text, return_tensors="pt").to(_device)
    generation = _model.generate(
        input_ids=description_ids.input_ids,
        attention_mask=description_ids.attention_mask,
        prompt_input_ids=prompt_ids.input_ids,
        prompt_attention_mask=prompt_ids.attention_mask,
    )
    audio_arr = generation.cpu().numpy().squeeze()
    buf = io.BytesIO()
    sf.write(buf, audio_arr, _model.config.sampling_rate, format="WAV")
    return buf.getvalue()


def _cleanup_old_clips():
    cutoff = time.time() - AUDIO_MAX_AGE_SECONDS
    for f in AUDIO_DIR.glob("*.wav"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


# Chat replies are meant to already be spoken-friendly (see ai.py's
# fallback templates, which spell out "percent" and avoid dense
# parentheticals) - this is a second, defensive pass so an occasional
# stray symbol (a "%" a template missed, markdown emphasis a Groq reply
# slips in, etc.) doesn't make the model mispronounce or read the raw
# character aloud.
#
# Numbers are the biggest offender in practice: Indic Parler-TTS (like most
# TTS models) is trained overwhelmingly on running prose, not bare digit
# glyphs, so "Aryan is in class 10 with 85% attendance" tends to mumble or
# skip the "10" and "85" - digits embedded mid-sentence are exactly the case
# it wasn't trained to read confidently. The fix isn't stripping characters
# anymore (that only worked for punctuation) - it's *spelling numbers out as
# words* before they ever reach the model, the same way a human narrator
# would silently expand "10" -> "ten" while reading aloud.
_MARKDOWN_EMPHASIS_RE = re.compile(r"[*_`#]+")
_WHITESPACE_RE = re.compile(r"\s+")

try:
    from num2words import num2words
    _NUM2WORDS_OK = True
except ImportError:  # pragma: no cover - degrades to digit-by-digit reading
    _NUM2WORDS_OK = False
    logger.warning("num2words not installed - numbers will be read digit-by-digit instead of as words. Run `pip install num2words`.")

# Languages num2words has a native converter for, keyed by this app's i18n
# code. Anything not in here (hi, ta, mr, gu, pa, ml, ur as of num2words
# 0.5.x) falls back to the hand-written Hindi converter below for "hi", or
# to English words for the rest - not native-script, but far more
# intelligible than raw digits or a magnitude the model mangles.
_NUM2WORDS_LANG = {"en": "en_IN", "bn": "bn", "kn": "kn", "te": "te"}

# Hand-written Devanagari cardinal converter for Hindi, since num2words has
# no "hi" entry. Hindi 0-99 aren't a regular decade+unit pattern (unlike
# English "twenty-one"), so this is a flat lookup table rather than a
# formula - update it if a native speaker spots a mistake.
_HI_UNITS = [
    "शून्य", "एक", "दो", "तीन", "चार", "पांच", "छह", "सात", "आठ", "नौ",
    "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
    "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
    "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
    "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चौवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
    "पचास", "इक्यावन", "बावन", "तिरेपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
    "साठ", "इकसठ", "बासठ", "तिरेसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
    "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उनासी",
    "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
    "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पंचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
]


def _hi_two_digit(n: int) -> str:
    return _HI_UNITS[n]


def _hi_cardinal(n: int) -> str:
    """Indian-grouping (crore/lakh/hazaar) cardinal, adequate for the
    numbers a school ERP actually says out loud (ages, marks, fees, dates).
    Not built for astronomically large numbers - that's not a real case here."""
    if n == 0:
        return _HI_UNITS[0]
    parts = []
    crore, n = divmod(n, 10_000_000)
    if crore:
        parts.append(f"{_hi_two_digit(crore)} करोड़")
    lakh, n = divmod(n, 100_000)
    if lakh:
        parts.append(f"{_hi_two_digit(lakh)} लाख")
    thousand, n = divmod(n, 1_000)
    if thousand:
        parts.append(f"{_hi_two_digit(thousand)} हज़ार")
    hundred, n = divmod(n, 100)
    if hundred:
        parts.append(f"{_hi_two_digit(hundred)} सौ")
    if n:
        parts.append(_hi_two_digit(n))
    return " ".join(parts)


def _hi_number_to_words(num_str: str) -> str:
    if "." in num_str:
        whole, frac = num_str.split(".", 1)
        whole_words = _hi_cardinal(int(whole)) if whole else _HI_UNITS[0]
        frac_words = " ".join(_HI_UNITS[int(d)] for d in frac)
        return f"{whole_words} दशमलव {frac_words}"
    return _hi_cardinal(int(num_str))


def _number_to_words(num_str: str, language: str) -> str:
    """num_str is a plain digit string (commas already stripped), optionally
    with one '.' for a decimal. Returns it spelled out in `language` on a
    best-effort basis - see _NUM2WORDS_LANG comment for exact coverage."""
    if language == "hi":
        return _hi_number_to_words(num_str)
    lang_code = _NUM2WORDS_LANG.get(language, "en_IN")
    if not _NUM2WORDS_OK:
        return _digits_to_words(num_str, language)
    try:
        if "." in num_str:
            return num2words(float(num_str), lang=lang_code)
        return num2words(int(num_str), lang=lang_code)
    except (NotImplementedError, ValueError):
        # Belt-and-braces: any lang num2words doesn't actually support falls
        # back to English words rather than raising mid-reply.
        return num2words(float(num_str)) if "." in num_str else num2words(int(num_str))


def _digit_word(d: str, language: str) -> str:
    if language == "hi":
        return _HI_UNITS[int(d)]
    if _NUM2WORDS_OK:
        try:
            return num2words(int(d), lang=_NUM2WORDS_LANG.get(language, "en_IN"))
        except (NotImplementedError, ValueError):
            pass
    return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][int(d)]


def _digits_to_words(digit_str: str, language: str) -> str:
    """Read digit-by-digit ('0' '9' '2' -> 'zero nine two'), used for IDs,
    phone numbers, and roll/admission numbers - these are identifiers, not
    magnitudes, so "zero nine two" is what a human would actually say, not
    "ninety-two" (which also silently drops a real leading zero)."""
    return " ".join(_digit_word(d, language) for d in digit_str)


_CURRENCY_RE = re.compile(r"(?:₹|Rs\.?\s?)\s?(\d[\d,]*(?:\.\d+)?)")
_TIME_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)(?:\s?(AM|PM|am|pm))?\b")
_ORDINAL_RE = re.compile(r"\b(\d{1,3})(st|nd|rd|th)\b")
_PERCENT_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*%")
# Read digit-by-digit only when a run genuinely looks like an identifier,
# not a magnitude: a leading zero (e.g. roll no. "007", which cardinal
# conversion would also silently mangle since int() drops the zero), or
# 10+ digits (phone-number length). A plain 5-6 digit number - a fee
# amount, a total headcount - is still read as a real number, not spelled
# out digit by digit.
_ID_LIKE_RE = re.compile(r"\b(0\d+|\d{10,})\b")
_PLAIN_NUMBER_RE = re.compile(r"\b\d+(?:,\d{2,3})*(?:\.\d+)?\b")

_CURRENCY_WORD = {"hi": "रुपये"}
_PERCENT_WORD = {"hi": "प्रतिशत"}


def _expand_numbers(text: str, language: str) -> str:
    def strip_commas(s: str) -> str:
        return s.replace(",", "")

    def currency_sub(m: re.Match) -> str:
        words = _number_to_words(strip_commas(m.group(1)), language)
        return f"{words} {_CURRENCY_WORD.get(language, 'rupees')}"

    def time_sub(m: re.Match) -> str:
        hour, minute, meridiem = m.group(1), m.group(2), m.group(3)
        hour_words = _number_to_words(str(int(hour)), language)
        if minute == "00":
            spoken = f"{hour_words} o'clock" if language != "hi" else f"{hour_words} बजे"
        elif language == "hi":
            spoken = f"{hour_words} बजकर {_number_to_words(str(int(minute)), language)} मिनट"
        else:
            spoken = f"{hour_words} {_number_to_words(minute, language)}"
        return f"{spoken} {meridiem}".strip() if meridiem else spoken

    def ordinal_sub(m: re.Match) -> str:
        n = int(m.group(1))
        if language == "en":
            return num2words(n, to="ordinal") if _NUM2WORDS_OK else f"{n}{m.group(2)}"
        # No compact ordinal table for the other languages yet - a cardinal
        # reading ("class 4 exam" instead of "class 4th exam") is still far
        # more intelligible than a fumbled "4th".
        return _number_to_words(str(n), language)

    def percent_sub(m: re.Match) -> str:
        words = _number_to_words(strip_commas(m.group(1)), language)
        return f"{words} {_PERCENT_WORD.get(language, 'percent')}"

    def id_sub(m: re.Match) -> str:
        return _digits_to_words(m.group(1), language)

    def plain_sub(m: re.Match) -> str:
        return _number_to_words(strip_commas(m.group(0)), language)

    text = _CURRENCY_RE.sub(currency_sub, text)
    text = _TIME_RE.sub(time_sub, text)
    text = _ORDINAL_RE.sub(ordinal_sub, text)
    text = _PERCENT_RE.sub(percent_sub, text)
    text = _ID_LIKE_RE.sub(id_sub, text)
    text = _PLAIN_NUMBER_RE.sub(plain_sub, text)
    return text


def _normalize_for_speech(text: str, language: str = "en") -> str:
    text = _expand_numbers(text, language)
    text = _MARKDOWN_EMPHASIS_RE.sub("", text)
    text = _WHITESPACE_RE.sub(" ", text)
    return text.strip()


async def synthesize(text: str, language: str, role: str) -> dict | None:
    """Returns {"audio_url": "/audio/<file>.wav"} on success, or None if the
    model isn't usable right now - the caller (app.py) should fall back to
    browser speech synthesis in that case."""
    if not text or not text.strip():
        return None
    text = _normalize_for_speech(text, language)
    try:
        await _ensure_model()
    except Exception:
        # torch/parler-tts not installed, no network for the first-time
        # weights download, out of memory, etc. - fail soft to the browser.
        # The real exception is logged in _ensure_model / _load_model so
        # it's still visible in server logs instead of vanishing.
        return None

    try:
        wav_bytes = await asyncio.to_thread(_generate_wav_bytes, text, language, role)
    except Exception:
        logger.exception("Indic Parler-TTS generation failed for a request - falling back to browser speech synthesis.")
        return None

    _cleanup_old_clips()
    filename = f"{uuid.uuid4().hex}.wav"
    (AUDIO_DIR / filename).write_bytes(wav_bytes)
    return {"audio_url": f"/audio/{filename}"}