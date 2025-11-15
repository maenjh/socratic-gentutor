from typing import Any, Dict, Optional, Sequence

try:
    from langgraph.prebuilt import create_react_agent as create_agent
except ImportError:
    try:
        from langchain.agents import create_agent
    except ImportError:
        create_agent = None
        
from langchain_core.language_models import BaseChatModel

from utils.llm_output import preprocess_response, convert_json_output
from json import JSONDecodeError
from langchain_core.messages import SystemMessage, HumanMessage

# Try to import langgraph types, but make them optional
try:
    from langgraph.typing import InputT, OutputT, StateT
except ImportError:
    InputT = Any
    OutputT = Any
    StateT = Any

# Simplified type hints (middleware types don't exist in current langchain)
_InputAgentState = Dict[str, Any]
_OutputAgentState = Dict[str, Any]

valid_agent_arg_list = [
    "middleware",
    "response_format",
    "state_schema",
    "context_schema",
    "checkpointer",
    "store",
    "interrupt_before",
    "interrupt_after",
    "debug",
    "name",
    "cache"
]


class BaseAgent:

    def __init__(
            self,
            model: BaseChatModel,
            system_prompt: Optional[str] = None,
            tools: Optional[list[Any]] = None,
            **kwargs
        ) -> None:
        """Initialize a base agent with JSON output and validation."""
        self._model = model
        self._system_prompt = system_prompt
        self._tools = tools
        self._agent_kwargs = {k: v for k, v in kwargs.items() if k in valid_agent_arg_list}
        self._agent = self._build_agent()
        self.exclude_think = kwargs.get("exclude_think", True)
        self.jsonalize_output = kwargs.get("jsonalize_output", True)

    def _build_agent(self):
        # LangGraph's create_react_agent uses 'prompt' parameter
        return create_agent(
            model=self._model,
            tools=self._tools or [],
            prompt=self._system_prompt,  # Can be SystemMessage, str, or None
            **self._agent_kwargs,
        )

    def set_prompts(self, system_prompt: Optional[str] = None, task_prompt: Optional[str] = None) -> None:
        """Set or update system/task prompts and rebuild the internal agent if needed."""
        if system_prompt is not None:
            self._system_prompt = system_prompt
        if task_prompt is not None:
            self._task_prompt = task_prompt
        self._agent = self._build_agent()

    def _build_prompt(self, variables: Dict[str, Any], task_prompt: Optional[str] = None) -> _InputAgentState:
        """Build chat messages for model call."""
        assert task_prompt is not None, "Either self._task_prompt or task_prompt must be provided."
        task_prompt = task_prompt
        formatted_task = task_prompt.format(**variables)  # type: ignore[union-attr]
        prompt = {
            "messages": [
                {"role": "user", "content": formatted_task}
            ]
        }
        return prompt

    def invoke(self, input_dict: dict, task_prompt: Optional[str] = None) -> Any:
        """Invoke the agent with the given input text."""
        input_prompt = self._build_prompt(input_dict, task_prompt=task_prompt)
        raw_output = self._agent.invoke(input_prompt)
        try:
            output = preprocess_response(
                raw_output, only_text=True, exclude_think=self.exclude_think, json_output=self.jsonalize_output
            )
            return output
        except JSONDecodeError:
            # Attempt a self-healing JSON repair using the base model directly
            if not self.jsonalize_output:
                raise

            repair_system = "You are a strict JSON reformatter. Return ONLY valid JSON. No code fences, no prose."
            repair_user = (
                "Fix the following content into a valid JSON that strictly matches the 'Final Output Format'\n"
                "described in the instruction below. If fields are missing, infer minimal placeholders.\n\n"
                f"Instruction (schema hint):\n{self._system_prompt}\n\n"
                f"Content to fix:\n{raw_output}"
            )
            # Build messages for direct model call
            messages = [
                SystemMessage(content=repair_system),
                HumanMessage(content=repair_user),
            ]
            repaired = self._model.invoke(messages)
            # Extract text and convert to JSON
            repaired_text = preprocess_response(
                repaired, only_text=True, exclude_think=True, json_output=False
            )
            return convert_json_output(repaired_text)
