# API Documentation
## School ERP Ecosystem — XYZ AI Backend

- **Base URL (local)**: `http://localhost:8000`
- **Format**: JSON request/response bodies
- **Auth**: Bearer JWT (`Authorization: Bearer <token>`) on every endpoint except
  `POST /api/auth/login`
- **Source**: `05. XYZ AI Repository/xyz-ai/backend/app.py`

## 1. Authentication

### `POST /api/auth/login`
Authenticate and receive a JWT.

**Request body**
```json
{ "email": "parent@example.com", "password": "Password123!" }
```

**Response `200`**
```json
{
  "access_token": "<jwt>",
  "user_id": 12,
  "role": "parent",
  "full_name": "Suresh Sharma"
}
```

**Errors**: `401` invalid email or password.

Token expires after 12 hours (`TOKEN_EXPIRE_MINUTES = 720`), signed HS256 with
`JWT_SECRET_KEY`.

---

### `GET /api/auth/me`
Returns the caller's own identity, resolved from the verified token.

**Response `200`**
```json
{ "user_id": 12, "email": "parent@example.com", "role": "parent", "full_name": "Suresh Sharma" }
```

## 2. Student Endpoints
*(role required: `student`)*

### `GET /api/student/me/profile`
```json
{ "student_id": 1, "name": "Rahul Sharma", "admission_no": "STU001", "class_name": "10-A" }
```
`404` if no student profile is linked to the caller's account.

### `GET /api/student/{student_id}/attendance`
Returns the summary for `student_id` — **must equal the caller's own linked
student**, or `403`.
```json
{
  "student_id": 1, "student_name": "Rahul Sharma",
  "total_days": 20, "present": 17, "absent": 2, "late": 1, "percentage": 90.0
}
```

### `GET /api/student/{student_id}/attendance/history?period=last_30_days`
`period` ∈ `last_7_days` \| `last_30_days` \| `last_month` (default
`last_30_days`; invalid value → `422`).
```json
{
  "student_id": 1, "student_name": "Rahul Sharma", "period": "last_30_days",
  "records": [{ "date": "2026-08-18", "status": "present" }, ...]
}
```

## 3. Parent Endpoints
*(role required: `parent`)*

### `GET /api/parent/children`
```json
{
  "parent_id": 4,
  "children": [
    { "student_id": 1, "name": "Rahul Sharma", "class_name": "10-A" },
    { "student_id": 2, "name": "Ananya Sharma", "class_name": "10-B" }
  ]
}
```
`404` if no parent profile is linked to the account.

### `GET /api/parent/child/{student_id}/attendance`
Same summary shape as the student endpoint. Requires a `ParentChild` link;
otherwise `403`. `404` if the student doesn't exist.

### `GET /api/parent/child/{student_id}/attendance/history?period=...`
Same history shape as the student endpoint, same ownership check.

## 4. Teacher Endpoints
*(role required: `teacher`)*

### `GET /api/teacher/classes`
```json
{
  "teacher_id": 3,
  "classes": [{ "class_id": 1, "class_name": "10-A", "student_count": 6 }]
}
```

### `GET /api/teacher/class/{class_id}/attendance`
Today's status roster for one class the teacher is assigned to (`403` if not
their class).
```json
{
  "class_id": 1, "date": "2026-08-19",
  "students": [{ "student_id": 1, "name": "Rahul Sharma", "status": "present" }, ...]
}
```
`status` is `"unmarked"` if no record exists yet for today.

### `GET /api/teacher/student/{student_id}/attendance`
A teacher's view of one student's summary — the student must belong to one of
the teacher's assigned classes.

### `GET /api/teacher/student/{student_id}/attendance/history?period=...`
Same ownership rule, history shape.

### `POST /api/teacher/attendance`
Mark (create or update) a student's attendance for a date.

**Request body**
```json
{ "student_id": 1, "date": "2026-08-19", "status": "absent" }
```
`status` ∈ `present` \| `absent` \| `late` (else `422`). Student must be in one
of the teacher's classes (`403` otherwise).

**Response `200`**
```json
{
  "success": true, "student_id": 1, "student_name": "Rahul Sharma",
  "date": "2026-08-19", "status": "absent", "was_update": false
}
```

## 5. Principal Endpoints

### `GET /api/principal/attendance/analytics`
*(role required: `principal`)* — school-wide analytics, no ownership scoping.
```json
{
  "overall_percentage": 91.4,
  "total_students": 24,
  "by_class": [{ "class_id": 1, "class_name": "10-A", "grade": "10", "section": "A",
                  "student_count": 6, "attendance_percentage": 92.1 }, ...],
  "by_grade": [{ "grade": "10", "student_count": 12, "attendance_percentage": 90.8 }, ...]
}
```

### `GET /api/principal/class/{class_id}/attendance`
*(role required: `principal`)* — today's roster + rolling percentage, for **any**
class (unrestricted, unlike the teacher equivalent). `404` if the class doesn't
exist.
```json
{
  "class_id": 1, "class_name": "10-A", "grade": "10", "section": "A",
  "date": "2026-08-19",
  "students": [{ "student_id": 1, "name": "Rahul Sharma", "today_status": "present", "percentage": 90.0 }]
}
```

### `GET /api/principal/student/{student_id}/attendance/history?period=...`
*(role required: `principal`)* — history for **any** student school-wide.
`404` if the student doesn't exist.

### `GET /api/principal/contact`
*(role required: `parent`)* — resolves the (single) school principal's identity
so a parent can address a "Contact Principal" action.
```json
{ "principal_id": 1, "name": "Dr. Meenal Bhatt" }
```
`404` if no principal is configured.

## 6. Escalation Endpoints
*(role required: `parent`)*

### `POST /api/escalation/teacher`
### `POST /api/escalation/management`
Both share the same request/response shape; `target` is fixed by the route.

**Request body**
```json
{ "student_id": 1, "reason": "I want to discuss Rahul's recent absences." }
```
Requires a `ParentChild` link for `student_id` (`403` otherwise); `404` if the
student doesn't exist.

**Response `200`**
```json
{ "success": true, "request_id": "A1B2C3D4", "student_id": 1, "target": "teacher" }
```

> These REST endpoints exist for direct/API use. The primary escalation UX in
> the product is conversational — see §7, the chat message endpoint — which
> performs the same write only after an explicit yes/no confirmation turn.

### `GET /api/contact-requests`
*(roles: `parent`, `teacher`, `principal`)* — returns the caller's relevant
contact-request list. It includes their outgoing requests and only their
authorized inbox: parents receive requests about linked children, teachers
receive requests for assigned classes, and principals receive principal-directed
requests.

Each item includes the request code, requesting parent, student/class, reason,
created time, and status (`pending`, `accepted`, or `rejected`).

### `POST /api/contact-requests`
*(roles: `parent`, `teacher`, `principal`)* — creates a contact request.
Parents may contact a teacher or principal; teachers may contact the linked
parent of a student in their class; principals may contact that student's
parent or responsible teacher.

```json
{ "student_id": 1, "target": "parent", "reason": "Please discuss recent absences." }
```

### `PATCH /api/contact-requests/{request_id}`
*(roles: `teacher`, `principal`)* — accepts or rejects a pending request that
is assigned to the authenticated recipient.

```json
{ "decision": "accepted" }
```

Returns `403` for requests outside the recipient's authorized inbox and `409`
when a request has already been processed.

## 7. Chat Endpoints
*(any authenticated role)*

### `POST /api/chat/sessions/start`
**Request body**
```json
{ "language": "en" }
```
**Response `200`**
```json
{ "session_id": 55, "language": "en", "greeting": "Good evening, Suresh. I'm your XYZ AI assistant. How can I help?" }
```

### `POST /api/chat/sessions/{session_id}/messages`
**Request body**
```json
{ "message": "How much attendance does my child have?", "language": "en" }
```
**Response `200`**
```json
{
  "reply": "Rahul currently has 90 percent attendance over the last 20 school days.",
  "actions": [{ "label": "Call Rahul's teacher", "value": "I'd like to talk to Rahul's teacher" }],
  "emotion": "happy"
}
```
`404` if the session doesn't exist or doesn't belong to the caller. `actions` is
often `[]`; when present, the frontend renders each as a quick-reply chip whose
`value` is sent as the user's next message verbatim if tapped.

### `GET /api/chat/sessions/{session_id}/history`
```json
{ "messages": [{ "sender": "assistant", "content": "..." }, { "sender": "user", "content": "..." }] }
```
`404` if the session doesn't exist or doesn't belong to the caller.

## 8. Voice (Text-to-Speech) Endpoints
*(any authenticated role)*

### `POST /api/tts/speak`
**Request body**
```json
{ "text": "Rahul currently has 90 percent attendance.", "language": "en" }
```
**Response `200` — local voice available**
```json
{ "provider": "indic_parler", "audio_url": "/audio/3f9a2c1e....wav" }
```
**Response `200` — local voice unavailable (any reason)**
```json
{ "provider": "browser" }
```
The frontend interprets `provider: "browser"` as a signal to use
`window.speechSynthesis` instead — this is never surfaced as an error.

### `GET /api/tts/status`
*(no role restriction beyond being a valid route — no auth dependency declared)*
```json
{ "state": "ready", "device": "cuda:0", "model": "ai4bharat/indic-parler-tts" }
```
Possible `state` values: `ready`, `failed` (includes `retry_in_seconds`), or
`loading_or_not_started`.

## 9. Static Assets

- `GET /audio/{filename}` — serves generated `.wav` clips from `audio_cache/`
  (auto-pruned after `AUDIO_MAX_AGE_SECONDS` = 30 minutes).
- `GET /` and any non-`/api`/non-`/audio` path — serves the frontend
  (`frontend/index.html` and static assets), with SPA-style fallback to
  `index.html` for unknown paths so client-side view refreshes work.

## 10. Error Format

All errors use FastAPI's default `HTTPException` JSON shape:
```json
{ "detail": "You are not authorized to access this student's data" }
```

| Status | Meaning |
|---|---|
| `401` | Missing/invalid/expired token, or invalid login credentials |
| `403` | Authenticated, but wrong role or fails an ownership check |
| `404` | Resource (student/class/session/principal) not found |
| `422` | Invalid request body/query value (e.g. bad `status` or `period`) |

## 11. Authentication Flow Summary

1. `POST /api/auth/login` → obtain `access_token`.
2. Send `Authorization: Bearer <access_token>` on every subsequent call.
3. Token encodes `sub` (user id) and `role`, but **the server always
   re-resolves the role from the database on every request** — the `role`
   claim in the token is never trusted on its own for authorization decisions
   beyond identifying which user to look up.
