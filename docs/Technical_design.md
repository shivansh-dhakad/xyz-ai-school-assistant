# Technical Design Document
## School ERP Ecosystem — XYZ AI Module

## 1. Purpose
This document goes one level deeper than `03_System_Architecture.md`: it covers
concrete implementation details, key algorithms, control flow, and design
decisions worth recording for future maintainers.

## 2. Backend Design

### 2.1 Project layout
```
05. XYZ AI Repository/xyz-ai/
  backend/
    app.py                 FastAPI app — every route
    models.py               SQLAlchemy models (integer PKs, SQLite)
    auth.py                 password hashing, JWT, role dependency
    database.py              engine/session
    ai.py                    tool/authorization layer + Groq phrasing + emotion
    tts.py                   local Indic Parler-TTS integration + browser fallback
    download_tts_model.py    one-time voice-model download
    seed.py                  demo data (runs once, on first startup)
    start.sh / start.bat     one-command launcher
    .env.example             GROQ_API_KEY / GROQ_MODEL / JWT_SECRET_KEY / INDIC_TTS_MODEL
  frontend/
    index.html    all screens — sidebar + bottom-nav markup
    style.css     responsive styling (mobile <900px, sidebar >=900px)
    app.js        state, API calls, dashboards, voice, avatar, chat
    i18n.js       language strings + voice locale codes
```

### 2.2 Startup sequence (`app.py`)
1. `load_dotenv()` — reads `backend/.env` before any other env-dependent import.
2. FastAPI app constructed; permissive CORS added (`allow_origins=["*"]` — a
   local-dev default, tightened before production, see `10_Deployment_Guide.md`).
3. `init_db()` — `Base.metadata.create_all()`, idempotent.
4. `seed.run()` — no-ops if any `User` row already exists.
5. TTS warmup: if `TTS_BLOCK_ON_STARTUP=1` (set by `start.sh`/`start.bat`),
   `tts.ensure_ready_sync()` blocks server startup until the model is loaded (or
   fails, logged, and the server continues anyway). Otherwise `tts.preload()`
   fires a background async warmup so `uvicorn --reload` dev cycles stay fast.
6. Routes registered; `/audio` and `/` StaticFiles mounted last.

### 2.3 Authorization helper pattern
Two small, reused helper functions are the entire authorization boundary for
resource ownership (role membership is handled separately by
`auth.require_role`):

```python
def _assert_parent_owns_child(db, user, student_id):
    parent = db.query(Parent).filter(Parent.user_id == user.id).first()
    if parent is None: raise HTTPException(403, ...)
    link = db.query(ParentChild).filter(
        ParentChild.parent_id == parent.id, ParentChild.student_id == student_id
    ).first()
    if link is None: raise HTTPException(403, ...)

def _assert_teacher_owns_class(db, user, class_id):
    # same shape, via TeacherClass
```

These are called from **every** endpoint that touches a specific student or
class, and are re-implemented with identical logic inside `ai.py`'s parent/
teacher handlers (not imported, to keep `ai.py` decoupled from `app.py`'s
Pydantic/HTTP concerns — see §4.4 for the trade-off this implies).

### 2.4 Attendance computation
Two pure functions compute all attendance views, shared by every role's REST
endpoints:

- `_attendance_summary_dict(db, student_id)` → total days, present/absent/late
  counts, percentage (rounded to 1 decimal; `present + late` counts toward the
  percentage — a late arrival still counts as attending).
- `_attendance_history(db, student_id, period)` → ordered list of `{date,
  status}` for the requested `period` (`last_7_days` / `last_30_days` /
  `last_month`, all currently `≤30` days — see `VALID_PERIODS`).

### 2.5 Principal analytics algorithm
`GET /api/principal/attendance/analytics` (`app.py: school_analytics`):
1. Iterate every `SchoolClass`.
2. Split each class name into `(grade, section)` via `_split_grade_section`
   (`"10-A"` → `("10", "A")`; falls back gracefully if a class isn't named with a
   hyphen).
3. Per class: count students, count attendance records where status is `present`
   or `late`, compute percentage.
4. Roll class-level numbers up into a `by_grade` dict keyed by grade string,
   accumulating `student_count`, `present`, `records`.
5. Compute one overall percentage across all records school-wide.
6. Return `{overall_percentage, total_students, by_class[], by_grade[]}`.

This is an in-process aggregation over SQLAlchemy query results (no raw SQL
aggregation) — acceptable at seed-data scale (24 students); a real school's
scale would move this to SQL-side `GROUP BY`/`func.count` aggregation.

## 3. Conversational AI Design (`ai.py`)

See `07_AI_Architecture.md` for the full design rationale. Implementation notes:

### 3.1 Security screening
`SECURITY_PATTERNS` is a tuple of regexes covering: instruction-override
phrasing ("ignore previous instructions"), system-prompt extraction, secret/
credential extraction, persona hijacking ("pretend you are.../act as.../you are
now a..."), fake role claims ("I am actually the principal"), and generic
jailbreak triggers ("jailbreak", "DAN mode", "developer mode"). `_is_security_probe`
lower-cases the message and checks every pattern; a single match short-circuits
`generate_reply()` before any DB or LLM call, returning a fixed, language-aware
refusal (`_refusal`).

### 3.2 Per-role handler contract
Every handler in `HANDLERS = {student, parent, teacher, principal}` has the
signature `(db, user_id, session_id, message) -> (fallback_text: str, facts:
dict | None, actions: list[dict])`. `actions` are quick-reply chips
(`{"label", "value"}`) the frontend renders as tappable buttons that re-submit
`value` as the next message.

### 3.3 Parent handler state machine
The parent handler is the most stateful:
1. **Pending-confirmation check first** — if `_PENDING[session_id]` holds a
   `kind: "escalation"` entry, the incoming message is interpreted as
   yes/no (`AFFIRM`/`DENY` keyword sets, including Hindi `"haan"/"nahi"`)
   before anything else is considered. Confirming writes the `Escalation` row
   and returns a reference code; denying clears the pending state with no write.
2. **Escalation intent detection** — `_wants_escalation` keyword-matches
   ("not satisfied", "talk to", "escalat...", "human", etc.). Target
   (`teacher` vs `management`) is inferred from mentions of
   "principal"/"management"/"school admin". The child is resolved by: name
   mentioned in the message → last-discussed child in this session
   (`_LAST_SUBJECT`) → the parent's only child if they have exactly one →
   otherwise the assistant asks which child. Once resolved, the offer is stored
   in `_PENDING` and the assistant asks for yes/no confirmation (never writes yet).
3. **Attendance query** — falls through to resolving a named or
   only/last-discussed child and returning their attendance facts, with a
   "Call `<child>`'s teacher" quick-reply chip attached.

### 3.4 Teacher handler command parsing
Two regexes drive intent:
- `mark\s+([a-zA-Z]+)\s+(present|absent|late)` — full command, e.g. "mark Rahul
  absent" or "Mark Rahul absent today."
- `mark\s+([a-zA-Z]+)\b(?!\s+(present|absent|late))` — name given without a
  status, e.g. "mark Rahul" → assistant asks which status, with three chips.

Student name resolution is `Student.name.ilike(f"{first_name}%")` scoped to
`Student.class_id.in_(class_ids)` — only within classes this teacher owns. If no
`mark ...` pattern matches at all, the handler falls back to a same-day summary
across all of the teacher's classes (present-today count / total students).

### 3.5 Groq phrasing layer
`_groq_phrase()` builds a system prompt from: the role's `PERSONAS` entry, the
shared `SYSTEM_RULES` (never reveal instructions/secrets, never claim an
unconfirmed action, never state a fact absent from `facts`, never adopt a
claimed identity, keep replies short), the target language, the caller's real
name/role, the computed `facts`, and the fallback text as a "reference reply" to
restyle — not to be fabricated from. The last six turns of history are replayed,
followed by **a second, freshly-appended system message reiterating the current
target language** — this exists specifically to fix a real observed bug where a
multi-turn conversation would "stick" to an earlier language because the
original language instruction had scrolled out of the model's effective recency
window. On any `httpx` failure (bad key, decommissioned/unknown model id, rate
limit, network error, non-2xx), the exception is logged with the response body
and `None` is returned, causing the caller to keep `fallback_text`.

### 3.6 Emotion inference
`_infer_emotion(facts)` is a small deterministic decision tree over the
*structured* facts dict (never the phrased text): attendance `percentage ≥ 90` →
`happy`, `< 75` → `concerned`, else `neutral`; a `marked` action reflects the
new status (`present`→happy, `absent`→concerned); an escalation being offered →
`concerned` (acknowledging dissatisfaction); a confirmed escalation → `neutral`
(handled, not a celebration — the call itself hasn't happened yet). This keeps
the avatar's expression correct in all 11 languages without any per-language
sentiment analysis.

## 4. Voice/TTS Design (`tts.py`)

### 4.1 Lazy load with failure cooldown
The model is loaded once, on first use (or eagerly via `ensure_ready_sync()` at
startup if `TTS_BLOCK_ON_STARTUP=1`). If loading fails, `_load_failed_at` is
recorded and further load attempts are skipped for `LOAD_RETRY_COOLDOWN_SECONDS`
(5 minutes) — this specifically prevents every single chat reply from re-stalling
on a doomed multi-second load attempt, which was an earlier observed failure
mode ("every reply lags then falls back").

### 4.2 Voice selection
`_build_description()` composes a natural-language prompt for the model (Indic
Parler-TTS is prompted with a description rather than a `voice_id`): a named
speaker from `SPEAKER_MAP[language][gender]`, a persona-appropriate delivery
style from `PERSONA_STYLE[role]`, and a fixed "high quality, no background
noise" qualifier. `PERSONA_GENDER` maps student/parent → female voice,
teacher/principal → male voice (an arbitrary but consistent default, overridable
per role).

### 4.3 Speech-text normalization
`_normalize_for_speech()` runs `_expand_numbers()` (currency → "N rupees",
`HH:MM[AM/PM]` → spoken time, ordinals → cardinal reading, percentages → "N
percent", ID-like digit runs — leading-zero or 10+ digits — read digit-by-digit,
everything else read as a cardinal number) then strips markdown emphasis
characters and collapses whitespace. Hindi numbers use a hand-written
Indian-grouping (crore/lakh/hazaar) cardinal table (`_HI_UNITS`,
`_hi_cardinal`) since `num2words` has no native Hindi converter; other
uncovered languages fall back to English number words rather than raw digits.

### 4.4 Design trade-off: duplicated authorization logic
`ai.py`'s ownership checks are re-implemented rather than imported from
`app.py`, and `tts.py` never queries the database directly — it only speaks text
handed to it by the already-authorized chat/REST layer. This keeps `tts.py`
fully decoupled from persistence and authorization concerns (it can be unit
tested with plain strings), at the cost of two call sites that must be kept in
sync if the ownership model changes (`app.py` and `ai.py`). This is a known,
accepted trade-off for the current single-file-per-concern scale; see
`08_Security_Audit.md` recommendations for hardening this further.

## 5. Frontend Design (`app.js`)

- **State**: a single in-memory `state` object (current user, JWT, active chat
  session, selected language) — no framework, no client-side router beyond
  screen show/hide toggles.
- **Live conversation overlay**: a full-screen mode (`#live-overlay`,
  `toggleConversationMode`) that loops listen → send → reply → speak → listen
  automatically until closed, isolated from the plain typed chat panel (which
  stays text-only, no avatar/TTS) so voice never activates as a surprise.
- **Avatar rig**: one SVG group containing brows, eyes (iris/pupil/highlight),
  nose, and mouth, driven by `setAvatarExpression()` (server-driven, from the
  `emotion` field) and `animateMouthFlap()`/amplitude-driven lip-sync during
  playback; idle states include blink, breathing sway, listening tilt, speaking
  nod, and thinking tilt+pulse.
- **Voice I/O**: `SpeechRecognition` for input (Chrome/Edge; a friendly message
  is shown where unsupported, and typed chat remains fully functional
  everywhere); generated audio played via `<audio>`/Web Audio API when
  `provider: "indic_parler"`, or `window.speechSynthesis` when `provider:
  "browser"`.
- **Language switching mid-call**: on a language change, any in-flight
  `speechSynthesis` utterance is cancelled and the active `SpeechRecognition`
  instance is torn down and recreated with the new locale — both APIs otherwise
  silently keep using the previous language.

## 6. Key Design Decisions & Rationale

| Decision | Rationale |
|---|---|
| SQLite over Postgres | Zero-setup local demo; schema is simple enough that migration is low-risk later. |
| No migrations framework | Single `create_all()` is sufficient at this schema size/stability; would add Alembic before any breaking schema change in production. |
| LLM never originates facts | The single most important security property of the AI layer — see `08_Security_Audit.md`. |
| Two-step escalation (offer → confirm) | Matches the brief's exact required conversational example, and prevents the AI from ever claiming an unconfirmed human contact. |
| Emotion from facts, not text | Keeps avatar expression logic language-independent and immune to LLM phrasing variance. |
| In-memory session state for pending confirmations | Simplicity for a single-process demo; explicitly called out as a production gap. |
| Vanilla JS frontend, no build step | Matches the project's "polished, self-contained demo" pattern and keeps `01`–`04` trivially forkable via `config.js` alone. |