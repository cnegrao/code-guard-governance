"""Explicit human-in-the-loop gate for the synthetic benchmark."""


def require_human_approval(draft: str) -> str:
    if not draft.startswith("synthetic-plan:"):
        return "rejected"
    return "pending-human-review"
