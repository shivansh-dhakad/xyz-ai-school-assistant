# Product Requirements Document (PRD)
## School ERP Ecosystem — XYZ AI Module

| | |
|---|---|
| **Document** | Product Requirements Document |
| **Product** | School ERP Ecosystem (Student, Parent, Management, Staff portals + XYZ AI) |
| **Module in focus** | 05. XYZ AI Repository — `xyz-ai` |
| **Status** | Living document — reflects the current implementation |
| **Owner** | Shivansh Dhakad |

---

## 1. Purpose

School ERP Ecosystem is a five-repository system that gives every stakeholder in a
school — students, parents, teachers, and the principal — their own portal, backed
by one shared FastAPI service. The centerpiece is **XYZ AI**, a human-like AI school
assistant that lets any of these four roles ask natural-language questions about
attendance, get answers through chat/voice/an animated avatar, and escalate to a
real teacher or the school office when the AI isn't enough.

This document defines *what* the product does and *why*, at a level a stakeholder
(not just an engineer) can review. See `02_SRS.md` for detailed functional/
non-functional requirements and `07_AI_Architecture.md` for how the assistant is
built.

## 2. Problem Statement

Parents and students routinely need simple, repetitive information (attendance
percentage, whether a child was marked present today) that currently requires
either a phone call to the school office or navigating a multi-screen ERP UI.
Teachers spend time on the mechanical act of recording attendance, and principals
lack a fast way to see attendance health across the whole school. A conversational
assistant that already knows *who is asking* and *what they're allowed to see* can
answer most of these questions instantly, in the user's own language, and hand off
to a human the moment the answer genuinely requires one.

## 3. Goals

1. Let each of the four roles get role-appropriate attendance information and
   actions through natural conversation (chat, voice, or an avatar), instead of
   only through static dashboard screens.
2. Never let the AI layer become a security hole: every fact the assistant states
   and every action it performs must pass the same authorization checks as the
   REST API — no exceptions for "the LLM said so."
3. Support India's linguistic diversity: 11 languages for both text and spoken
   replies.
4. Provide a clean escalation path from AI to a real teacher/management contact
   that never falsely claims a human has been reached.
5. Ship a working, demoable system: seeded demo data, one-command startup, and a
   reference frontend usable without any paid API keys.

## 4. Non-Goals

- Full school ERP functionality (fees, timetables, exams, library, transport,
  etc.) — the current scope is intentionally narrowed to **attendance** as the
  proving use case for the AI assistant pattern.
- A photorealistic 3D/video avatar (e.g. D-ID/HeyGen/Simli-style). The avatar is a
  real, working 2D animated SVG portrait with lip-sync and expressions, not a
  video-generation product — see `07_AI_Architecture.md`.
- Production-grade infrastructure (managed Postgres, message queues, horizontal
  scaling, CI/CD pipelines). The current build is SQLite-backed and single-process,
  intended for local/demo deployment; see `10_Deployment_Guide.md` for what would
  change for production.
- Automated test suite. See `09_Testing_Report.md` for current coverage and gaps.

## 5. Target Users / Personas

| Role | Who they are | Primary need |
|---|---|---|
| **Student** | Enrolled student, own login | "What is my attendance?" |
| **Parent** | Guardian of one or more students | "How much attendance does my child have?" and escalating concerns |
| **Teacher** | Assigned to one or more classes | Marking daily attendance quickly; viewing their class(es) |
| **Principal** | School management | School-wide and class/grade-wise attendance analytics |

Each persona also gets a distinct AI voice/tone (see §7 and `07_AI_Architecture.md`
§ Personas): Student = friendly Academic Assistant, Parent = caring Parent Support
Assistant, Teacher = professional Teaching Assistant, Principal = professional
Management Assistant.

## 6. Repository / Product Structure

```
School ERP Ecosystem
├── 01. Student Repository/student-portal      — student-only frontend
├── 02. Parent Repository/parent-portal        — parent-only frontend
├── 03. Management Repository/management-portal — principal-only frontend
├── 04. Staff Repository/staff-portal          — teacher-only frontend
└── 05. XYZ AI Repository/xyz-ai               — shared FastAPI backend + AI +
                                                   reference frontend (all 4 roles)
```

`xyz-ai` is the single shared brain (auth, attendance, escalation, authorization,
the conversational layer, and local text-to-speech). Repositories `01`–`04` are the
same portal frontend code, each restricted to a single role via `frontend/config.js`
(`PORTAL_ROLE`), for teams that want to deploy/ship each role's portal as a
separate app. The actual security boundary is the backend's JWT + role checks —
the role-scoped frontend is a UX/deployment convenience, not the authorization
mechanism.

## 7. Key Features

### 7.1 Chat-based AI
Any signed-in user can open a chat with XYZ AI. It understands natural-language
questions, keeps conversation history per session, asks clarifying questions when
information is missing (e.g. which child, for a parent with more than one), and
answers using live data from the database — never invented numbers.

### 7.2 AI Avatar + Voice
A "Live conversation" overlay presents an animated 2D avatar (idle sway, blinking,
listening/speaking/thinking states, expression changes) with real lip-sync driven
by the generated audio, browser speech-to-text for voice input, and locally-hosted
Indic Parler-TTS for natural spoken replies in the persona's voice — with automatic
fallback to the browser's built-in speech synthesis if the local voice model isn't
available.

### 7.3 Role-specific behavior
- **Student** — views own attendance.
- **Parent** — views any linked child's attendance (asks who, if ambiguous),
  requests an escalation call.
- **Teacher** — marks a named student present/absent/late by chat command; views
  today's status across their assigned class(es).
- **Principal** — gets school-wide attendance analytics, with class/grade
  breakdowns.

### 7.4 Escalation to a real teacher / school management
If a parent isn't satisfied, XYZ AI offers to connect them with the teacher or
school management, asks for explicit confirmation, and only then records the
escalation and returns a reference code — it never claims a call has happened
before that record exists.

### 7.5 Multilingual support
English, Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, Punjabi, Kannada,
Malayalam, and Urdu — for UI text, chat replies, and spoken voice output.

### 7.6 Security & role-based access
Every fact the AI can state and every action it can perform is gated by the same
ownership checks used by the REST API (a parent only ever sees their own linked
children; a teacher only their own assigned classes). Prompt-injection, fake
role-claims, and secret-extraction attempts are pattern-matched and refused before
they reach the database or the LLM. See `08_Security_Audit.md`.

## 8. Success Metrics (demo/portfolio context)

Since this is a self-initiated/academic-style build rather than a live production
product, success is measured qualitatively against the original brief:

- All four "Required Use Cases" from the brief work end-to-end (student views own
  attendance, parent views child's attendance, teacher marks attendance, principal
  gets analytics).
- The escalation flow matches the brief's example conversation exactly.
- The system runs from a single `./start.sh` / `start.bat` with no manual database
  setup.
- The AI never leaks cross-account data or invents a completed action, even under
  adversarial prompts (see `08_Security_Audit.md`).
- All 11 required languages are selectable and produce a coherent reply (template
  fallback where Groq/native voice coverage is incomplete).

## 9. Assumptions & Constraints

- Single-school deployment (no multi-tenant school selection).
- Attendance is the only domain object modeled; there is no timetable, subject, or
  exam data.
- Groq's LLM phrasing layer is optional — the app is fully functional without a
  `GROQ_API_KEY`, using deterministic template replies instead.
- Voice output requires a one-time local model download (`download_tts_model.py`);
  without it, voice gracefully falls back to the browser's built-in
  `speechSynthesis`.
- SQLite is used for simplicity; see `05_Database_Design.md` and
  `10_Deployment_Guide.md` for the production migration path.

## 10. Open Items / Future Scope

- Expand beyond attendance into other ERP domains (fees, timetable, exams, library).
- Replace the in-memory per-session escalation/context state (`_PENDING`,
  `_LAST_SUBJECT` in `ai.py`) with persisted session state for multi-process
  deployments.
- Add an automated test suite (unit + integration) — see `09_Testing_Report.md`.
- Add an audit-log table for escalations and attendance edits.
- Optional: a photoreal video avatar via a third-party avatar API, using the
  existing `text → /api/tts/speak → audio` pipeline as the integration point.