"""Synthetic benchmark input. It is not intended to run."""

MODEL_PROVIDER = "synthetic-ai"
MODEL_REFERENCE = "support-model-v1"
SUPPORT_PROMPT = "Assist with account questions using only approved records."


def lookup_customer(customer_id: str) -> dict[str, str]:
    """Declared Agent tool backed by the synthetic customers table."""
    return {"customer_id": customer_id, "status": "synthetic"}


class CustomerSupportAgent:
    kind = "agent"
    model = MODEL_REFERENCE
    instructions = SUPPORT_PROMPT
    tools = [lookup_customer]

    def answer(self, customer_id: str) -> str:
        customer = lookup_customer(customer_id)
        return f"Support context prepared for {customer['customer_id']}"
