"""Synthetic benchmark input. No network or database operation is executed."""

from approval import require_human_approval
from tools import draft_care_plan, load_patient_record

MODEL_PROVIDER = "synthetic-ai"
MODEL_REFERENCE = "care-coordination-model-v1"
CARE_PROMPT = "Draft a care plan, then require human approval before release."
CARE_NETWORK_API = {
    "id": "care-network-api",
    "base_url": "https://care-network.invalid/v1/follow-ups",
}


def invoke_care_network_api(person_id: str) -> dict[str, str]:
    """Represent an external API invocation without performing network I/O."""
    return {
        "api_id": CARE_NETWORK_API["id"],
        "endpoint": CARE_NETWORK_API["base_url"],
        "person_id": person_id,
    }


class CareCoordinationAgent:
    kind = "agent"
    model = MODEL_REFERENCE
    instructions = CARE_PROMPT
    knowledge_base = "approved-care-handbook"
    tools = [load_patient_record, draft_care_plan, require_human_approval]

    def coordinate(self, person_id: str) -> dict[str, str]:
        record = load_patient_record(person_id)
        draft = draft_care_plan(record)
        approval = require_human_approval(draft)
        if approval != "approved":
            return {"status": "awaiting-human-approval"}
        follow_up = invoke_care_network_api(person_id)
        return {
            "status": "approved",
            "follow_up_api": follow_up["endpoint"],
        }
