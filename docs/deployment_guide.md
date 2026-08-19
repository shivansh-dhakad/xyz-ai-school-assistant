# Deployment Guide
## School ERP Ecosystem — XYZ AI Module

## 1. Local / Demo Deployment (single machine, all 4 roles)

This is the currently supported, documented path — everything below matches
`README.md` and the actual `start.sh`/`start.bat` scripts.

### 1.1 Prerequisites
- Python 3.10+
- ~5 GB free disk for the local voice model (optional but recommended for a
  live demo)
- (Optional) an NVIDIA GPU + CUDA build of `torch` for fast voice synthesis
- (Optional) a free Groq API key from https://console.groq.com/keys for
  naturally-phrased, multilingual chat replies

### 1.2 Steps
```bash
cd "05. XYZ AI Repository/xyz-ai/backend"
cp .env.example .env              # fill in GROQ_API_KEY (optional)
pip install -r requirements.txt
python download_tts_model.py      # optional, one-time — see §2
./start.sh                        # start.bat on Windows
```
Open `http://localhost:8000` for the combined reference app (all 4 roles), or
serve any of `01`–`04`'s `frontend/index.html` (e.g. `python -m http.server`
inside that folder) once its `config.js` points at the running backend.

`xyzai.db` (SQLite) and demo data are created automatically on first run — no
manual database setup.

### 1.3 What `start.sh` / `start.bat` actually do
1. Create/reuse a Python virtual environment (`.venv`).
2. `pip install -r requirements.txt` (includes `torch`, `transformers`,
   `parler-tts` for local voice — safe to re-run, skips already-installed
   packages).
3. Copy `.env.example` → `.env` if `.env` doesn't exist yet.
4. Set `TTS_BLOCK_ON_STARTUP=1` and launch
   `uvicorn app:app --host 0.0.0.0 --port 8000` — this makes the server finish
   loading the (already-downloaded) voice model into memory before accepting
   requests, so voice is confirmed ready (or its failure is printed) from the
   very first reply, rather than racing the first chat turn against a
   background load.

### 1.4 Demo accounts
Password for all: `Password123!`

| Email | Role | Notes |
|---|---|---|
| `student@example.com` | student | linked to Rahul Sharma (10-A) |
| `parent@example.com` | parent | children: Rahul & Ananya Sharma (siblings) |
| `parent2@example.com` | parent | child: Vikram Rao (unrelated — for testing access denial) |
| `teacher@example.com` | teacher | assigned to class 10-A |
| `teacher2@example.com` | teacher | assigned to class 10-B (unrelated to 10-A) |
| `principal@example.com` | principal | school-wide analytics |

## 2. Voice Setup (One-Time Model Download)

Voice runs fully offline via `ai4bharat/indic-parler-tts` — no API key, no
per-request cost. The backend itself never downloads weights at request or
startup time; they must be fetched once, separately:

```bash
cd "05. XYZ AI Repository/xyz-ai/backend"
python download_tts_model.py
```

This fetches and caches a few GB of weights (several minutes the first time;
re-running later is a no-op). Skipping this step entirely is fine — the app
still runs, spoken replies just use the browser's built-in `speechSynthesis`
until it's run. Check `GET /api/tts/status` any time to see whether the model
is `ready`, `loading_or_not_started`, or `failed` (check server logs for the
real error in the `failed` case).

**GPU acceleration**: install a CUDA build of `torch`
(https://pytorch.org/get-started/locally/) *before* installing
`requirements.txt` for much faster generation. CPU-only works too, just
slower — budget seconds to tens of seconds per reply on CPU.

**Windows torch/torchaudio mismatch** (`python.exe - Entry Point Not Found` /
`torch_library_impl`):
```bat
pip uninstall -y torch torchaudio torchvision
pip cache purge
pip install -r requirements.txt --no-cache-dir
```

## 3. Groq Setup (Optional — Natural Chat Phrasing)

1. Get a free key at https://console.groq.com/keys.
2. Put it in `backend/.env` as `GROQ_API_KEY=...`.
3. Optionally override `GROQ_MODEL` (default `openai/gpt-oss-120b`; check
   https://console.groq.com/docs/models for the current list — model IDs are
   periodically deprecated by Groq, and an outdated ID silently falls back to
   template replies with the real error only visible in server logs).

Without a key the app still works fully, just with deterministic template
replies instead of naturally-phrased, fully multilingual ones.

## 4. Environment Variables Reference (`.env`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GROQ_API_KEY` | No | *(unset)* | Enables natural, multilingual chat phrasing |
| `GROQ_MODEL` | No | `openai/gpt-oss-120b` | Groq chat-completion model id |
| `JWT_SECRET_KEY` | **Yes, for anything beyond local demo** | dev default (insecure) | Signs login JWTs — generate with `openssl rand -hex 32` |
| `INDIC_TTS_MODEL` | No | `ai4bharat/indic-parler-tts` | Override the voice checkpoint |
| `TTS_BLOCK_ON_STARTUP` | No (set by `start.sh`/`.bat`) | unset | `1` = block startup until voice model loads |

## 5. Deploying the 4 Portals Separately

To run `01`–`04` as genuinely separate apps/repos (separate domains, separate
CI/CD), for each portal:
1. Point `frontend/config.js`'s `API_BASE` at wherever the `xyz-ai` backend is
   hosted.
2. Tighten CORS in `backend/app.py` (currently `allow_origins=["*"]`, a
   local-dev default) to the specific portal origins.
3. Deploy each `frontend/` directory as static files (e.g. behind Nginx,
   Netlify, S3+CloudFront, or any static host) — no build step is required.

The security boundary does **not** move with this split — it remains the
backend's JWT + role/ownership checks, unchanged; the role-scoped frontend is
a UX/deployment convenience only.

## 6. Path to a Production Deployment

The current build is intentionally demo-scoped. Before any production/public
deployment, address the following (cross-referenced to `08_Security_Audit.md`
§6 and `05_Database_Design.md` §6):

| Area | Change needed |
|---|---|
| **Database** | Migrate SQLite → PostgreSQL; the SQLAlchemy model layer is portable — only `database.py`'s engine URL and SQLite-specific `connect_args` need to change. Introduce Alembic for schema migrations. |
| **Process model** | Run under a process manager (systemd, Docker + orchestrator) with multiple Uvicorn workers behind a reverse proxy (Nginx/Caddy) for TLS termination and static-file offload. |
| **Session state** | Move `ai.py`'s in-memory `_PENDING`/`_LAST_SUBJECT` dicts into persisted `ChatSession` state (or Redis) — required once running more than one worker process, since in-memory dicts aren't shared across processes. |
| **CORS** | Restrict `allow_origins` to the actual deployed portal origins. |
| **Secrets** | Set a strong, unique `JWT_SECRET_KEY`; fail startup rather than silently using the dev default if unset in a "production" mode flag. |
| **Rate limiting** | Add rate limiting to `/api/auth/login` and `/api/chat/*` (e.g. `slowapi`) to protect against brute force and cost/DoS against Groq/TTS. |
| **Observability** | Centralize logs (the app already logs Groq/TTS failures via `logging`); add structured logging + a health-check endpoint for orchestration. |
| **TTS hosting** | Voice synthesis is CPU/GPU-bound and stateful (a loaded model in process memory) — for horizontal scaling, host TTS as its own service behind the `/api/tts/speak` contract rather than co-locating it with the API workers. |
| **Static audio storage** | `audio_cache/` is local disk with a 30-minute auto-prune; for multi-instance deployment, move to shared/object storage or make TTS responses stream directly without persisting to disk. |
| **HTTPS** | Terminate TLS at the reverse proxy; the app itself serves plain HTTP. |

## 7. Operational Notes

- **First-run behavior**: `init_db()` + `seed.run()` are idempotent — safe to
  restart the app any number of times; seeding only happens if the `users`
  table is empty.
- **Restarting**: `start.sh`/`start.bat` are safe to re-run any time (e.g. to
  restart the app) — `pip` skips already-satisfied dependencies, so every run
  after the first starts in a couple of seconds.
- **Checking voice readiness without a demo audience present**: `GET
  /api/tts/status` at any time.
- **Diagnosing "replies stay in English/template despite a key being set"**:
  check server logs for a Groq HTTP error (401 = bad/expired key, 400/404 = an
  unknown/decommissioned `GROQ_MODEL` id, 429 = rate/quota limit) — all are
  logged with the response body by `ai._groq_phrase`.