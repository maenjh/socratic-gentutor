from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Dict, Optional, Tuple, TypeAlias
import logging

from pydantic import BaseModel, Field, ValidationError
from base import BaseAgent
from ..prompts.skill_gap_identifier import skill_gap_identifier_system_prompt, skill_gap_identifier_task_prompt
from ..schemas import SkillRequirements, SkillGaps
from .skill_requirement_mapper import SkillRequirementMapper
from .learning_goal_refiner import LearningGoalRefiner

JSONDict: TypeAlias = Dict[str, Any]
logger = logging.getLogger(__name__)


class SkillGapPayload(BaseModel):
    """Payload for identifying skill gaps (validated)."""

    learning_goal: str = Field(...)
    learner_information: str = Field(...)
    skill_requirements: Dict[str, Any] = Field(...)
    reinforcement: str = Field("", description="Additional dynamic directives injected at runtime.")


class SkillGapIdentifier(BaseAgent):
    """Agent wrapper for skill requirement discovery and gap identification."""

    name: str = "SkillGapIdentifier"

    def __init__(self, model: Any, ) -> None:
        super().__init__(
            model=model,
            system_prompt=skill_gap_identifier_system_prompt,
            jsonalize_output=True,
        )

    def identify_skill_gap(
        self,
        input_dict: Mapping[str, Any],
    ) -> JSONDict:
        """Identify knowledge gaps using learner information and expected skills."""
        payload_dict = SkillGapPayload(**input_dict).model_dump()
        task_prompt = skill_gap_identifier_task_prompt

        requirements = payload_dict["skill_requirements"]
        requirement_list = requirements.get("skill_requirements", []) if isinstance(requirements, dict) else []
        requirement_lookup = {item["name"].strip().lower(): item for item in requirement_list if isinstance(item, dict)}

        default_reinforcement = (
            "MANDATORY RULES: emit 4-6 skill_gaps, covering every incoming required skill. "
            "Reuse the exact skill names when possible, keep required_level identical to inputs, "
            "and ground each reason in explicit learner evidence (15-30 words). "
            "Avoid labelling someone beginner/advanced without quoting signals."
        )
        max_attempts = 3
        last_error: Optional[Exception] = None

        for attempt in range(max_attempts):
            if attempt == 0:
                extra_clarifier = default_reinforcement
            elif attempt == 1:
                extra_clarifier = (
                    f"{default_reinforcement} PRIOR ATTEMPT FAILED. Precisely match requirement names/levels, "
                    "eliminate duplicates, and tighten evidence references."
                )
            else:
                extra_clarifier = (
                    f"{default_reinforcement} FINAL ATTEMPT. Fix the prior violation immediately and ensure each reason cites "
                    "specific projects, achievements, or missing evidence."
                )

            payload_dict["reinforcement"] = extra_clarifier

            try:
                raw_output = self.invoke(payload_dict, task_prompt=task_prompt)
                validated = SkillGaps.model_validate(raw_output)
                result = validated.model_dump()

                gaps = result.get("skill_gaps", [])
                if not gaps:
                    raise ValueError("No skill gaps returned.")

                if not 4 <= len(gaps) <= 6:
                    raise ValueError(f"Expected 4-6 skill gaps, got {len(gaps)}.")

                normalized_gap_names = set()
                for gap in gaps:
                    name = gap["name"].strip()
                    lower_name = name.lower()
                    if lower_name in normalized_gap_names:
                        raise ValueError(f"Duplicate skill gap detected: {name}")
                    normalized_gap_names.add(lower_name)

                    if lower_name in requirement_lookup:
                        expected_level = requirement_lookup[lower_name]["required_level"]
                        if gap["required_level"] != expected_level:
                            raise ValueError(
                                f"Required level mismatch for '{name}': expected '{expected_level}', got '{gap['required_level']}'."
                            )

                missing = [item_name for item_name in requirement_lookup.keys() if item_name not in normalized_gap_names]
                if missing:
                    raise ValueError(f"Missing required skills in gaps output: {missing}")

                return result
            except (ValidationError, ValueError) as exc:
                last_error = exc
                logger.warning(
                    "[SkillGapIdentifier] Attempt %d failed for goal '%s': %s",
                    attempt + 1,
                    payload_dict.get("learning_goal"),
                    exc,
                )

        assert last_error is not None
        raise last_error

def identify_skill_gap_with_llm(
    llm: Any,
    learning_goal: str,
    learner_information: str,
    skill_requirements: Optional[Dict[str, Any]] = None,
) -> Tuple[JSONDict, JSONDict]:
    """Identify skill gaps and return both the gaps and the skill requirements used."""

    refined_goal = learning_goal
    try:
        refiner = LearningGoalRefiner(llm)
        refined_output = refiner.refine_goal(
            {
                "learning_goal": learning_goal,
                "learner_information": learner_information,
            }
        )
        candidate = refined_output.get("refined_goal")
        if isinstance(candidate, str) and len(candidate.strip()) >= 5:
            refined_goal = candidate.strip()
    except Exception as exc:
        logger.warning("[SkillGapIdentifier] Goal refinement failed, using original goal: %s", exc)

    # Compute requirements if not provided
    if not skill_requirements:
        mapper = SkillRequirementMapper(llm)
        effective_requirements = mapper.map_goal_to_skill({"learning_goal": refined_goal})
    else:
        effective_requirements = skill_requirements

    skill_gap_identifier = SkillGapIdentifier(llm)
    skill_gaps = skill_gap_identifier.identify_skill_gap(
        {
            "learning_goal": refined_goal,
            "learner_information": learner_information,
            "skill_requirements": effective_requirements,
        },
    )
    return skill_gaps, effective_requirements

if __name__ == "__main__":
    # python -m modules.skill_gap_identification.agents.skill_gap_identifier
    from base.llm_factory import LLMFactory

    llm = LLMFactory.create(model="deepseek-chat", model_provider="deepseek")

    learning_goal = "Become proficient in data science."
    learner_information = "I have a background in statistics but limited programming experience."

    skill_gaps, skill_requirements = identify_skill_gap_with_llm(
        llm,
        learning_goal,
        learner_information,
    )

    print("Identified Skill Gap:", skill_gaps)
    print("Skill Requirements Used:", skill_requirements)