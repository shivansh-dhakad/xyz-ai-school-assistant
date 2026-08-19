# Testing Report
## School ERP Ecosystem — XYZ AI Module

## 1. Current Test Coverage Status

**There is no automated test suite in the repository at the time of writing**
(no `tests/` directory, no `pytest`/`unittest` files under `05. XYZ AI
Repository/xyz-ai`). This report documents the manual/inspection-based
verification performed against the requirements in `02_SRS.md`, and lays out a
concrete automated test plan as the recommended next step — this is recorded
here honestly rather than glossed over, per `08_Security_Audit.md` §6.

| Test type | Status |
|---|---|
| Unit tests (backend logic) | Not present — recommended plan in §4 |
| Integration tests (API endpoints) | Not present — recommended plan in §4 |
| Security/adversarial tests | Verified by code inspection only (see `08_Security_Audit.md` §4) |
| Frontend tests | Not present |
| Manual functional walkthrough | Performed against seeded demo data — see §3 |

## 2. Test Environment

- Seeded demo database (`seed.py`), password `Password123!` for all accounts.
- Backend run locally via `./start.sh` / `start.bat`.
- Manual verification performed through both the REST API directly and the
  reference frontend (`xyz-ai/frontend`).

## 3. Manual Functional Test Matrix

This matrix walks every functional requirement in `02_SRS.md` §3 against the
seeded demo accounts, and is intended to be run manually before each demo /
release, and to seed the automated suite in §4.

### 3.1 Authentication

| Case | Steps | Expected |
|---|---|---|
| Valid login | `POST /api/auth/login` with `student@example.com` / `Password123!` | `200`, token + role `student` returned |
| Invalid password | Same email, wrong password | `401` |
| Unknown email | Non-existent email | `401` (same generic message — no user enumeration) |
| Expired/garbage token | Call any protected endpoint with a malformed bearer token | `401` |
| No token | Call any protected endpoint with no `Authorization` header | `401` |

### 3.2 Student

| Case | Steps | Expected |
|---|---|---|
| Own profile | Login as `student@example.com`, `GET /api/student/me/profile` | Returns Rahul Sharma's profile |
| Own attendance | `GET /api/student/{own_id}/attendance` | Summary with correct present/absent/late/percentage |
| Cross-student attempt | `GET /api/student/{other_student_id}/attendance` (not linked to this account) | `403` |
| History period | `GET .../attendance/history?period=last_7_days` vs `last_30_days` | Record count differs appropriately; invalid `period` value → `422` |

### 3.3 Parent

| Case | Steps | Expected |
|---|---|---|
| List children | Login as `parent@example.com`, `GET /api/parent/children` | Returns 2 linked children (sibling pair) |
| Own child's attendance | `GET /api/parent/child/{linked_id}/attendance` | `200`, correct summary |
| Unlinked child (cross-account) | As `parent2@example.com`, request `student_id` linked to `parent@example.com` | `403` |
| Ambiguous chat query | Chat: "How much attendance does my child have?" as a 2-children parent, no name given | Assistant asks which child, lists both names |
| Named chat query | Chat: "How is Ananya doing?" | Resolves to the named child directly |
| Escalation offer→confirm | Chat: "I am not satisfied, I want to talk to my child's teacher" → "Yes" | First turn asks for confirmation with Yes/No chips and does **not** write a record; second turn writes an `Escalation` row and returns a reference code |
| Escalation decline | Same offer, then "No" | No `Escalation` row created; assistant acknowledges cancellation |
| Contact principal | `GET /api/principal/contact` as a parent | Returns the single seeded principal |

### 3.4 Teacher

| Case | Steps | Expected |
|---|---|---|
| List own classes | Login as `teacher@example.com`, `GET /api/teacher/classes` | Returns only `10-A` |
| Mark attendance (REST) | `POST /api/teacher/attendance` for a `10-A` student | `200`, `was_update: false` on first mark |
| Re-mark same day | Repeat with a different status for the same student/date | `200`, `was_update: true`, status updated not duplicated |
| Cross-class attempt (REST) | Attempt to mark a `10-B` student while logged in as `teacher@example.com` | `403` |
| Mark via chat, full command | Chat: "Mark Rahul absent today" | Attendance written for today, reply confirms name + status |
| Mark via chat, name only | Chat: "Mark Rahul" | Assistant asks Present/Absent/Late via chips, no write yet |
| Mark via chat, wrong teacher | As `teacher2@example.com` (10-B), "Mark Rahul absent" (Rahul is in 10-A) | Assistant reports it can't find that student in your assigned classes; no write |
| Same-day summary | Chat: any message not matching a `mark` pattern | Returns present-today count across owned classes |

### 3.5 Principal

| Case | Steps | Expected |
|---|---|---|
| School-wide analytics | `GET /api/principal/attendance/analytics` | Overall %, by_class, by_grade all populated and internally consistent (by_grade totals ≈ sum of relevant by_class entries) |
| Any-class drilldown | `GET /api/principal/class/{any_class_id}/attendance`, including a class the "current" teacher doesn't own | `200` — principal is unrestricted by class ownership |
| Any-student history | `GET /api/principal/student/{any_id}/attendance/history` | `200` for any student in the school |
| Chat analytics | Chat: "What is the overall attendance?" | Rolling 30-day percentage + total student count |

### 3.6 Voice / TTS

| Case | Steps | Expected |
|---|---|---|
| Status before model load | `GET /api/tts/status` immediately after a fresh start (no prior `download_tts_model.py` run) | `state: "failed"` or `loading_or_not_started`, never a crash |
| Status after successful load | After `download_tts_model.py` + `TTS_BLOCK_ON_STARTUP=1` start | `state: "ready"`, `device` reflects CPU/CUDA correctly |
| Speak with model ready | `POST /api/tts/speak` with sample text | `provider: "indic_parler"`, `audio_url` resolves to a playable `.wav` under `/audio/` |
| Speak with model unavailable | Same call, weights not downloaded | `provider: "browser"` — never an HTTP error |
| Number normalization | Speak text containing "85% attendance", "class 10", "₹500", "9:30 AM" | Spoken output reads these as words, not raw digits (verified by listening / inspecting `_normalize_for_speech` output) |
| Language coverage | Speak the same text across all 11 language codes | Every language produces either a real voice or a clean browser-fallback signal — never a 500 error |

### 3.7 Multilingual chat

| Case | Steps | Expected |
|---|---|---|
| Language switch mid-session | Start session in English, send a message, then send the next message with `language: "hi"` | Reply is in Hindi despite prior history being in English (tests the repeated language-reminder system message) |
| Groq unset | Unset `GROQ_API_KEY`, ask any question | Deterministic template reply returned, no error, `emotion` still computed correctly |
| Groq misconfigured | Set an invalid `GROQ_API_KEY` or a decommissioned `GROQ_MODEL` | Falls back to template reply; error is visible in server logs, not to the user |

### 3.8 Security (see `08_Security_Audit.md` §4 for the full adversarial matrix A1–A11)

All eleven scenarios there (prompt injection, cross-account access via REST and
chat, fake role claims, credential-extraction attempts, escalation-confirmation
tampering, and auth-token tampering) were reviewed and are expected to pass
based on code inspection; they are the highest-priority candidates for the
automated suite in §4.

## 4. Recommended Automated Test Plan

A `tests/` package using `pytest` + FastAPI's `TestClient` is the natural next
step, layered as:

1. **Unit tests** — pure functions with no DB/HTTP: `_split_grade_section`,
   `_attendance_summary_dict`/`_attendance_history` math, `tts._expand_numbers`
   / `_hi_cardinal` / `_normalize_for_speech`, `ai._is_security_probe` against
   both true-positive and true-negative message samples, `ai._infer_emotion`
   against each facts shape in `07_AI_Architecture.md` §7.
2. **Integration tests (REST)** — spin up the app against a temporary SQLite
   file (or `sqlite:///:memory:` with `seed.run()` executed against it),
   exercising the full matrix in §3.1–3.5 including every documented `403`/
   `404`/`422` path.
3. **Integration tests (chat)** — drive `ai.generate_reply()` directly (no
   network) with `GROQ_API_KEY` unset, covering §3.3–3.5's chat cases plus the
   full adversarial matrix A1–A11 from `08_Security_Audit.md`.
4. **Contract test for the Groq fallback path** — mock `httpx.post` to raise/
   return non-2xx and assert the fallback text is used and nothing raises.
5. **TTS tests** — mock `torch`/`parler_tts` imports to test `synthesize()`'s
   fallback-to-`None` behavior without requiring the actual multi-GB model in
   CI; keep `_expand_numbers` fully real-tested since it needs no model.
6. **Smoke test for `start.sh`/`start.bat`** — a CI job that runs the script
   end-to-end against a disposable environment and asserts `GET /api/tts/status`
   and `GET /` both respond, to catch environment/dependency regressions.

## 5. Regression Checklist (pre-demo / pre-release)

- [ ] All seeded demo accounts can log in.
- [ ] Each of the four required brief use cases (student/parent/teacher/
      principal) works end-to-end via chat, not just REST.
- [ ] Escalation flow matches the brief's exact example conversation.
- [ ] At least 3 of the 11 languages spot-checked for both chat and voice.
- [ ] `GROQ_API_KEY` unset → app still fully functional (template mode).
- [ ] Voice model not downloaded → app still fully functional (browser voice).
- [ ] Adversarial matrix A1–A11 (`08_Security_Audit.md`) spot-checked.
- [ ] Mobile (<900px) and desktop (≥900px) layouts both usable.