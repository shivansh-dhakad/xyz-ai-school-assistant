# System Architecture
## School ERP Ecosystem — XYZ AI Module

## 1. Architectural Style

XYZ AI is a **modular monolith**: one FastAPI process serves the REST API, the
conversational AI layer, the TTS layer, and the static frontend, backed by a
single SQLite database file. This is a deliberate choice for a demo-scale,
single-school system — it minimizes moving parts (no message queue, no
microservice network hops) while keeping clear internal module boundaries that
map directly to files, so it can be split into services later if scale demands it.

Four additional repositories (`01`–`04`) are **frontend-only** — they reuse the
exact same `index.html` / `style.css` / `app.js` / `i18n.js` as `xyz-ai/frontend`,
differing only in a two-line `config.js` that pins `API_BASE` and `PORTAL_ROLE`.
This lets each role be deployed/shipped as a separate app/domain without
duplicating any logic.

## 2. High-Level Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              Browser (client)                              │
│                                                                             │
│   Student / Parent / Management / Staff Portal    ┌────────────────────┐  │
│   (index.html + app.js + i18n.js + config.js)      │  xyz-ai reference  │  │
│                                                     │  frontend (all 4   │  │
│   ── Dashboards (role-scoped REST calls)            │  roles, same code) │  │
│   ── Chat panel (text)                              └────────────────────┘  │
│   ── Live conversation overlay (avatar + mic + TTS playback)               │
│      • Web Speech API (SpeechRecognition) — voice input                    │
│      • Web Audio API — amplitude-driven lip-sync                           │
│      • window.speechSynthesis — voice fallback                             │
└───────────────────────────────┬─────────────────────────────────────────┘
                                  │ HTTPS/JSON, Bearer JWT
┌───────────────────────────────▼─────────────────────────────────────────┐
│                        FastAPI app  (backend/app.py)                     │
│                                                                            │
│  ┌───────────┐ ┌───────────────┐ ┌───────────────────┐ ┌───────────────┐ │
│  │  auth.py   │ │  REST routes   │ │      ai.py         │ │    tts.py     │ │
│  │  JWT +     │ │  student/      │ │  role handlers +   │ │  Indic Parler │ │
│  │  bcrypt +  │ │  parent/       │ │  security probe +  │ │  TTS (local,  │ │
│  │  role dep. │ │  teacher/      │ │  Groq phrasing +   │ │  lazy-loaded, │ │
│  │            │ │  principal/    │ │  emotion inference │ │  GPU/CPU)     │ │
│  │            │ │  escalation/   │ │                     │ │               │ │
│  │            │ │  chat routes   │ │                     │ │               │ │
│  └─────┬─────┘ └───────┬───────┘ └──────────┬──────────┘ └──────┬───────┘ │
│        │               │                     │                    │        │
│        └───────────────┴─────────┬───────────┴────────────────────┘        │
│                                    │                                        │
│                          ┌────────▼─────────┐                              │
│                          │   database.py     │                              │
│                          │  SQLAlchemy engine │                              │
│                          │  + session factory │                              │
│                          └────────┬─────────┘                              │
└───────────────────────────────────┼──────────────────────────────────────┘
                                     │
                          ┌──────────▼──────────┐        ┌────────────────────┐
                          │   xyzai.db (SQLite)  │        │  audio_cache/*.wav  │
                          └──────────────────────┘        │  (generated clips)  │
                                                            └────────────────────┘
                External services (both optional, both fail-soft):
        ┌──────────────────────────┐        ┌───────────────────────────────┐
        │  Groq Chat Completions API │        │  Hugging Face Hub (download-  │
        │  (chat phrasing only)      │        │  time only, never at runtime) │
        └──────────────────────────┘        └───────────────────────────────┘
```

## 3. Module Responsibilities

| Module | File | Responsibility |
|---|---|---|
| **Entry point** | `app.py` | FastAPI app instance, CORS, startup sequence (`init_db`, `seed.run`, TTS preload), all REST route handlers, request/response Pydantic schemas, ownership-check helpers. |
| **Data models** | `models.py` | SQLAlchemy ORM models — one file, integer PKs, no migration framework. |
| **Persistence** | `database.py` | Engine (`sqlite:///./xyzai.db`), session factory, `get_db()` FastAPI dependency, `init_db()`. |
| **Auth** | `auth.py` | Password hashing (bcrypt), JWT issue/verify, `CurrentUser` dataclass, `get_current_user` / `require_role(*roles)` dependencies. |
| **Demo data** | `seed.py` | Idempotent one-time seeding of classes, students, teachers, parents, principal, and 20 days of randomized attendance. |
| **Conversational AI** | `ai.py` | Security-probe screening, per-role handlers, optional Groq phrasing layer, emotion inference, in-memory session state for pending escalations/last-discussed-student. |
| **Voice** | `tts.py` | Lazy local model load, per-language/persona voice description, number/currency/time/ordinal text normalization, WAV synthesis, audio-cache lifecycle. |
| **Frontend (shared)** | `frontend/{index.html,style.css,app.js,i18n.js}` | Login, dashboards per role, chat panel, live-conversation overlay with the animated avatar, i18n strings + locale codes. |
| **Frontend (role-scoped)** | `01`–`04`'s `frontend/config.js` | Pins `API_BASE` and `PORTAL_ROLE` so a portal only signs in one role. |

## 4. Request Lifecycle

### 4.1 A typical REST call (e.g. parent viewing a child's attendance)
1. Browser sends `GET /api/parent/child/{id}/attendance` with `Authorization:
   Bearer <jwt>`.
2. `auth.get_current_user` decodes/verifies the JWT, re-queries `User` by id, and
   builds a `CurrentUser` — role is never taken from the client.
3. `auth.require_role("parent")` rejects any non-parent caller (403).
4. `app._assert_parent_owns_child` checks a `ParentChild` row exists linking this
   parent to this student; otherwise 403.
5. `app._attendance_summary_dict` computes present/absent/late counts and
   percentage directly from `Attendance` rows.
6. JSON response returned.

### 4.2 A chat turn
1. Browser `POST`s the message to `/api/chat/sessions/{id}/messages`.
2. `app.py` loads session + prior messages, persists the user's message.
3. `ai.generate_reply()`:
   a. Screens the message against `SECURITY_PATTERNS`; if matched, returns a
      fixed refusal immediately (no DB/LLM call).
   b. Dispatches to the role handler (`_handle_student/_parent/_teacher/_principal`),
      which performs the *same* ownership-checked queries/writes as the REST
      layer and returns `(fallback_text, facts, actions)`.
   c. If `GROQ_API_KEY` is set, calls Groq with the persona system prompt, hard
      rules, the computed `facts`, and the fallback text as a "reference reply,"
      asking only for natural phrasing in the target language — on any failure,
      silently keeps `fallback_text`.
   d. Derives `emotion` from `facts` (language-independent).
4. Assistant reply persisted; `{reply, actions, emotion}` returned.

### 4.3 A spoken reply
1. Frontend calls `POST /api/tts/speak` with the already-generated reply text.
2. `tts.synthesize()` normalizes text for speech, ensures the model is loaded
   (lazy, with a failure cooldown to avoid retry storms), and runs inference off
   the event loop via `asyncio.to_thread`.
3. On success, a `.wav` is written to `audio_cache/` and `{provider:
   "indic_parler", audio_url}` is returned; on any failure at any stage,
   `{provider: "browser"}` is returned instead and the frontend uses
   `speechSynthesis`.

## 5. Cross-Cutting Concerns

### 5.1 Authorization boundary
Enforced at the **application/tool layer**, not the LLM: `_assert_parent_owns_child`
and `_assert_teacher_owns_class` in `app.py` are mirrored (same logic) inside
`ai.py`'s role handlers, so the chat interface can never see or do more than the
REST API allows for that same user. See `08_Security_Audit.md`.

### 5.2 Graceful degradation
Two integrations are explicitly optional and fail soft, by design:
- **Groq (chat phrasing)** — absent/failed key → deterministic template replies.
- **Indic Parler-TTS (voice)** — not downloaded/loaded/OOM → browser
  `speechSynthesis`.

Neither failure ever surfaces as a user-visible error; both are logged
server-side for diagnosis.

### 5.3 State management
- **Durable state**: users, students, classes, attendance, escalations, chat
  sessions/messages — all in SQLite via SQLAlchemy.
- **Ephemeral, in-process state**: `ai._PENDING` (pending escalation
  confirmations) and `ai._LAST_SUBJECT` (last-discussed student per session) are
  plain in-memory dicts keyed by `session_id`. This is adequate for a
  single-process demo; a multi-worker/production deployment would need to move
  this into the `ChatSession` row or an external store (see
  `10_Deployment_Guide.md`).

### 5.4 Serving strategy
`app.py` mounts, in order: `/audio` (StaticFiles for generated clips) then `/`
(StaticFiles with `html=True`, serving `frontend/`) — the audio mount is placed
first so it's never shadowed by the frontend catch-all, and the frontend mount
falls back to `index.html` for client-side routes.

## 6. Deployment Topology (current / demo)

```
Single host
 └── uvicorn app:app (single process)
      ├── serves REST API, frontend, and audio
      ├── loads xyzai.db (SQLite file, created on first run)
      └── optionally loads Indic Parler-TTS weights into memory (CPU or CUDA)
```

Portals `01`–`04` can be hosted separately (e.g. static hosting or their own dev
server) as long as their `config.js: API_BASE` points at wherever `xyz-ai`'s
backend is reachable, and CORS on the backend is tightened from `allow_origins:
["*"]` accordingly. See `10_Deployment_Guide.md` for production considerations
(process manager, reverse proxy, CORS, secrets, and the SQLite→Postgres path).

## 7. Technology Stack Summary

| Layer | Technology |
|---|---|
| Backend framework | FastAPI 0.115 + Uvicorn 0.32 |
| ORM / DB | SQLAlchemy 2.0 + SQLite |
| Auth | PyJWT 2.9 (HS256) + bcrypt 4.2 |
| Chat phrasing (optional) | Groq Chat Completions API (`httpx`) |
| Voice synthesis | `ai4bharat/indic-parler-tts` via `transformers` + `torch` + `parler-tts` |
| Number-to-words | `num2words` (+ a hand-written Hindi cardinal table) |
| Frontend | Vanilla HTML/CSS/JS — no framework, no build step |
| Voice input (browser) | Web Speech API `SpeechRecognition` |
| Voice fallback (browser) | `window.speechSynthesis` |
| Lip-sync | Web Audio API amplitude analysis |