"""
SharedLLM - Singleton LLM instance for efficient GPU memory usage
Based on edumcp's SharedLLM implementation
"""

import logging
import os
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from typing import Optional

logger = logging.getLogger(__name__)

class SharedLLM:
    """
    Singleton class to manage shared LLM instances across multiple services.
    Caches models per `model_name` to avoid duplicate loads.
    """
    _instances: dict[str, "SharedLLM"] = {}

    def __new__(cls, model_name: str):
        if model_name not in cls._instances:
            instance = super(SharedLLM, cls).__new__(cls)
            instance._initialize(model_name=model_name)
            cls._instances[model_name] = instance
        return cls._instances[model_name]

    def _initialize(self, model_name: str):
        """Initialize the model and tokenizer"""
        self._model_name = model_name
        self._model = None
        self._tokenizer = None
        self._device = None

        # Determine device
        if torch.cuda.is_available():
            self._device = torch.device("cuda:0")  # Use GPU 0 inside container
            try:
                gpu_name = torch.cuda.get_device_name(0)
            except Exception:
                gpu_name = "cuda:0"
            logger.info(f"🎮 Using GPU: {gpu_name}")
        else:
            self._device = torch.device("cpu")
            logger.warning("⚠️ GPU not available, using CPU")

        try:
            logger.info(f"🔄 Loading SharedLLM model: {model_name}")

            self._tokenizer = AutoTokenizer.from_pretrained(
                model_name,
                trust_remote_code=True
            )

            self._model = AutoModelForCausalLM.from_pretrained(
                model_name,
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                device_map={"": self._device},
                trust_remote_code=True
            )

            self._model.eval()  # Set to evaluation mode

            logger.info("✅ SharedLLM initialized successfully!")

            if torch.cuda.is_available():
                allocated = torch.cuda.memory_allocated(0) / 1024**3
                reserved = torch.cuda.memory_reserved(0) / 1024**3
                logger.info(f"📊 GPU Memory - Allocated: {allocated:.2f}GB, Reserved: {reserved:.2f}GB")

        except Exception as e:
            logger.error(f"❌ Failed to initialize SharedLLM ({model_name}): {str(e)}")
            raise

    def generate(
        self,
        prompt: str,
        max_new_tokens: int = 512,
        temperature: float = 0.7,
        top_p: float = 0.9,
        system_instruction: Optional[str] = None
    ) -> str:
        """
        Generate text using the shared LLM
        
        Args:
            prompt: Input prompt
            max_new_tokens: Maximum number of tokens to generate
            temperature: Sampling temperature
            top_p: Nucleus sampling parameter
            system_instruction: Optional system instruction
            
        Returns:
            Generated text
        """
        if self._model is None or self._tokenizer is None:
            raise RuntimeError("SharedLLM not initialized")

        try:
            # Prepare messages
            messages = []
            if system_instruction:
                messages.append({"role": "system", "content": system_instruction})
            messages.append({"role": "user", "content": prompt})
            
            # Apply chat template
            text = self._tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True
            )
            
            # Tokenize
            inputs = self._tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=2048
            ).to(self._device)
            
            # Generate
            # Ensure temperature is > 0 (Transformers requirement)
            safe_temperature = max(temperature, 0.01) if temperature == 0 else temperature
            
            with torch.no_grad():
                outputs = self._model.generate(
                    **inputs,
                    max_new_tokens=max_new_tokens,
                    temperature=safe_temperature,
                    top_p=top_p,
                    do_sample=True,  # Enable sampling for better completion
                    repetition_penalty=1.05,  # Prevent repetition and encourage continuation
                    pad_token_id=self._tokenizer.pad_token_id,
                    eos_token_id=self._tokenizer.eos_token_id
                )
            
            # Decode
            generated_text = self._tokenizer.decode(
                outputs[0][inputs['input_ids'].shape[1]:],
                skip_special_tokens=True
            )
            
            return generated_text.strip()
            
        except Exception as e:
            logger.error(f"Error during generation: {str(e)}")
            raise

    @property
    def device(self):
        return self._device


# Global function to get shared LLM instance
_DEFAULT_MODEL = os.getenv("SHARED_MODEL_NAME", "deepseek/deepseek-chat-7b-instruct")


def get_shared_llm(model_name: Optional[str] = None) -> SharedLLM:
    """Get the singleton SharedLLM instance for a given model"""
    target_model = model_name or _DEFAULT_MODEL
    return SharedLLM(target_model)

