# Copyright (c) 2026 Philipp Kaaden
"""Training Aid web application package."""

import uvicorn


def main() -> None:
    """Run the Training Aid Uvicorn web server."""
    uvicorn.run("training_aid.main:app", host="127.0.0.1", port=8000, reload=False)
