import os
from collections.abc import Generator
from pathlib import Path
from sqlmodel import Session, SQLModel, create_engine

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = PROJECT_ROOT / "training_aid.db"
DATABASE_URL = os.environ.get("TRAINING_AID_DB_URL", f"sqlite:///{DEFAULT_DB_PATH}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


def create_db_and_tables(db_engine=engine) -> None:
    SQLModel.metadata.create_all(db_engine)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
