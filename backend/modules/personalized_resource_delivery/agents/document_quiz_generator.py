from __future__ import annotations

from typing import Any, Mapping

from pydantic import BaseModel, Field, field_validator

from base import BaseAgent
from modules.personalized_resource_delivery.prompts.document_quiz_generator import (
    document_quiz_generator_system_prompt,
    document_quiz_generator_task_prompt,
)
from modules.personalized_resource_delivery.schemas import DocumentQuiz


class DocumentQuizPayload(BaseModel):
    learner_profile: Any
    learning_document: Any
    single_choice_count: int = 0
    multiple_choice_count: int = 0
    true_false_count: int = 0
    short_answer_count: int = 0

    @field_validator("learner_profile", "learning_document")
    @classmethod
    def coerce_jsonish(cls, v: Any) -> Any:
        if isinstance(v, BaseModel):
            return v.model_dump()
        if isinstance(v, Mapping):
            return dict(v)
        if isinstance(v, str):
            return v.strip()
        return v


class DocumentQuizGenerator(BaseAgent):
    name: str = "DocumentQuizGenerator"

    def __init__(self, model: Any):
        super().__init__(model=model, system_prompt=document_quiz_generator_system_prompt, jsonalize_output=True)

    def generate(self, payload: DocumentQuizPayload | Mapping[str, Any] | str):
        if not isinstance(payload, DocumentQuizPayload):
            payload = DocumentQuizPayload.model_validate(payload)
        raw_output = self.invoke(payload.model_dump(), task_prompt=document_quiz_generator_task_prompt)

        if isinstance(raw_output, str):
            from utils.llm_output import convert_json_output
            import json as _json
            import ast as _ast
            parsed = None
            try:
                parsed = convert_json_output(raw_output)
            except Exception:
                try:
                    parsed = _json.loads(raw_output)
                except Exception:
                    try:
                        parsed = _ast.literal_eval(raw_output)
                    except Exception:
                        parsed = self._empty_quiz()
            raw_output = parsed or self._empty_quiz()

        validated_output = DocumentQuiz.model_validate(raw_output)
        return validated_output.model_dump()

    @staticmethod
    def _empty_quiz() -> dict:
        return {
            "single_choice_questions": [],
            "multiple_choice_questions": [],
            "true_false_questions": [],
            "short_answer_questions": [],
        }


def generate_document_quizzes_with_llm(
    llm,
    learner_profile,
    learning_document,
    single_choice_count: int = 3,
    multiple_choice_count: int = 0,
    true_false_count: int = 0,
    short_answer_count: int = 0,
):
    gen = DocumentQuizGenerator(llm)

    # First attempt: single shot
    try:
        payload = {
            "learner_profile": learner_profile,
            "learning_document": learning_document,
            "single_choice_count": single_choice_count,
            "multiple_choice_count": multiple_choice_count,
            "true_false_count": true_false_count,
            "short_answer_count": short_answer_count,
        }
        return gen.generate(payload)
    except Exception:
        # Fallback: generate per type and merge to avoid truncation
        merged = {
            "single_choice_questions": [],
            "multiple_choice_questions": [],
            "true_false_questions": [],
            "short_answer_questions": [],
        }

        def safe_gen(sc: int, mc: int, tf: int, sa: int):
            try:
                pl = {
                    "learner_profile": learner_profile,
                    "learning_document": learning_document,
                    "single_choice_count": sc,
                    "multiple_choice_count": mc,
                    "true_false_count": tf,
                    "short_answer_count": sa,
                }
                return gen.generate(pl)
            except Exception:
                return {
                    "single_choice_questions": [],
                    "multiple_choice_questions": [],
                    "true_false_questions": [],
                    "short_answer_questions": [],
                }

        if single_choice_count:
            part = safe_gen(single_choice_count, 0, 0, 0)
            merged["single_choice_questions"] = part.get("single_choice_questions", [])

        if multiple_choice_count:
            part = safe_gen(0, multiple_choice_count, 0, 0)
            merged["multiple_choice_questions"] = part.get("multiple_choice_questions", [])

        if true_false_count:
            part = safe_gen(0, 0, true_false_count, 0)
            merged["true_false_questions"] = part.get("true_false_questions", [])

        if short_answer_count:
            part = safe_gen(0, 0, 0, short_answer_count)
            merged["short_answer_questions"] = part.get("short_answer_questions", [])

        return merged
