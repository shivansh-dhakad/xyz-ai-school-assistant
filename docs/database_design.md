# Database Design
## School ERP Ecosystem — XYZ AI Module

## 1. Overview

- **Engine**: SQLite, single file `backend/xyzai.db`, created automatically on
  first run via `database.init_db()` (`Base.metadata.create_all()`).
- **ORM**: SQLAlchemy 2.0, declarative base in `models.py`.
- **Migrations**: none — the schema is created fresh from the current model
  definitions; there is no Alembic/versioned-migration layer (see §6).
- **Primary keys**: plain auto-incrementing integers throughout.
- **Connection**: `check_same_thread=False` (SQLite driver flag) so the same
  file can be accessed from FastAPI's threaded request handling within one
  process.

## 2. Entity-Relationship Diagram

```
 User (1) ────────── (0..1) Student           User (1) ── (1) Parent
   │  role: student/parent/teacher/principal        │
   │                                                  │ (1)
   │                                                  │
   │                                            ParentChild (M:N join)
   │                                                  │
   │                                                  │ (M)
   │                                             Student (M) ── (1) SchoolClass
   │                                                  │
   │                                             Attendance (M) ── student_id, class_id
   │
 User (1) ── (1) Teacher ── TeacherClass (M:N join) ── SchoolClass
   │
 User (1) ── (1) Principal            (no FK — single row, resolved by query)

 Escalation: requester_id -> User, student_id -> Student
 ChatSession: user_id -> User
 ChatMessage: session_id -> ChatSession
```

## 3. Tables

### 3.1 `users`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `email` | String, unique, indexed | Login identifier |
| `hashed_password` | String | bcrypt hash |
| `role` | Enum(`UserRole`) | `student` \| `parent` \| `teacher` \| `principal` |
| `full_name` | String | |
| `preferred_language` | String, default `"en"` | Stored per user; currently the frontend also tracks language per-session/selector — see Technical Design §5 |

### 3.2 `classes` (`SchoolClass`)
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `name` | String, unique | e.g. `"10-A"` — the `grade-section` convention is parsed by `_split_grade_section` for analytics |

### 3.3 `students`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | Integer FK → `users.id`, nullable, unique | Null for students without their own login (most seeded students); set for the one demo student account |
| `name` | String | |
| `admission_no` | String, unique | e.g. `"STU001"` |
| `class_id` | Integer FK → `classes.id` | |

### 3.4 `parents`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | Integer FK → `users.id`, unique | |
| `name` | String | |
| `phone` | String, nullable | |

### 3.5 `parent_children` (`ParentChild`)
**This table is the entire parent-side authorization boundary.** A parent may
view a student's attendance if and only if a row exists here.
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `parent_id` | Integer FK → `parents.id` | |
| `student_id` | Integer FK → `students.id` | |

Supports many-to-many: a parent can be linked to multiple children (siblings),
and — in principle — a student could be linked to more than one parent account.

### 3.6 `teachers`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | Integer FK → `users.id`, unique | |
| `name` | String | |

### 3.7 `teacher_classes` (`TeacherClass`)
**The entire teacher-side authorization boundary.** A teacher may view/mark a
class if and only if a row exists here.
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `teacher_id` | Integer FK → `teachers.id` | |
| `class_id` | Integer FK → `classes.id` | |

### 3.8 `principals`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | Integer FK → `users.id`, unique | |
| `name` | String | |

No ownership-join table is needed — the system assumes exactly one principal
(`app.py: principal_contact` simply takes `db.query(Principal).first()`), and
a principal's access is school-wide by design (not row-scoped).

### 3.9 `attendance`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `student_id` | Integer FK → `students.id`, indexed | |
| `class_id` | Integer FK → `classes.id`, indexed | Denormalized copy of the student's class at time of marking — avoids a join for class-wide queries |
| `date` | Date | |
| `status` | Enum(`AttendanceStatus`) | `present` \| `absent` \| `late` |

No unique constraint currently enforces one row per `(student_id, date)`;
"one row per day" is maintained at the application layer (`mark_attendance` and
the teacher chat handler both query for an existing same-day row and update it
rather than inserting a duplicate) — see §6 for a hardening recommendation.

### 3.10 `escalations`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `requester_id` | Integer FK → `users.id` | Always a parent in the current flows |
| `student_id` | Integer FK → `students.id` | |
| `target` | String | `"teacher"` \| `"management"` |
| `reason` | String | Free text — the triggering chat message, or an explicit reason from the REST body |
| `request_code` | String, unique | 8-char uppercase hex, e.g. `A1B2C3D4` (`uuid.uuid4()[:8].upper()`) — shown to the user as a reference |
| `created_at` | DateTime, default `utcnow` | |

### 3.11 `chat_sessions`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | Integer FK → `users.id` | |
| `language` | String, default `"en"` | Updated on every message to the language sent with that turn |
| `started_at` | DateTime, default `utcnow` | |

### 3.12 `chat_messages`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `session_id` | Integer FK → `chat_sessions.id`, indexed | |
| `sender` | String | `"user"` \| `"assistant"` |
| `content` | Text | |
| `created_at` | DateTime, default `utcnow` | |

## 4. Enumerations

```python
class UserRole(str, enum.Enum):
    student = "student"; parent = "parent"; teacher = "teacher"; principal = "principal"

class AttendanceStatus(str, enum.Enum):
    present = "present"; absent = "absent"; late = "late"
```

## 5. Seed Data (`seed.py`)

Runs once, only if `users` is empty:
- 4 classes: `10-A`, `10-B`, `9-A`, `9-B`.
- 24 students, round-robin assigned across the 4 classes, with deterministic
  names (`random.seed(42)`); two students' surnames are overridden to create a
  believable sibling pair.
- ~20 school days (weekdays only) of attendance per student, weighted 85%
  present / 10% absent / 5% late.
- 5 teacher accounts, each linked to exactly one class via `TeacherClass`
  (`teacher@example.com` → `10-A`, `teacher2@…` → `10-B`, etc.).
- 1 principal account (`principal@example.com`).
- 6 parent accounts, with `ParentChild` links including a deliberate sibling
  pair under `parent@example.com` and an intentionally *unrelated* student
  under `parent2@example.com` (for testing access-denial paths).
- 1 student login (`student@example.com`) linked to the first seeded student.

All demo accounts share the password `Password123!`.

## 6. Design Notes, Constraints & Recommendations

- **No composite unique constraint on `(student_id, date)` in `attendance`.**
  Correctness currently relies on both write paths (REST `mark_attendance`,
  chat teacher handler) always querying for an existing row first. Recommended
  hardening: add `UniqueConstraint("student_id", "date")` to prevent a future
  code path from silently creating duplicates.
- **`class_id` is denormalized onto `attendance`.** This is intentional — it
  lets class-wide/date-scoped queries avoid a join through `students`, at the
  cost of needing to keep it in sync if a student ever changes class (not
  currently a supported operation).
- **No migrations framework.** Any schema change today requires either a fresh
  `xyzai.db` or a manual `ALTER TABLE`. Recommended before any real schema
  evolution: introduce Alembic.
- **No audit trail for attendance edits.** The `was_update` flag returned by
  `mark_attendance` indicates an overwrite occurred, but the prior value isn't
  retained. Recommended: an `attendance_audit` table if compliance/history needs
  to be demonstrable.
- **`preferred_language` on `users` vs. per-session `language` on
  `chat_sessions`.** Both exist; the session-level field is what's actually
  read/written by the current chat flow. `users.preferred_language` is present
  in the schema but not yet wired to update automatically from chat language
  changes — a natural follow-up so a user's language choice persists across
  sessions.
- **Production database**: for a multi-user, concurrent-write deployment,
  migrating from SQLite to PostgreSQL is the natural next step — the SQLAlchemy
  model layer is portable with only the `database.py` engine URL and any
  SQLite-specific `connect_args` changing. See `10_Deployment_Guide.md`.