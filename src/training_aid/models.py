# Copyright (c) 2026 Philipp Kaaden
"""SQLModel persistence models for athletes, exercises, plans, and logs."""

import json
from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    """Return the current timezone-aware UTC timestamp."""
    return datetime.now(UTC)


class User(SQLModel, table=True):
    """Athlete profile and training preferences."""

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    equipment: str = Field(default="body_only")
    starting_intensity: str = Field(default="moderate")
    weekly_goal: int = Field(default=3, ge=1, le=7)
    active_plan_id: int | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)


class Exercise(SQLModel, table=True):
    """Catalog exercise entry seeded from free-exercise-db."""

    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    category: str = Field(default="strength", index=True)
    level: str = Field(default="beginner", index=True)
    equipment: str = Field(default="body only", index=True)
    primary_muscle: str = Field(default="other", index=True)
    secondary_muscles: str = Field(default="")
    instructions_json: str = Field(default="[]")
    image_url: str | None = Field(default=None)

    @property
    def instructions(self) -> list[str]:
        """Parse and return step-by-step exercise instructions."""
        try:
            return json.loads(self.instructions_json)
        except json.JSONDecodeError:
            return []


class TrainingPlan(SQLModel, table=True):
    """Multi-day weekly workout plan assigned to an athlete."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    name: str
    description: str = Field(default="")
    days_per_week: int = Field(default=3, ge=1, le=7)
    created_at: datetime = Field(default_factory=utc_now)


class WorkoutRoutine(SQLModel, table=True):
    """Single workout day within a training plan."""

    id: int | None = Field(default=None, primary_key=True)
    plan_id: int = Field(foreign_key="trainingplan.id", index=True)
    name: str
    day_order: int = Field(default=1)
    intensity_level: int = Field(default=0)

    @property
    def intensity_percent(self) -> int:
        """Return effective routine intensity percentage clamped to at least 50%."""
        return max(50, 100 + self.intensity_level * 10)


class RoutineExercise(SQLModel, table=True):
    """Ordered exercise prescription belonging to a workout routine."""

    id: int | None = Field(default=None, primary_key=True)
    routine_id: int = Field(foreign_key="workoutroutine.id", index=True)
    exercise_id: str = Field(foreign_key="exercise.id")
    order_index: int = Field(default=1)
    sets: int = Field(default=3, ge=1, le=20)
    base_reps: int = Field(default=10, ge=1, le=200)
    base_weight_kg: float | None = Field(default=None)


class WorkoutLog(SQLModel, table=True):
    """Completed workout session record and intensity feedback choice."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    plan_id: int | None = Field(default=None, index=True)
    routine_id: int | None = Field(default=None, index=True)
    routine_name: str
    completed_at: datetime = Field(default_factory=utc_now, index=True)
    duration_minutes: int = Field(default=25, ge=1)
    completed_exercises: int = Field(default=0, ge=0)
    total_exercises: int = Field(default=0, ge=0)
    intensity_at_session: int = Field(default=0)
    next_intensity_choice: str = Field(default="keep")

    @property
    def intensity_percent(self) -> int:
        """Return effective session intensity percentage clamped to at least 50%."""
        return max(50, 100 + self.intensity_at_session * 10)
