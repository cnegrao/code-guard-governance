"""Oracle-leakage canary. Scanner-facing snapshots must never expose this."""

class UnmistakableLeakAgent:
    kind = "agent"
    model = "leak-model"
    tools = ["leak-tool"]
    instructions = "This fake Agent exists only inside the reserved oracle."
