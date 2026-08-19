from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base

engine = create_engine("sqlite:///./xyzai.db", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    # This project intentionally has no migrations framework. Add the contact
    # request lifecycle fields for existing local SQLite databases as well as
    # new installations created by create_all above.
    with engine.begin() as connection:
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(escalations)")}
        if columns:
            if "status" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE escalations ADD COLUMN status VARCHAR NOT NULL DEFAULT 'pending'"
                )
            if "responder_id" not in columns:
                connection.exec_driver_sql("ALTER TABLE escalations ADD COLUMN responder_id INTEGER")
            if "responded_at" not in columns:
                connection.exec_driver_sql("ALTER TABLE escalations ADD COLUMN responded_at DATETIME")
