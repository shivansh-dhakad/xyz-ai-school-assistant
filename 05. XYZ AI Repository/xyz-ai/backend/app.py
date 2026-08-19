"""
XYZ AI — simplified backend.

Run with:  uvicorn app:app --reload --port 8000
Then open: http://localhost:8000

Demo accounts (password: Password123!):
  student@example.com, parent@example.com, parent2@example.com,
  teacher@example.com, teacher2@example.com, principal@example.com
"""
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv()  # read backend/.env (GROQ_API_KEY, GROQ_MODEL, JWT_SECRET_KEY) before anything else loads env vars

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

import ai
import seed
import tts
from auth import CurrentUser, create_token, get_current_user, hash_password, require_role, verify_password
from database import get_db, init_db
from models import (
    Attendance, AttendanceStatus, ChatMessage, ChatSession, Escalation,
    Parent, ParentChild, Principal, SchoolClass, Student, Teacher, TeacherClass, User,
)

app = FastAPI(title="XYZ AI (simplified)")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

init_db()
seed.run()

# TTS_BLOCK_ON_STARTUP=1 (set by start.sh/start.bat) makes the app finish
# loading the local voice model into memory *before* it starts accepting
# requests, so voice is guaranteed ready (or its failure is printed) from
# the first reply on. This only loads already-downloaded weights - run
# `python download_tts_model.py` once first (see README) or this just
# fails fast and the app falls back to browser voice. Without
# TTS_BLOCK_ON_STARTUP, model loading kicks off in the background instead
# (preload()) so `uvicorn --reload` dev restarts stay fast - the first
# reply or two may fall back to the browser voice while it finishes.
import os as _os
if _os.environ.get("TTS_BLOCK_ON_STARTUP") == "1":
    try:
        tts.ensure_ready_sync()
    except Exception:
        pass  # already logged inside tts.py; app still starts, browser voice covers the gap
else:
    tts.preload()

VALID_PERIODS = {"last_7_days": 7, "last_30_days": 30, "last_month": 30}


# ---------- helpers ----------

def _period_days(period: str) -> int:
    if period not in VALID_PERIODS:
        raise HTTPException(422, f"Invalid period. Must be one of: {', '.join(VALID_PERIODS)}")
    return VALID_PERIODS[period]


def _attendance_summary_dict(db: Session, student_id: int) -> Optional[dict]:
    student = db.query(Student).get(student_id)
    if student is None:
        return None
    records = db.query(Attendance).filter(Attendance.student_id == student_id).all()
    present = sum(1 for r in records if r.status == AttendanceStatus.present)
    late = sum(1 for r in records if r.status == AttendanceStatus.late)
    absent = len(records) - present - late
    pct = round((present + late) / len(records) * 100, 1) if records else 0.0
    return {
        "student_id": student.id, "student_name": student.name,
        "total_days": len(records), "present": present, "absent": absent, "late": late,
        "percentage": pct,
    }


def _attendance_history(db: Session, student_id: int, period: str) -> Optional[dict]:
    student = db.query(Student).get(student_id)
    if student is None:
        return None
    since = date.today() - timedelta(days=_period_days(period))
    records = (
        db.query(Attendance)
        .filter(Attendance.student_id == student_id, Attendance.date >= since)
        .order_by(Attendance.date.desc())
        .all()
    )
    return {
        "student_id": student.id, "student_name": student.name, "period": period,
        "records": [{"date": str(r.date), "status": r.status.value} for r in records],
    }


def _assert_parent_owns_child(db: Session, user: CurrentUser, student_id: int):
    parent = db.query(Parent).filter(Parent.user_id == user.id).first()
    if parent is None:
        raise HTTPException(403, "No parent profile for this account")
    link = db.query(ParentChild).filter(
        ParentChild.parent_id == parent.id, ParentChild.student_id == student_id
    ).first()
    if link is None:
        raise HTTPException(403, "You are not authorized to access this student's data")


def _assert_teacher_owns_class(db: Session, user: CurrentUser, class_id: int):
    teacher = db.query(Teacher).filter(Teacher.user_id == user.id).first()
    if teacher is None:
        raise HTTPException(403, "No teacher profile for this account")
    link = db.query(TeacherClass).filter(
        TeacherClass.teacher_id == teacher.id, TeacherClass.class_id == class_id
    ).first()
    if link is None:
        raise HTTPException(403, "You are not authorized to access this class")


# ---------- schemas ----------

class LoginRequest(BaseModel):
    email: str
    password: str


class MarkAttendanceRequest(BaseModel):
    student_id: int
    date: date
    status: str


class EscalationRequestBody(BaseModel):
    student_id: int
    reason: str


class ContactRequestDecisionBody(BaseModel):
    decision: str


class ContactRequestCreateBody(BaseModel):
    student_id: int
    target: str
    reason: str = "Requested via app"


class ChatStartRequest(BaseModel):
    language: str = "en"


class ChatMessageRequest(BaseModel):
    message: str
    language: str = "en"


class SpeakRequest(BaseModel):
    text: str
    language: str = "en"


# ---------- auth ----------

@app.post("/api/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(401, "Invalid email or password")
    token = create_token(user.id, user.role.value)
    return {"access_token": token, "user_id": user.id, "role": user.role.value, "full_name": user.full_name}


@app.get("/api/auth/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return {"user_id": user.id, "email": user.email, "role": user.role, "full_name": user.full_name}


# ---------- student ----------

@app.get("/api/student/me/profile")
def student_profile(user: CurrentUser = Depends(require_role("student")), db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.user_id == user.id).first()
    if student is None:
        raise HTTPException(404, "Student profile not found")
    return {
        "student_id": student.id, "name": student.name, "admission_no": student.admission_no,
        "class_name": student.school_class.name if student.school_class else None,
    }


@app.get("/api/student/{student_id}/attendance")
def student_attendance(student_id: int, user: CurrentUser = Depends(require_role("student")), db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if student is None or student.user_id != user.id:
        raise HTTPException(403, "You are not authorized to access this student's data")
    return _attendance_summary_dict(db, student_id)


@app.get("/api/student/{student_id}/attendance/history")
def student_attendance_history(student_id: int, period: str = "last_30_days",
                                 user: CurrentUser = Depends(require_role("student")), db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if student is None or student.user_id != user.id:
        raise HTTPException(403, "You are not authorized to access this student's data")
    return _attendance_history(db, student_id, period)


# ---------- parent ----------

@app.get("/api/parent/children")
def parent_children(user: CurrentUser = Depends(require_role("parent")), db: Session = Depends(get_db)):
    parent = db.query(Parent).filter(Parent.user_id == user.id).first()
    if parent is None:
        raise HTTPException(404, "No parent profile for this account")
    links = db.query(ParentChild).filter(ParentChild.parent_id == parent.id).all()
    children = []
    for link in links:
        s = db.query(Student).get(link.student_id)
        if s:
            children.append({"student_id": s.id, "name": s.name, "class_name": s.school_class.name})
    return {"parent_id": parent.id, "children": children}


@app.get("/api/parent/child/{student_id}/attendance")
def parent_child_attendance(student_id: int, user: CurrentUser = Depends(require_role("parent")), db: Session = Depends(get_db)):
    _assert_parent_owns_child(db, user, student_id)
    result = _attendance_summary_dict(db, student_id)
    if result is None:
        raise HTTPException(404, "Student not found")
    return result


@app.get("/api/parent/child/{student_id}/attendance/history")
def parent_child_history(student_id: int, period: str = "last_30_days",
                          user: CurrentUser = Depends(require_role("parent")), db: Session = Depends(get_db)):
    _assert_parent_owns_child(db, user, student_id)
    result = _attendance_history(db, student_id, period)
    if result is None:
        raise HTTPException(404, "Student not found")
    return result


# ---------- teacher ----------

@app.get("/api/teacher/classes")
def teacher_classes(user: CurrentUser = Depends(require_role("teacher")), db: Session = Depends(get_db)):
    teacher = db.query(Teacher).filter(Teacher.user_id == user.id).first()
    if teacher is None:
        raise HTTPException(404, "No teacher profile for this account")
    links = db.query(TeacherClass).filter(TeacherClass.teacher_id == teacher.id).all()
    classes = []
    for link in links:
        c = db.query(SchoolClass).get(link.class_id)
        count = db.query(Student).filter(Student.class_id == c.id).count()
        classes.append({"class_id": c.id, "class_name": c.name, "student_count": count})
    return {"teacher_id": teacher.id, "classes": classes}


@app.get("/api/teacher/class/{class_id}/attendance")
def teacher_class_attendance(class_id: int, user: CurrentUser = Depends(require_role("teacher")), db: Session = Depends(get_db)):
    _assert_teacher_owns_class(db, user, class_id)
    students = db.query(Student).filter(Student.class_id == class_id).all()
    today = date.today()
    rows = []
    for s in students:
        rec = db.query(Attendance).filter(Attendance.student_id == s.id, Attendance.date == today).first()
        rows.append({"student_id": s.id, "name": s.name, "status": rec.status.value if rec else "unmarked"})
    return {"class_id": class_id, "date": str(today), "students": rows}


@app.get("/api/teacher/student/{student_id}/attendance")
def teacher_student_attendance(student_id: int, user: CurrentUser = Depends(require_role("teacher")), db: Session = Depends(get_db)):
    """A teacher's view of one particular student's attendance summary — the
    student must be in a class this teacher is assigned to (same ownership
    check used everywhere else)."""
    student = db.query(Student).get(student_id)
    if student is None:
        raise HTTPException(404, "Student not found")
    _assert_teacher_owns_class(db, user, student.class_id)
    summary = _attendance_summary_dict(db, student_id)
    return summary


@app.get("/api/teacher/student/{student_id}/attendance/history")
def teacher_student_attendance_history(
    student_id: int, period: str = "last_30_days",
    user: CurrentUser = Depends(require_role("teacher")), db: Session = Depends(get_db),
):
    student = db.query(Student).get(student_id)
    if student is None:
        raise HTTPException(404, "Student not found")
    _assert_teacher_owns_class(db, user, student.class_id)
    return _attendance_history(db, student_id, period)


@app.post("/api/teacher/attendance")
def mark_attendance(payload: MarkAttendanceRequest, user: CurrentUser = Depends(require_role("teacher")), db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == payload.student_id).first()
    if student is None:
        raise HTTPException(404, "Student not found")
    _assert_teacher_owns_class(db, user, student.class_id)
    try:
        status_enum = AttendanceStatus(payload.status)
    except ValueError:
        raise HTTPException(422, "status must be one of: present, absent, late")

    existing = db.query(Attendance).filter(
        Attendance.student_id == student.id, Attendance.date == payload.date
    ).first()
    was_update = existing is not None
    if existing:
        existing.status = status_enum
    else:
        db.add(Attendance(student_id=student.id, class_id=student.class_id, date=payload.date, status=status_enum))
    db.commit()
    return {"success": True, "student_id": student.id, "student_name": student.name,
            "date": str(payload.date), "status": status_enum.value, "was_update": was_update}


# ---------- principal ----------

def _split_grade_section(class_name: str):
    """"10-A" -> ("10", "A"). Falls back gracefully if a class isn't named
    that way."""
    if "-" in class_name:
        grade, _, section = class_name.partition("-")
        return grade.strip(), section.strip()
    return class_name.strip(), ""


@app.get("/api/principal/attendance/analytics")
def school_analytics(user: CurrentUser = Depends(require_role("principal")), db: Session = Depends(get_db)):
    classes = db.query(SchoolClass).all()
    by_class = []
    by_grade: dict[str, dict] = {}
    total_present = total_records = 0
    for c in classes:
        grade, section = _split_grade_section(c.name)
        student_ids = [s.id for s in db.query(Student).filter(Student.class_id == c.id).all()]
        records = db.query(Attendance).filter(Attendance.class_id == c.id).all()
        present = sum(1 for r in records if r.status in (AttendanceStatus.present, AttendanceStatus.late))
        pct = round(present / len(records) * 100, 1) if records else 0.0
        by_class.append({
            "class_id": c.id, "class_name": c.name, "grade": grade, "section": section,
            "student_count": len(student_ids), "attendance_percentage": pct,
        })
        g = by_grade.setdefault(grade, {"grade": grade, "student_count": 0, "present": 0, "records": 0})
        g["student_count"] += len(student_ids)
        g["present"] += present
        g["records"] += len(records)
        total_present += present
        total_records += len(records)
    by_grade_out = [
        {"grade": g["grade"], "student_count": g["student_count"],
         "attendance_percentage": round(g["present"] / g["records"] * 100, 1) if g["records"] else 0.0}
        for g in by_grade.values()
    ]
    overall = round(total_present / total_records * 100, 1) if total_records else 0.0
    return {
        "overall_percentage": overall, "total_students": db.query(Student).count(),
        "by_class": by_class, "by_grade": by_grade_out,
    }


@app.get("/api/principal/class/{class_id}/attendance")
def principal_class_attendance(class_id: int, user: CurrentUser = Depends(require_role("principal")), db: Session = Depends(get_db)):
    """Class-wise AND section-wise drilldown: every student in this one
    class/section, with today's status — principal can view any class,
    unlike a teacher who is restricted to their own."""
    school_class = db.query(SchoolClass).get(class_id)
    if school_class is None:
        raise HTTPException(404, "Class not found")
    students = db.query(Student).filter(Student.class_id == class_id).all()
    today = date.today()
    rows = []
    for s in students:
        rec = db.query(Attendance).filter(Attendance.student_id == s.id, Attendance.date == today).first()
        summary = _attendance_summary_dict(db, s.id)
        rows.append({
            "student_id": s.id, "name": s.name,
            "today_status": rec.status.value if rec else "unmarked",
            "percentage": summary["percentage"] if summary else 0.0,
        })
    grade, section = _split_grade_section(school_class.name)
    responsible_teachers = [
        {"teacher_id": teacher.id, "name": teacher.name}
        for teacher in db.query(Teacher).join(TeacherClass, TeacherClass.teacher_id == Teacher.id)
        .filter(TeacherClass.class_id == class_id).all()
    ]
    return {"class_id": class_id, "class_name": school_class.name, "grade": grade, "section": section,
            "date": str(today), "students": rows, "responsible_teachers": responsible_teachers}


@app.get("/api/principal/student/{student_id}/attendance/history")
def principal_student_attendance_history(
    student_id: int, period: str = "last_30_days",
    user: CurrentUser = Depends(require_role("principal")), db: Session = Depends(get_db),
):
    """Student-wise drilldown, unrestricted by class — the principal can
    look up any single student in the school."""
    history = _attendance_history(db, student_id, period)
    if history is None:
        raise HTTPException(404, "Student not found")
    return history


@app.get("/api/principal/contact")
def principal_contact(user: CurrentUser = Depends(require_role("parent")), db: Session = Depends(get_db)):
    """There is exactly one principal, so unlike teachers (one per class)
    the app never needs to disambiguate — this just resolves who they are
    for the single, school-wide 'Contact Principal' action."""
    principal = db.query(Principal).first()
    if principal is None:
        raise HTTPException(404, "No principal is set up for this school yet")
    return {"principal_id": principal.id, "name": principal.name}


# ---------- escalation ----------

def _escalate(db, user, payload, target):
    import uuid
    _assert_parent_owns_child(db, user, payload.student_id)
    student = db.query(Student).get(payload.student_id)
    if student is None:
        raise HTTPException(404, "Student not found")
    code = str(uuid.uuid4())[:8].upper()
    db.add(Escalation(requester_id=user.id, student_id=student.id, target=target, reason=payload.reason, request_code=code))
    db.commit()
    return {"success": True, "request_id": code, "student_id": student.id, "target": target}


@app.post("/api/escalation/teacher")
def escalate_teacher(payload: EscalationRequestBody, user: CurrentUser = Depends(require_role("parent")), db: Session = Depends(get_db)):
    return _escalate(db, user, payload, "teacher")


@app.post("/api/escalation/management")
def escalate_management(payload: EscalationRequestBody, user: CurrentUser = Depends(require_role("parent")), db: Session = Depends(get_db)):
    return _escalate(db, user, payload, "management")


# ---------- contact requests ----------

def _can_respond_to_contact_request(db: Session, user: CurrentUser, request: Escalation, student: Student) -> bool:
    """Checks the request inbox rather than trusting the client to identify a recipient."""
    if request.requester_id == user.id:
        return False
    if user.role == "principal":
        return request.target == "management"
    if user.role == "teacher" and request.target == "teacher":
        teacher = db.query(Teacher).filter(Teacher.user_id == user.id).first()
        return bool(teacher and db.query(TeacherClass).filter(
            TeacherClass.teacher_id == teacher.id, TeacherClass.class_id == student.class_id
        ).first())
    if user.role == "parent" and request.target == "parent":
        parent = db.query(Parent).filter(Parent.user_id == user.id).first()
        return bool(parent and db.query(ParentChild).filter(
            ParentChild.parent_id == parent.id, ParentChild.student_id == student.id
        ).first())
    return False


def _contact_request_dict(request: Escalation, student: Student, requester: User, can_respond: bool) -> dict:
    school_class = student.school_class
    return {
        "request_id": request.id,
        "request_code": request.request_code,
        "student_id": student.id,
        "student_name": student.name,
        "class_name": school_class.name if school_class else "—",
        "requester_name": requester.full_name,
        "target": request.target,
        "reason": request.reason,
        "status": request.status or "pending",
        "direction": "incoming" if can_respond else "outgoing",
        "can_respond": can_respond,
        "created_at": request.created_at.isoformat() if request.created_at else None,
        "responded_at": request.responded_at.isoformat() if request.responded_at else None,
    }


def _incoming_contact_request(db: Session, user: CurrentUser, request_id: int) -> Escalation:
    request = db.query(Escalation).filter(Escalation.id == request_id).first()
    if request is None:
        raise HTTPException(404, "Contact request not found")
    student = db.query(Student).get(request.student_id)
    if student is None:
        raise HTTPException(404, "Student not found")
    if not _can_respond_to_contact_request(db, user, request, student):
        raise HTTPException(403, "This contact request is not assigned to you")
    return request


@app.post("/api/contact-requests")
def create_contact_request(payload: ContactRequestCreateBody,
                           user: CurrentUser = Depends(require_role("student", "parent", "teacher", "principal")),
                           db: Session = Depends(get_db)):
    """Create a role-scoped contact request without exposing other families or classes."""
    target = payload.target.lower().strip()
    student = db.query(Student).get(payload.student_id)
    if student is None:
        raise HTTPException(404, "Student not found")
    if user.role == "student":
        if student.user_id != user.id:
            raise HTTPException(403, "You may only contact the teacher assigned to you")
        if target not in {"teacher", "management"}:
            raise HTTPException(422, "Students may contact their teacher or principal")
    elif user.role == "parent":
        _assert_parent_owns_child(db, user, student.id)
        if target not in {"teacher", "management"}:
            raise HTTPException(422, "Parents may contact a teacher or principal")
    elif user.role == "teacher":
        _assert_teacher_owns_class(db, user, student.class_id)
        if target not in {"parent", "management"}:
            raise HTTPException(422, "Teachers may contact a student's parent or principal")
    elif user.role == "principal":
        if target not in {"parent", "teacher"}:
            raise HTTPException(422, "Principals may contact a student's parent or teacher")

    import uuid
    code = str(uuid.uuid4())[:8].upper()
    request = Escalation(requester_id=user.id, student_id=student.id, target=target,
                         reason=payload.reason.strip() or "Requested via app", request_code=code)
    db.add(request)
    db.commit()
    return {"success": True, "request_id": code, "contact_request_id": request.id,
            "student_id": student.id, "target": target, "status": request.status}


@app.get("/api/contact-requests")
def contact_requests(user: CurrentUser = Depends(require_role("student", "parent", "teacher", "principal")), db: Session = Depends(get_db)):
    """List only the caller's own outgoing requests or their authorized inbox."""
    query = db.query(Escalation, Student, User).join(Student, Escalation.student_id == Student.id).join(
        User, Escalation.requester_id == User.id
    )
    if user.role == "student":
        query = query.filter(Escalation.requester_id == user.id)
    elif user.role == "parent":
        parent = db.query(Parent).filter(Parent.user_id == user.id).first()
        if parent is None:
            raise HTTPException(403, "No parent profile for this account")
        child_ids = [row.student_id for row in db.query(ParentChild).filter(ParentChild.parent_id == parent.id)]
        query = query.filter(or_(Escalation.requester_id == user.id,
                                 (Escalation.target == "parent") & Student.id.in_(child_ids)))
    elif user.role == "principal":
        query = query.filter(or_(Escalation.requester_id == user.id, Escalation.target == "management"))
    else:
        teacher = db.query(Teacher).filter(Teacher.user_id == user.id).first()
        if teacher is None:
            raise HTTPException(403, "No teacher profile for this account")
        class_ids = [row.class_id for row in db.query(TeacherClass).filter(TeacherClass.teacher_id == teacher.id)]
        query = query.filter(or_(Escalation.requester_id == user.id,
                                 (Escalation.target == "teacher") & Student.class_id.in_(class_ids)))
    rows = query.order_by(Escalation.created_at.desc()).all()
    return {"requests": [
        _contact_request_dict(request, student, requester, _can_respond_to_contact_request(db, user, request, student))
        for request, student, requester in rows
    ]}


@app.patch("/api/contact-requests/{request_id}")
def decide_contact_request(request_id: int, payload: ContactRequestDecisionBody,
                           user: CurrentUser = Depends(require_role("parent", "teacher", "principal")), db: Session = Depends(get_db)):
    decision = payload.decision.lower().strip()
    if decision not in {"accepted", "rejected"}:
        raise HTTPException(422, "Decision must be 'accepted' or 'rejected'")
    request = _incoming_contact_request(db, user, request_id)
    if (request.status or "pending") != "pending":
        raise HTTPException(409, "This contact request has already been processed")
    request.status = decision
    request.responder_id = user.id
    request.responded_at = datetime.utcnow()
    db.commit()
    return {"success": True, "request_id": request.id, "status": request.status}


# ---------- chat ----------

@app.post("/api/chat/sessions/start")
def start_chat(payload: ChatStartRequest, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    session = ChatSession(user_id=user.id, language=payload.language)
    db.add(session)
    db.flush()
    greeting = ai.generate_greeting(user.role, payload.language, user.full_name)
    db.add(ChatMessage(session_id=session.id, sender="assistant", content=greeting))
    db.commit()
    return {"session_id": session.id, "language": payload.language, "greeting": greeting}


@app.post("/api/chat/sessions/{session_id}/messages")
def send_chat_message(session_id: int, payload: ChatMessageRequest, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
    if session is None:
        raise HTTPException(404, "Session not found")
    session.language = payload.language
    history = [
        {"sender": m.sender, "content": m.content}
        for m in db.query(ChatMessage).filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at).all()
    ]
    db.add(ChatMessage(session_id=session.id, sender="user", content=payload.message))
    result = ai.generate_reply(db, role=user.role, user_id=user.id, session_id=session.id,
                                full_name=user.full_name, language=payload.language,
                                message=payload.message, history=history)
    db.add(ChatMessage(session_id=session.id, sender="assistant", content=result["reply"]))
    db.commit()
    return {"reply": result["reply"], "actions": result.get("actions", []), "emotion": result.get("emotion", "neutral")}


@app.get("/api/chat/sessions/{session_id}/history")
def chat_history(session_id: int, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
    if session is None:
        raise HTTPException(404, "Session not found")
    msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at).all()
    return {"messages": [{"sender": m.sender, "content": m.content} for m in msgs]}


# ---------- text-to-speech (local Indic Parler-TTS) ----------

@app.post("/api/tts/speak")
async def speak(payload: SpeakRequest, user: CurrentUser = Depends(get_current_user)):
    """Turns already-generated text into natural speech via the local
    Indic Parler-TTS model, in the persona voice for this user's role. If
    the model isn't loaded/available/usable for the requested language,
    returns provider:"browser" so the frontend falls back to the Web
    Speech API instead of erroring out — every language stays usable
    either way."""
    result = await tts.synthesize(payload.text, payload.language, user.role)
    if result is None:
        return {"provider": "browser"}
    return {"provider": "indic_parler", **result}


@app.get("/api/tts/status")
def tts_status():
    """Lets the frontend (or `python setup.py` at startup) tell whether the
    local voice model is actually loaded, still loading, or unavailable,
    instead of only finding out indirectly the first time a reply goes
    silent. See backend/tts.py for the state this reports."""
    return tts.status()


# ---------- serve frontend + generated audio ----------

AUDIO_DIR = Path(__file__).parent / "audio_cache"
AUDIO_DIR.mkdir(exist_ok=True)
# Mounted before the frontend catch-all below so /audio/* is never
# shadowed by it. Serves the wav clips tts.py writes to disk.
app.mount("/audio", StaticFiles(directory=str(AUDIO_DIR)), name="audio")

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.exists():
    # Mounted last so it never shadows the /api/* or /audio/* routes above;
    # falls back to index.html for any other path (so refreshing on a
    # client-side view works).
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
