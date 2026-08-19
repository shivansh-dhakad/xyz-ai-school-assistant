# Software Requirements Specification (SRS)
## School ERP Ecosystem — XYZ AI Module

| | |
|---|---|
| **Document** | Software Requirements Specification |
| **Scope** | `05. XYZ AI Repository/xyz-ai` (shared backend + AI) and portals `01`–`04` |
| **Conforms loosely to** | IEEE 830 structure |

---

## 1. Introduction

### 1.1 Purpose
This SRS specifies the functional and non-functional requirements of the School
ERP Ecosystem, with emphasis on the XYZ AI conversational module, at a level
sufficient to implement, test, and review the system.

### 1.2 Scope
The system provides:
- Role-based authentication (student, parent, teacher, principal).
- Attendance recording (teacher), viewing (all roles, scoped by ownership), and
  school-wide analytics (principal).
- A conversational AI assistant (chat + voice + avatar) that performs the above
  through natural language, plus escalation to a human teacher/management contact.
- Four role-scoped frontend portals sharing one backend.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| **Role** | One of `student`, `parent`, `teacher`, `principal` (`UserRole` enum) |
| **Ownership check** | Authorization rule verifying a user may access a specific student/class (`_assert_parent_owns_child`, `_assert_teacher_owns_class`) |
| **Persona** | The AI's tone/voice profile per role (see `ai.py: PERSONAS`) |
| **Escalation** | A recorded request to connect a parent with a teacher or management |
| **Facts** | The structured, pre-computed data the AI is allowed to state; never invented by the LLM |
| **Security probe** | A chat message matching a known prompt-injection/role-claim/secret-extraction pattern |

### 1.4 References
- `01_PRD.md`, `03_System_Architecture.md`, `07_AI_Architecture.md`,
  `08_Security_Audit.md`
- Source: `05. XYZ AI Repository/xyz-ai/backend/{app.py, ai.py, auth.py, models.py,
  tts.py, database.py, seed.py}`

## 2. Overall Description

### 2.1 Product Perspective
XYZ AI is a self-contained FastAPI service with a SQLite database, serving both a
JSON REST API and a static frontend (mounted at `/`). Four additional frontend-only
repositories reuse the same static assets, each scoped to a single role via
`config.js`, and point at the same backend `API_BASE`.

### 2.2 Product Functions (summary)
1. Authenticate users and issue role-carrying JWTs.
2. Serve role-scoped attendance data and analytics.
3. Accept teacher attendance-marking actions.
4. Run a conversational AI layer that answers questions and triggers the same
   actions/queries as the REST endpoints, in 11 languages.
5. Record escalation requests with two-step (offer → confirm) UX.
6. Synthesize spoken replies via a local TTS model, with automatic browser
   fallback.

### 2.3 User Classes
See PRD §5. All four classes share the same login screen; the account's `role`
column (never anything client-supplied) determines what is visible.

### 2.4 Operating Environment
- **Backend**: Python 3.10+, FastAPI/Uvicorn, SQLite file DB, optional CUDA GPU
  for TTS acceleration.
- **Frontend**: Any modern browser; voice input relies on the (Chromium-based)
  `SpeechRecognition` Web API — degrades gracefully elsewhere.
- **External services**: Groq API (optional, chat phrasing only); Hugging Face
  Hub (one-time TTS model download only, not at runtime).

### 2.5 Design & Implementation Constraints
- No client-supplied field is ever trusted for authorization — role and identity
  come only from the verified JWT (`auth.get_current_user`).
- The LLM (Groq) may only *rephrase* already-computed facts; it cannot originate
  a fact or trigger a database write.
- SQLite with `check_same_thread=False` — acceptable for a single-process demo,
  not for concurrent multi-worker production deployment without migration.

## 3. Functional Requirements

Requirements are grouped by capability and tagged `FR-<area>-<n>`. Each maps to
concrete code where noted.

### 3.1 Authentication (`FR-AUTH`)
- **FR-AUTH-1**: The system shall authenticate a user via email + password
  against a bcrypt hash and issue a signed JWT (`POST /api/auth/login`).
- **FR-AUTH-2**: The JWT shall encode `sub` (user id) and `role`, expire after 12
  hours (`TOKEN_EXPIRE_MINUTES = 720`), and be signed with `JWT_SECRET_KEY`
  (`auth.py`).
- **FR-AUTH-3**: Every protected endpoint shall resolve the caller's role by
  re-querying the database for the JWT's `sub`, never by trusting the JWT's `role`
  claim alone or any request body/header field (`get_current_user`).
- **FR-AUTH-4**: `GET /api/auth/me` shall return the caller's own identity.

### 3.2 Student capabilities (`FR-STU`)
- **FR-STU-1**: A student shall view their own profile (`GET
  /api/student/me/profile`).
- **FR-STU-2**: A student shall view their own attendance summary and history,
  and shall be rejected (403) if `student_id` in the path does not match their own
  linked student record.

### 3.3 Parent capabilities (`FR-PAR`)
- **FR-PAR-1**: A parent shall list children linked to their account (`GET
  /api/parent/children`).
- **FR-PAR-2**: A parent shall view attendance summary/history only for a student
  linked via `ParentChild`; any other `student_id` shall be rejected (403).
- **FR-PAR-3**: A parent shall be able to look up the school principal's contact
  (`GET /api/principal/contact`).
- **FR-PAR-4**: A parent shall be able to submit an escalation to a teacher or to
  management, which is only ever recorded after explicit confirmation.

### 3.4 Teacher capabilities (`FR-TCH`)
- **FR-TCH-1**: A teacher shall list only the classes they are assigned to (`GET
  /api/teacher/classes`), derived from `TeacherClass` rows.
- **FR-TCH-2**: A teacher shall view today's attendance status for every student
  in one of their own classes; access to any other class shall be rejected (403).
- **FR-TCH-3**: A teacher shall mark (create or update) a student's attendance
  status for a given date as `present`, `absent`, or `late`, only for a student
  belonging to one of their own classes (`POST /api/teacher/attendance`).
- **FR-TCH-4**: A teacher shall view a specific student's attendance
  summary/history, gated by the same class-ownership check.

### 3.5 Principal capabilities (`FR-PRN`)
- **FR-PRN-1**: A principal shall retrieve school-wide attendance analytics —
  overall percentage, per-class, and per-grade breakdowns (`GET
  /api/principal/attendance/analytics`).
- **FR-PRN-2**: A principal shall drill into any single class's today-status
  roster, unrestricted by class ownership (`GET
  /api/principal/class/{class_id}/attendance`).
- **FR-PRN-3**: A principal shall drill into any single student's attendance
  history, unrestricted by class (`GET
  /api/principal/student/{student_id}/attendance/history`).

### 3.6 Conversational AI (`FR-AI`)
- **FR-AI-1**: The system shall let any authenticated user start a chat session
  (`POST /api/chat/sessions/start`), receiving a role- and language-appropriate
  greeting.
- **FR-AI-2**: The system shall accept a chat message (`POST
  /api/chat/sessions/{id}/messages`), persist it, generate a reply, persist the
  reply, and return `{reply, actions, emotion}`.
- **FR-AI-3**: Every fact stated in a reply shall be pre-computed by the same
  role/ownership-checked Python logic used by the REST endpoints, never invented
  by the LLM (see `07_AI_Architecture.md`).
- **FR-AI-4**: If configured with `GROQ_API_KEY`, the system shall have Groq
  rephrase the computed facts naturally, in the user's selected language and
  role-persona; if not configured, or if the Groq call fails for any reason, the
  system shall fall back to a deterministic template reply — the user shall never
  see an error in place of a reply.
- **FR-AI-5**: The system shall detect prompt-injection / role-claim /
  secret-extraction attempts (`SECURITY_PATTERNS`) before any database or LLM
  call and respond with a fixed refusal in the user's language.
- **FR-AI-6**: For a student: the assistant shall report the caller's own
  attendance facts.
- **FR-AI-7**: For a parent: the assistant shall (a) disambiguate which child if
  more than one is linked and none is named in the message, (b) report attendance
  facts for the resolved child, and (c) offer a "call the teacher" quick-reply
  chip alongside the answer.
- **FR-AI-8**: For a parent expressing dissatisfaction or requesting escalation,
  the assistant shall ask for explicit yes/no confirmation before creating an
  `Escalation` record, and shall only report success after the record exists,
  returning a reference code.
- **FR-AI-9**: For a teacher: the assistant shall parse `"mark <name>
  present|absent|late"` and, if the named student is in one of the teacher's own
  classes, create or update that day's attendance record and confirm by name and
  status; if the student cannot be resolved to one of the teacher's classes, the
  assistant shall say so rather than guessing.
- **FR-AI-10**: For a teacher naming a student without a status, the assistant
  shall ask which status to apply, offering Present/Absent/Late quick-reply chips.
- **FR-AI-11**: For a principal: the assistant shall report rolling 30-day
  school-wide attendance percentage and total student count.
- **FR-AI-12**: The assistant shall derive an `emotion` value
  (`happy`/`concerned`/`neutral`) from the same structured facts used for
  phrasing — never from the phrased text — so the avatar's expression is correct
  regardless of reply language.
- **FR-AI-13**: The system shall retrieve full chat history for a session (`GET
  /api/chat/sessions/{id}/history`), scoped to the requesting user's own sessions.

### 3.7 Voice / Avatar (`FR-TTS`)
- **FR-TTS-1**: The system shall synthesize speech for arbitrary already-generated
  text via a locally-hosted Indic Parler-TTS model, selecting a persona- and
  language-appropriate voice description (`POST /api/tts/speak`).
- **FR-TTS-2**: If the local model is unavailable (not downloaded, failed to
  load, out of memory, unsupported language/voice), the endpoint shall return
  `{"provider": "browser"}` rather than an error, so the frontend can fall back to
  the Web Speech API.
- **FR-TTS-3**: The system shall expose current TTS readiness (`ready`,
  `loading_or_not_started`, `failed`) via `GET /api/tts/status`.
- **FR-TTS-4**: Numbers, percentages, currency, ordinals, and identifiers embedded
  in reply text shall be expanded to words before synthesis, using
  language-appropriate rules (`tts._normalize_for_speech` /
  `_expand_numbers`), so spoken output does not mumble or skip digits.
- **FR-TTS-5**: The frontend avatar shall lip-sync to generated audio via live
  amplitude analysis (no word-timing is available from the model) and shall use a
  generic talk-flap animation when the browser fallback voice is used instead
  (which exposes no analyzable audio stream).

### 3.8 Internationalization (`FR-I18N`)
- **FR-I18N-1**: The system shall support UI text, chat replies, and voice output
  in English, Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, Punjabi, Kannada,
  Malayalam, and Urdu.
- **FR-I18N-2**: A user shall be able to change language mid-conversation; the
  very next reply shall be in the newly selected language even though prior
  chat history remains in the old language (enforced via a restated system
  instruction placed immediately before the current turn in the Groq prompt).

## 4. Non-Functional Requirements

| ID | Requirement |
|---|---|
| **NFR-1 (Security)** | No endpoint shall trust client-supplied role or ownership claims; all authorization is server-side against the database, on every call. |
| **NFR-2 (Availability of core function)** | Loss of the optional Groq or TTS integrations shall never take down chat or the REST API — both degrade gracefully (template replies; browser voice). |
| **NFR-3 (Usability)** | The same codebase shall serve a usable mobile (bottom nav, single column) and desktop (sidebar) layout via CSS breakpoints at 900px, with no separate build. |
| **NFR-4 (Portability)** | The system shall start with a single command (`start.sh`/`start.bat`) with no manual DB provisioning — tables and demo data are created automatically on first run. |
| **NFR-5 (Performance)** | TTS synthesis latency is acceptable for a live demo on GPU; CPU-only synthesis may take seconds to tens of seconds per reply — the app must remain responsive (non-blocking) while this happens. |
| **NFR-6 (Data integrity)** | Marking attendance twice for the same student/date shall update the existing record, not create a duplicate. |
| **NFR-7 (Auditability)** | Every escalation shall be persisted with a unique reference code, requester, target, and reason. |
| **NFR-8 (Privacy)** | JWT secret and Groq API key shall be sourced from environment/`.env`, never hard-coded in source (defaults are explicitly marked dev-only). |

## 5. External Interface Requirements

See `06_API_Documentation.md` for the full REST contract. Summary of surfaces:
- REST JSON API under `/api/*` (Bearer JWT auth on all but `/api/auth/login`).
- Static frontend served from `/`.
- Generated audio clips served from `/audio/*`.

## 6. Data Requirements

See `05_Database_Design.md` for the full schema. Core entities: `User`,
`Student`, `Parent`, `ParentChild`, `Teacher`, `TeacherClass`, `Principal`,
`SchoolClass`, `Attendance`, `Escalation`, `ChatSession`, `ChatMessage`.

## 7. Traceability (brief-to-implementation)

| Original brief requirement | Implemented as |
|---|---|
| Student views own attendance | `FR-STU-2`, `FR-AI-6` |
| Parent views child's attendance | `FR-PAR-2`, `FR-AI-7` |
| Teacher marks attendance | `FR-TCH-3`, `FR-AI-9` |
| Principal school attendance analytics | `FR-PRN-1`, `FR-AI-11` |
| Chat-based AI | `FR-AI-1..13` |
| AI Avatar + Voice | `FR-TTS-1..5` |
| Escalation to teacher/management | `FR-PAR-4`, `FR-AI-8` |
| Language support (11 languages) | `FR-I18N-1..2` |
| Security & safety | `FR-AI-5`, NFR-1, `08_Security_Audit.md` |