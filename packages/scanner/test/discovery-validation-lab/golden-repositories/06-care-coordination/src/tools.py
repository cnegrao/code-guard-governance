"""Synthetic tools. Functions return placeholders and perform no I/O."""


def load_patient_record(person_id: str) -> dict[str, str]:
    return {
        "person_id": person_id,
        "contact_email": "synthetic@example.invalid",
        "diagnosis": "synthetic-condition",
        "birth_date": "2000-01-01",
    }


def draft_care_plan(record: dict[str, str]) -> str:
    return f"synthetic-plan:{record['person_id']}"
