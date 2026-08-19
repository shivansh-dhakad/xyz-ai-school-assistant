# School ERP Ecosystem

```
School ERP Ecosystem
│
├── 01. Student Repository/student-portal    — student-only frontend
├── 02. Parent Repository/parent-portal      — parent-only frontend
├── 03. Management Repository/management-portal — principal-only frontend
├── 04. Staff Repository/staff-portal        — teacher-only frontend
└── 05. XYZ AI Repository/xyz-ai             — shared backend + AI + reference frontend
```

## How the 5 repos relate

**`05. XYZ AI Repository/xyz-ai`** is the one shared brain: a FastAPI backend
(auth, attendance, escalation, and the role/ownership authorization checks)
plus the conversational AI layer (`backend/ai.py`) and the local text-to-speech
integration (`backend/tts.py`). It also contains a full reference frontend
with all four roles for local development/demoing — run this one on its own
and everything works, exactly like the original single-app build.

**`01`–`04`** are the same frontend code, each trimmed to a single role via
`frontend/config.js`:

```js
const API_BASE = "/api";        // point at the xyz-ai backend's URL
const PORTAL_ROLE = "student";  // this portal only ever signs in this role
```

Each portal's login screen only shows its own demo account, and `app.js`
refuses to sign in (or stays signed in as) a user whose role doesn't match
`PORTAL_ROLE` — this is a UX/deployment separation only; the actual security
boundary is still the JWT role check enforced on every backend endpoint in
`xyz-ai`, unchanged.

To deploy the 4 portals as genuinely separate apps/repos (e.g. separate
domains, separate CI), point each one's `API_BASE` at wherever you host the
`xyz-ai` backend and set CORS accordingly (`app.py` currently allows `*` for
local development — tighten that before production use).

## Quick start (single-machine demo, all 4 roles)

```bash
cd "05. XYZ AI Repository/xyz-ai/backend"
cp .env.example .env              # fill in GROQ_API_KEY (optional)
pip install -r requirements.txt
python download_tts_model.py      # optional, one-time — see "Voice setup" below
./start.sh                        # start.bat on Windows
```

Open `http://localhost:8000` for the combined reference app, or open any of
`01`–`04`'s `frontend/index.html` directly (e.g. via `python -m http.server`
inside that folder) once its `config.js` points at the running backend.

A `xyzai.db` SQLite file and demo data are created automatically on first
run.

### Demo accounts

Password for all: `Password123!`

| Email | Role | Notes |
|---|---|---|
| `student@example.com` | student | linked to Rahul Sharma (10-A) |
| `parent@example.com` | parent | children: Rahul & Ananya Sharma (siblings) |
| `parent2@example.com` | parent | child: Vikram Rao (unrelated to the above, for testing access denial) |
| `teacher@example.com` | teacher | assigned to class 10-A |
| `teacher2@example.com` | teacher | assigned to class 10-B (unrelated to 10-A) |
| `principal@example.com` | principal | school-wide analytics |

Tap the demo chips on the login screen to sign in instantly.

### Groq setup (chat phrasing) — optional

Get a free API key at https://console.groq.com/keys, put it in
`backend/.env` as `GROQ_API_KEY=...`. Optionally override `GROQ_MODEL`
(defaults to `llama-3.3-70b-versatile`). Without a key the app still works,
just with deterministic template replies instead of naturally-phrased ones.

### Voice setup — one-time model download

Voice output runs fully offline via a locally-hosted model,
[`ai4bharat/indic-parler-tts`](https://huggingface.co/ai4bharat/indic-parler-tts)
(`backend/tts.py`) — no API key, no per-request cost. The backend itself
never downloads the weights: run the download once, separately, before your
first real demo:

```bash
cd "05. XYZ AI Repository/xyz-ai/backend"
python download_tts_model.py
```

This fetches and caches a few GB of weights (several minutes the first
time; re-running later is a no-op). `start.sh`/`start.bat` then load the
already-cached model into memory before opening for requests
(`TTS_BLOCK_ON_STARTUP=1`), so voice is either confirmed ready or its
failure is printed from your very first login. Skipping the download step
entirely is fine — the app still runs, spoken replies just use the
browser's built-in `speechSynthesis` instead of the local voice until you
run it. Check `GET /api/tts/status` any time to see whether the model is
`ready`, `loading_or_not_started`, or `failed` (with the real error in the
server logs — see `backend/tts.py`).

If you have an NVIDIA GPU, install a CUDA build of `torch`
(https://pytorch.org/get-started/locally/) before installing requirements,
for much faster generation — CPU-only works too, just slower. On Windows, a
`python.exe - Entry Point Not Found` / `torch_library_impl` error means
torch/torchaudio are mismatched; fix with:

```bat
pip uninstall -y torch torchaudio torchvision
pip cache purge
pip install -r requirements.txt --no-cache-dir
```

See `backend/tts.py`'s `SPEAKER_MAP` if you want to tune or add a named
voice for a specific language (the model's documented named speakers don't
cover every one of the 11 UI languages equally well yet — Urdu in
particular has no confirmed named voice, though it still synthesizes).

`backend/app.py` loads `.env` automatically on startup via
`python-dotenv` — no other config needed. `backend/.env` is your own file
(not committed); `.env.example` is the template.

## Project layout

```
05. XYZ AI Repository/xyz-ai/
  backend/
    app.py                 FastAPI app — every route
    models.py               SQLAlchemy models (integer PKs, SQLite)
    auth.py                 password hashing, JWT, role dependency (JWT_SECRET_KEY from .env)
    database.py              engine/session
    ai.py                    tool/authorization layer + optional Groq phrasing layer + avatar emotion inference
    tts.py                   local Indic Parler-TTS integration, with browser-fallback logic
    download_tts_model.py    one-time, stand-alone voice-model download (run before start.sh/start.bat)
    seed.py                  demo data (runs once, on first startup)
    start.sh / start.bat     one-command launcher (venv + deps + server; does not download the voice model)
    .env.example             copy to .env and fill in GROQ_API_KEY (voice needs no key)
  frontend/
    index.html    all screens (login, home, chat, profile) — sidebar + bottom-nav markup
    style.css     responsive styling (mobile bottom-nav <900px, sidebar layout >=900px)
    app.js        state, API calls, dashboards, voice, avatar (lip-sync, head rig, expressions), chat quick-reply chips
    i18n.js       language strings + voice locale codes
```

`01`–`04` each mirror `xyz-ai/frontend/` (same four files) plus a
role-scoped `config.js`.

## What this build covers, versus the original brief

- **Frontend**: plain HTML/CSS/JS (`index.html` + `style.css` + `app.js` +
  `i18n.js`) instead of React/Vite/Tailwind. No build step — open it in a
  browser (via the backend, see above) and it works.
- **Backend**: FastAPI, SQLAlchemy, JWT auth, role + resource authorization
  checks; SQLite instead of Postgres, one file per concern, no audit-log
  table.
- **Voice output**: natural speech via the locally-hosted
  `ai4bharat/indic-parler-tts` model (`backend/tts.py`,
  `POST /api/tts/speak`) — text already generated by the
  authorization-checked chat layer is synthesized on-device. The model is
  prompted with a short natural-language description (a named speaker + a
  persona-appropriate delivery style) to pick a consistent voice per
  language + role (`SPEAKER_MAP` in `backend/tts.py`). If the model isn't
  downloaded/loaded yet, is out of memory, or has no confirmed voice for
  the current language, `/api/tts/speak` returns `{"provider": "browser"}`
  and the frontend transparently falls back to the browser's built-in
  `speechSynthesis` — nothing breaks either way.
- **Voice input**: the browser's built-in `SpeechRecognition`. Works in
  Chrome/Edge; Safari/Firefox support is limited, so the mic button shows a
  friendly message there and typed chat always works everywhere.
- **Avatar**: a hand-illustrated SVG portrait — shaded skin/hair, ears,
  brows, eyes with iris/pupil/highlight, a nose, and a mouth — animated
  with real lip-sync, driven by live audio-amplitude analysis of the
  generated clip via the Web Audio API (Indic Parler-TTS gives no
  word-level timing to sync against directly), with a natural talking-flap
  fallback for browser `speechSynthesis` (which exposes no audio stream to
  analyse). The whole head is rigged as one group that blinks, breathes,
  and moves — idle sway, listening tilt, speaking nod, thinking
  tilt+pulse — plus eyebrow and mouth shapes that switch between
  happy/concerned/neutral expressions, driven by `emotion` in the chat
  reply, which `backend/ai.py` derives from the same structured facts used
  to phrase the reply (attendance % thresholds, present/absent marks, an
  escalation being raised), never from the phrased text itself, so it's
  correct in all 11 languages. **This is a real, working animated 2D
  avatar, not a photorealistic 3D/video one** — a D-ID/HeyGen/Simli-style
  photoreal video avatar would need a separate paid third-party avatar API
  and credentials this build doesn't have; the architecture here
  (text → `/api/tts/speak` → audio → avatar) is the same shape you'd wire
  such a service into later.
- **Real-time conversation**: the avatar face and all voice I/O (mic input
  + spoken replies) appear inside a full-screen "Live conversation" overlay
  (`#live-overlay`/`toggleConversationMode` in `app.js`), opened via a
  button next to the Chat title. The plain typed chatbot stays text-only —
  no face, no TTS — so voice is never something that happens by surprise
  while someone is just typing. Once open, the overlay loops
  listen → send → reply → speak → listen again automatically until closed.
- **AI**: replies are generated by a rule-based tool/authorization layer in
  `backend/ai.py` (attendance questions, "mark `<n>` present/absent/late"
  commands, escalation requests with a two-step confirm, school-wide
  analytics) — using the exact same authorization checks as the REST
  endpoints. If `GROQ_API_KEY` is set, those same computed facts are handed
  to Groq (`llama-3.3-70b-versatile` by default) which only *phrases* the
  reply naturally, in the user's chosen language and a role-specific
  persona voice — it never invents a number, performs an action, or
  decides who is authorized to see what. Without a key the app still
  works, just with deterministic template replies.
- **Escalation**: matches the spec's example flow exactly — "I'm not
  satisfied, I want to talk to the teacher" → the assistant asks "Would you
  like me to request a call now?" (with quick-reply Yes/No chips) → only on
  confirmation is an `Escalation` row actually written to the database and
  a reference code returned. The assistant never claims a call was
  arranged before that happens.
- **Multilingual**: English, Hindi, Tamil, Telugu, Marathi, Bengali,
  Gujarati, Punjabi, Kannada, Malayalam, Urdu. The UI is translatable
  (English/Hindi complete; other languages cover core labels with
  automatic English fallback for anything missing), and voice
  recognition/synthesis switch locale with the selector.
- **Responsive layout**: one codebase serves a mobile layout (bottom tab
  bar, single column) and a desktop layout (sidebar nav, centered content)
  via CSS media queries at 900px — no separate build or route.

## Notes on the authorization model

A parent can only see students linked to them via `parent_children`; a
teacher can only see/mark students in classes linked via `teacher_classes`
(and drill into one of their own students' history); a principal can view
any class or student school-wide; a student can only see their own record.
These checks live in `backend/app.py` (`_assert_parent_owns_child`,
`_assert_teacher_owns_class`) and are enforced on every relevant endpoint
*and* inside the chat assistant — role and identity always come from the
verified JWT, never from anything the client or the chat message claims.
This applies to `/api/tts/speak` too: it only ever speaks text the caller
already had a right to see. `backend/ai.py` additionally screens every
incoming chat message for prompt-injection/role-claim/secret-extraction
patterns before it reaches the database or the LLM (`SECURITY_PATTERNS`),
and the LLM itself is only ever handed already-computed, already-authorized
facts to phrase — it never decides who is allowed to see what.
