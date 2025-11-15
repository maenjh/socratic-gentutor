from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Dict, Optional, TypeAlias
import logging

from pydantic import BaseModel, Field, ValidationError
from base import BaseAgent
from ..prompts.skill_requirement_mapper import skill_requirement_mapper_system_prompt, skill_requirement_mapper_task_prompt
from ..schemas import SkillRequirements


JSONDict: TypeAlias = Dict[str, Any]
logger = logging.getLogger(__name__)

_TRIVIAL_MARKERS = (
	"basic",
	"basics",
	"beginner",
	"fundamentals",
	"intro",
	"introduction",
	"for beginners",
	"for dummies",
)

class Goal2SkillPayload(BaseModel):
	"""Payload for mapping a learning goal to required skills (validated)."""

	learning_goal: str = Field(...)
	reinforcement: str = Field("", description="Additional dynamic directives injected at runtime.")


class SkillRequirementMapper(BaseAgent):
	"""Agent wrapper for mapping a goal to required skills."""

	name: str = "SkillRequirementMapper"

	def __init__(self, model: Any) -> None:
		super().__init__(
			model=model,
			system_prompt=skill_requirement_mapper_system_prompt,
			jsonalize_output=True,
		)

	def map_goal_to_skill(self, input_dict: Mapping[str, Any]) -> JSONDict:
		payload_dict = Goal2SkillPayload(**input_dict).model_dump()
		task_prompt = skill_requirement_mapper_task_prompt
		default_reinforcement = (
			"MANDATORY RULES: emit 4-6 unique, professionally challenging skills. "
			"Keep them tightly aligned with the goal wording, avoid trivial 'basics' or introductory content, "
			"and prefer intermediate/advanced required levels unless the goal explicitly requests beginner coverage."
		)
		max_attempts = 3
		last_error: Optional[Exception] = None

		for attempt in range(max_attempts):
			if attempt == 0:
				extra_clarifier = default_reinforcement
			elif attempt == 1:
				extra_clarifier = (
					f"{default_reinforcement} PRIOR ATTEMPT FAILED. Obey every rule precisely, produce dense technical phrasing, "
					"and eliminate overlaps between skills."
				)
			else:
				extra_clarifier = (
					f"{default_reinforcement} FINAL ATTEMPT. Correct the last error immediately and do NOT return beginner-level "
					"skills unless the goal literally includes beginner keywords."
				)

			payload_dict["reinforcement"] = extra_clarifier

			try:
				raw_output = self.invoke(payload_dict, task_prompt=task_prompt)
				validated = SkillRequirements.model_validate(raw_output)
				result = validated.model_dump()

				skills = result.get("skill_requirements", [])
				if not skills:
					raise ValueError("No skills returned.")

				if not 4 <= len(skills) <= 6:
					raise ValueError(f"Expected 4-6 skills, got {len(skills)}.")

				goal_text = payload_dict["learning_goal"].lower()
				allow_beginner = any(
					marker in goal_text for marker in ("beginner", "basic", "intro", "fundamental", "novice")
				)

				trivial_hits = [
					skill for skill in skills if any(marker in skill["name"].lower() for marker in _TRIVIAL_MARKERS)
				]
				if trivial_hits and not allow_beginner:
					raise ValueError(f"Trivial skill phrases detected: {[skill['name'] for skill in trivial_hits]}")

				if not allow_beginner:
					beginner_levels = [skill for skill in skills if skill["required_level"] == "beginner"]
					if beginner_levels:
						raise ValueError(
							f"Beginner required levels detected without explicit beginner intent: "
							f"{[skill['name'] for skill in beginner_levels]}"
						)

				return result
			except (ValidationError, ValueError) as exc:
				last_error = exc
				logger.warning(
					"[SkillRequirementMapper] Attempt %d failed for goal '%s': %s",
					attempt + 1,
					payload_dict.get("learning_goal"),
					exc,
				)

		assert last_error is not None
		raise last_error


def map_goal_to_skills_with_llm(llm: Any, learning_goal: str) -> JSONDict:
	mapper = SkillRequirementMapper(llm)
	return mapper.map_goal_to_skill({"learning_goal": learning_goal})

