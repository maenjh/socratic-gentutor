"""
Langchain-compatible wrapper for SharedLLM
"""

import logging
from typing import Any, List, Optional
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.callbacks import CallbackManagerForLLMRun

from .shared_llm import get_shared_llm

logger = logging.getLogger(__name__)


class SharedLLMWrapper(BaseChatModel):
    """
    Langchain-compatible wrapper for SharedLLM (gpt-oss-120b)
    """
    
    model_name: str = "gpt-oss-120b"
    temperature: float = 0.3
    max_tokens: int = 8192
    
    def __init__(self, temperature: float = 0.3, max_tokens: int = 8192, model_name: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.temperature = temperature
        self.max_tokens = max_tokens
        self._llm = get_shared_llm(model_name=model_name)
        logger.info(
            f"✅ SharedLLMWrapper initialized (model={self._llm._model_name}, temp={temperature}, max_tokens={max_tokens})"
        )
    
    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        """
        Generate response using SharedLLM
        """
        # Convert langchain messages to prompt
        system_instruction = None
        user_messages = []
        
        for message in messages:
            if isinstance(message, SystemMessage):
                system_instruction = message.content
            elif isinstance(message, HumanMessage):
                user_messages.append(message.content)
            elif isinstance(message, AIMessage):
                # Skip AI messages for now (no multi-turn support yet)
                pass
        
        # Combine user messages
        prompt = "\n".join(user_messages)
        
        # Generate using SharedLLM
        try:
            response_text = self._llm.generate(
                prompt=prompt,
                max_new_tokens=self.max_tokens,
                temperature=self.temperature,
                system_instruction=system_instruction
            )
            
            # Create langchain response
            message = AIMessage(content=response_text)
            generation = ChatGeneration(message=message)
            
            return ChatResult(generations=[generation])
            
        except Exception as e:
            logger.error(f"Error in SharedLLM generation: {str(e)}")
            raise
    
    @property
    def _llm_type(self) -> str:
        """Return type of LLM"""
        return "shared-gpt-oss-120b"
    
    @property
    def _identifying_params(self) -> dict:
        """Return identifying parameters"""
        return {
            "model_name": self.model_name,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens
        }


def create_shared_llm_wrapper(temperature: float = 0.3, max_tokens: int = 6144, *, model_name: Optional[str] = None) -> SharedLLMWrapper:
    """
    Factory function to create SharedLLMWrapper
    """
    return SharedLLMWrapper(temperature=temperature, max_tokens=max_tokens, model_name=model_name)

