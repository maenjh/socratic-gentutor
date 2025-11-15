# GenMentor Backend Dockerfile
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    DEBIAN_FRONTEND=noninteractive \
    SHARED_MODEL_PATH=/root/.cache/huggingface

# Install Python and system dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3.10 \
        python3-pip \
        gcc \
        g++ \
        git \
        curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN python3.10 -m pip install --no-cache-dir --upgrade pip

# Copy requirements file
COPY requirements.txt .

# Install PyTorch and CUDA dependencies first (for better caching)
RUN pip install --no-cache-dir \
    torch>=2.3.0 \
    transformers>=4.40.0 \
    accelerate>=0.30.0

# Install other Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 5000

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]

