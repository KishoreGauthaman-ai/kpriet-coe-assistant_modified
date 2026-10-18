# ===== KPRIET COE Assistant — Backend (FastAPI) =====
# Python 3.10-slim base; builds llama-cpp-python from source for the
# in-process bge-m3 embedder. No CUDA in this image (CPU-only); set
# EMBED_N_GPU_LAYERS=0 (default). For GPU support, use a CUDA base image
# and install nvidia-runtime.

FROM python:3.10-slim AS base

# --- System deps for building llama-cpp-python + ffmpeg for voice ---
RUN --mount=type=cache,target=/var/cache/apt,id=backend-apt-cache \
    --mount=type=cache,target=/var/lib/apt,id=backend-apt-lib \
    apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake git ffmpeg libsndfile1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps — use prebuilt llama-cpp-python wheel to avoid long source build
COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu "llama-cpp-python==0.3.34" && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Data & models are mounted as volumes at runtime
VOLUME ["/app/data", "/models"]

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ENV=prod \
    HOST=0.0.0.0 \
    PORT=8000 \
    FRONTEND_URL=http://127.0.0.1:5173 \
    BASE_SERVER_URL=http://llama-base:8080 \
    REASONING_SERVER_URL=http://llama-reasoning:8081 \
    DATA_DIR=/data \
    RAW_DOCS_DIR=/data/raw_documents \
    VECTOR_DB_DIR=/data/vector_db \
    SQLITE_PATH=/data/sqlite_db/coassistant.db \
    EMBEDDING_MODEL_PATH=/models/embedding/bge-m3-Q5_K_M.gguf \
    VOICE_MODEL_PATH=/models/faster-whisper-small \
    EMBED_N_GPU_LAYERS=0

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]