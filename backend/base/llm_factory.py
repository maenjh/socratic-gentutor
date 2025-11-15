import logging
import os
from typing import Optional, Union, Any, Dict
from omegaconf import DictConfig, OmegaConf
from utils.config import ensure_config_dict

from langchain_core.language_models import BaseChatModel
from langchain.chat_models import init_chat_model
from dotenv import load_dotenv
load_dotenv(override=True)

# Import SharedLLM wrapper
from .shared_llm_wrapper import create_shared_llm_wrapper

logger = logging.getLogger(__name__)


class LLMFactory:

    @staticmethod
    def create(
        model: Optional[str] = None,
        model_provider: Optional[str] = None,
        temperature: float = 0.3,  # Increased from 0 for better JSON generation
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        use_shared_llm: bool = True,  # Use SharedLLM by default
        **kwargs
    ) -> BaseChatModel:
        """Initialize LLM client with model parameters.

        Args:
            model: Model name (e.g., 'gpt-4', 'claude-3-5-sonnet-20241022')
            model_provider: Provider name (e.g., 'openai', 'anthropic', 'ollama', 'shared')
            temperature: Temperature for model responses (default: 0)
            base_url: Custom base URL for API endpoint
            api_key: Custom API key
            use_shared_llm: Whether to use SharedLLM (Qwen2.5-7B-Instruct) - default True
            llm: Pre-configured LLM instance (if provided, other params ignored)
            **kwargs: Additional parameters passed to init_chat_model

        Raises:
            ValueError: If neither llm nor model is provided
        """
        # Determine which shared model to load
        shared_model_override = kwargs.pop("shared_model_name", None)

        if use_shared_llm or model_provider in ["shared", "gpt-oss", "chatbot", None]:
            if model_provider in ["gpt-oss", "chatbot"]:
                target_model = shared_model_override or os.getenv("CHATBOT_MODEL_NAME")
                if not target_model:
                    logger.warning("CHATBOT_MODEL_NAME not set; falling back to SHARED_MODEL_NAME")
                    target_model = os.getenv("SHARED_MODEL_NAME")
            else:
                target_model = shared_model_override or os.getenv("SHARED_MODEL_NAME")

            if not target_model:
                target_model = "deepseek/deepseek-chat-7b-instruct"

            logger.info("🚀 Using SharedLLM (%s)", target_model)
            max_tokens = kwargs.get("max_tokens", 4096)  # Increased from 512 to avoid truncation
            return create_shared_llm_wrapper(
                temperature=temperature,
                max_tokens=max_tokens,
                model_name=target_model,
            )
        
        # Fall back to external API models
        if model is None:
            model = "claude-3-5-sonnet-20241022"
            model_provider = model_provider or "anthropic"

        config_kwargs = {
            "model": model,
            "model_provider": model_provider,
            "temperature": temperature,
            **kwargs
        }

        if base_url is not None:
            config_kwargs["base_url"] = base_url

        if api_key is not None:
            config_kwargs["api_key"] = api_key
        elif base_url is not None and model_provider == "openai":
            config_kwargs["api_key"] = "dummy-key-for-vllm"

        llm = init_chat_model(**config_kwargs)
        return llm

    @classmethod
    def from_config(cls, config: Union[DictConfig, OmegaConf, Dict[str, Any]]) -> BaseChatModel:
        """Initialize LLM client from WorkflowConfig.

        This is a convenience method that extracts LLM parameters from
        WorkflowConfig and creates an LLM instance.

        Args:
            config: Workflow configuration containing model settings

        Returns:
            LLM instance initialized from config
        """
        config = ensure_config_dict(config)
        
        # Check if SharedLLM should be used
        model_provider = config.get("model_provider", "shared")
        use_shared = config.get("use_shared_llm", True)
        
        if use_shared or model_provider in ["shared", "gpt-oss", "chatbot"]:
            if model_provider in ["gpt-oss", "chatbot"]:
                target_model = config.get("shared_model_name") or os.getenv("CHATBOT_MODEL_NAME")
                if not target_model:
                    logger.warning("CHATBOT_MODEL_NAME not set; falling back to SHARED_MODEL_NAME")
                    target_model = os.getenv("SHARED_MODEL_NAME")
            else:
                target_model = config.get("shared_model_name") or os.getenv("SHARED_MODEL_NAME")

            if not target_model:
                target_model = "deepseek/deepseek-chat-7b-instruct"

            logger.info("🚀 Using SharedLLM (%s) from config", target_model)
            return create_shared_llm_wrapper(
                temperature=config.get("temperature", 0.3),  # Increased default for better JSON
                max_tokens=config.get("max_tokens", 8192),
                model_name=target_model,
            )
        
        # Fall back to external models
        return init_chat_model(
            model=config.get("model_name", "deepseek-chat"),
            model_provider=model_provider,
            base_url=config.get("base_url", None),
            # api_key=config.api_key,
            temperature=config.get("temperature", 0),
        )
    

if __name__ == "__main__":
    llm = LLMFactory.create(
        model="meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
        model_provider="together",
        temperature=0
    )


    conversation = [
        {"role": "system", "content": "You are a helpful assistant that translates English to French."},
        {"role": "user", "content": "Translate: I love programming."},
        {"role": "assistant", "content": "J'adore la programmation."},
        {"role": "user", "content": "Translate: I love building applications."}
    ]


    from langchain.agents import create_agent
    agent = create_agent(
        model=llm,
        tools=[],
        system_prompt="You are a helpful assistant."
    )
    result = agent.invoke({"input": "What is the capital of Germany?"})
    print(result['messages'][-1].content)