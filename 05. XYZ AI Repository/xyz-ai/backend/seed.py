"""Seeds demo data once, on first startup. Safe to import repeatedly."""
import random
from datetime import date, timedelta

from database import SessionLocal
from models import (
    User, UserRole, SchoolClass, Student, Parent, ParentChild,
    Teacher, TeacherClass, Principal, Attendance, AttendanceStatus,
)
from auth import hash_password

random.seed(42)
DEMO_PASSWORD = "Password123!"

FIRST_NAMES = ["Rahul", "Ananya", "Vikram", "Priya", "Arjun", "Sneha", "Karan", "Divya",
               "Aditya", "Neha", "Rohan", "Kavya", "Aarav", "Isha", "Siddharth", "Meera"]
LAST_NAMES = ["Sharma", "Rao", "Verma", "Iyer", "Gupta", "Nair", "Reddy", "Singh"]
PARENT_FIRST_NAMES = ["Suresh", "Kavita", "Ramesh", "Sunita", "Deepak", "Anjali", "Mahesh", "Pooja"]
TEACHER_NAMES = ["Anita Desai", "Ramesh Kulkarni", "Sunita Joshi", "Prakash Menon", "Lakshmi Pillai"]
PRINCIPAL_NAME = "Dr. Meenal Bhatt"


def _name(i):
    return f"{FIRST_NAMES[i % len(FIRST_NAMES)]} {LAST_NAMES[i % len(LAST_NAMES)]}"


def _seed_attendance(db, student_id, class_id, days=20):
    day = date.today()
    created = 0
    while created < days:
        day -= timedelta(days=1)
        if day.weekday() >= 5:
            continue
        status = random.choices(
            [AttendanceStatus.present, AttendanceStatus.absent, AttendanceStatus.late],
            weights=[85, 10, 5],
        )[0]
        db.add(Attendance(student_id=student_id, class_id=class_id, date=day, status=status))
        created += 1


def run():
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return  # already seeded

        classes = []
        for name in ["10-A", "10-B", "9-A", "9-B"]:
            c = SchoolClass(name=name)
            db.add(c)
            classes.append(c)
        db.flush()

        students = []
        for i in range(24):
            s = Student(name=_name(i), admission_no=f"STU{i+1:03d}", class_id=classes[i % 4].id)
            db.add(s)
            students.append(s)
        db.flush()
        students[1].name = f"{FIRST_NAMES[1]} {LAST_NAMES[0]}"  # sibling surname match
        students[2].name = f"{FIRST_NAMES[2]} {LAST_NAMES[1]}"

        for s in students:
            _seed_attendance(db, s.id, s.class_id)

        teachers = []
        for i, name in enumerate(TEACHER_NAMES):
            email = "teacher@example.com" if i == 0 else f"teacher{i+1}@example.com"
            u = User(email=email, hashed_password=hash_password(DEMO_PASSWORD),
                     role=UserRole.teacher, full_name=name)
            db.add(u)
            db.flush()
            t = Teacher(user_id=u.id, name=name)
            db.add(t)
            db.flush()
            teachers.append(t)
        db.add(TeacherClass(teacher_id=teachers[0].id, class_id=classes[0].id))
        db.add(TeacherClass(teacher_id=teachers[1].id, class_id=classes[1].id))
        db.add(TeacherClass(teacher_id=teachers[2].id, class_id=classes[2].id))
        db.add(TeacherClass(teacher_id=teachers[3].id, class_id=classes[3].id))

        p_user = User(email="principal@example.com", hashed_password=hash_password(DEMO_PASSWORD),
                      role=UserRole.principal, full_name=PRINCIPAL_NAME)
        db.add(p_user)
        db.flush()
        db.add(Principal(user_id=p_user.id, name=PRINCIPAL_NAME))

        parents = []
        for i in range(6):
            email = "parent@example.com" if i == 0 else f"parent{i+1}@example.com"
            surname = LAST_NAMES[i % len(LAST_NAMES)]
            name = f"{PARENT_FIRST_NAMES[i % len(PARENT_FIRST_NAMES)]} {surname}"
            u = User(email=email, hashed_password=hash_password(DEMO_PASSWORD),
                     role=UserRole.parent, full_name=name)
            db.add(u)
            db.flush()
            par = Parent(user_id=u.id, name=name, phone=f"+91-90000{i:05d}")
            db.add(par)
            db.flush()
            parents.append(par)

        db.add(ParentChild(parent_id=parents[0].id, student_id=students[0].id))
        db.add(ParentChild(parent_id=parents[0].id, student_id=students[1].id))
        db.add(ParentChild(parent_id=parents[1].id, student_id=students[2].id))
        remaining = students[3:]
        idx = 0
        for par in parents[2:]:
            for _ in range(random.choice([1, 1, 2])):
                if idx >= len(remaining):
                    break
                db.add(ParentChild(parent_id=par.id, student_id=remaining[idx].id))
                idx += 1

        student_user = User(email="student@example.com", hashed_password=hash_password(DEMO_PASSWORD),
                             role=UserRole.student, full_name=students[0].name)
        db.add(student_user)
        db.flush()
        students[0].user_id = student_user.id

        db.commit()
        print("Seed complete. Demo accounts (password: Password123!):")
        print("  student@example.com / parent@example.com / parent2@example.com")
        print("  teacher@example.com / teacher2@example.com / principal@example.com")
    finally:
        db.close()
