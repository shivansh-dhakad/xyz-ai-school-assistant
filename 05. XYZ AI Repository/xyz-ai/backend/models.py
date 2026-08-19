"""
Database models — plain SQLAlchemy, SQLite file DB.

Kept intentionally small: one file, integer primary keys, no migrations
framework. Run the app once and tables + demo data are created automatically.
"""
import enum
from datetime import datetime, date

from sqlalchemy import (
    Column, Integer, String, Date, DateTime, Enum, ForeignKey, Text, Boolean
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


class UserRole(str, enum.Enum):
    student = "student"
    parent = "parent"
    teacher = "teacher"
    principal = "principal"


class AttendanceStatus(str, enum.Enum):
    present = "present"
    absent = "absent"
    late = "late"


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(UserRole), nullable=False)
    full_name = Column(String, nullable=False)
    preferred_language = Column(String, default="en")


class SchoolClass(Base):
    __tablename__ = "classes"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)  # "10-A"

    students = relationship("Student", back_populates="school_class")


class Student(Base):
    __tablename__ = "students"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, unique=True)
    name = Column(String, nullable=False)
    admission_no = Column(String, unique=True, nullable=False)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False)

    school_class = relationship("SchoolClass", back_populates="students")


class Parent(Base):
    __tablename__ = "parents"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    name = Column(String, nullable=False)
    phone = Column(String)


class ParentChild(Base):
    """Authorization boundary: a parent may only see a student if a row exists here."""
    __tablename__ = "parent_children"
    id = Column(Integer, primary_key=True)
    parent_id = Column(Integer, ForeignKey("parents.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)


class Teacher(Base):
    __tablename__ = "teachers"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    name = Column(String, nullable=False)


class TeacherClass(Base):
    """Authorization boundary: a teacher may only touch a class if a row exists here."""
    __tablename__ = "teacher_classes"
    id = Column(Integer, primary_key=True)
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=False)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False)


class Principal(Base):
    __tablename__ = "principals"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    name = Column(String, nullable=False)


class Attendance(Base):
    __tablename__ = "attendance"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    status = Column(Enum(AttendanceStatus), nullable=False)


class Escalation(Base):
    __tablename__ = "escalations"
    id = Column(Integer, primary_key=True)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    target = Column(String, nullable=False)  # "teacher" | "management"
    reason = Column(String, nullable=False)
    request_code = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    # A request stays pending until its intended recipient responds.  Keeping
    # the response on the request gives parents an auditable status without
    # exposing requests to unrelated teachers.
    status = Column(String, nullable=False, default="pending")  # pending | accepted | rejected
    responder_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    responded_at = Column(DateTime, nullable=True)


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    language = Column(String, default="en")
    started_at = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    sender = Column(String, nullable=False)  # "user" | "assistant"
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
