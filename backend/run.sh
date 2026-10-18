#!/usr/bin/env bash
# ============================================================
# KPRIET COE Assistant — Quick-start script (CPU/GPU auto-detect)
# ============================================================
#
# This script launches the two llama.cpp servers (base + reasoning)
# and the FastAPI backend. Models MUST pre-exist under ../models/.
#
# The script auto-detects an NVIDIA GPU via `nvidia-smi` and switches
# flags automatically:
#   - GPU present: full offload (--n-gpu-layers -1), --parallel 32,
#                  --cont-batch, --ctx-size 32768, host 0.0.0.0
#   - CPU only:    no GPU offload, --parallel 4, --cont-batch,
#                  --ctx-size 8192, host 127.0.0.1
#
# Usage:
#   chmod +x run.sh
#   ./run.sh          # starts all three services (auto-detects GPU)
#
# Ctrl-C kills all services.
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

LLAMA_SERVER="$HOME/llama.cpp/build/bin/llama-server"

# Colour helpers (optional)
RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
NC=$(tput sgr0 2>/dev/null || true)

# --- Validate prerequisites --------------------------------
if [ ! -x "$LLAMA_SERVER" ]; then
    echo "${RED}[ERROR] llama-server not found at $LLAMA_SERVER${NC}"
    echo "Build llama.cpp from https://github.com/ggml-org/llama.cpp"
    echo "For GPU support, build with: cmake .. -DGGML_CUDA=ON"
    exit 1
fi

# --- Auto-detect GPU ---------------------------------------
# nvidia-smi available + llama-server links libggml-cuda → GPU mode.
HAS_GPU=false
GPU_FLAGS=""
NGL_FLAG=""
HOST="127.0.0.1"
CTX_SIZE=8192
PARALLEL=4
BATCH_SIZE=512
UBATCH_SIZE=256

if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    if ldd "$LLAMA_SERVER" 2>/dev/null | grep -qi "libggml-cuda\|libcuda\|libcublas"; then
        HAS_GPU=true
        GPU_FLAGS="--n-gpu-layers -1"
        NGL_FLAG="-1"
        HOST="0.0.0.0"
        CTX_SIZE=32768
        PARALLEL=32
        BATCH_SIZE=1024
        UBATCH_SIZE=256
        echo "${GREEN}[GPU] Detected NVIDIA GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader)${NC}"
        echo "${GREEN}[GPU] Full offload, --parallel 32, --cont-batch, ctx ${CTX_SIZE}${NC}"
    else
        echo "${YELLOW}[GPU] nvidia-smi present but llama-server is CPU-only build.${NC}"
        echo "${YELLOW}[GPU] Falling back to CPU mode. Rebuild llama-server with -DGGML_CUDA=ON${NC}"
    fi
else
    echo "${GREEN}[CPU] No NVIDIA GPU detected — running in CPU mode${NC}"
    echo "${GREEN}[CPU] Light batching: --parallel 4, --cont-batch, ctx ${CTX_SIZE}${NC}"
fi

# --- Helper: start a llama-server instance ------------------
start_server() {
    local label="$1"
    local model_path="$PROJECT_ROOT/$2"
    local port="$3"
    echo "${GREEN}[${label}] Starting on port ${port} ...${NC}"
    "$LLAMA_SERVER" \
        -m "$model_path" \
        --port "$port" \
        --host "$HOST" \
        --ctx-size "$CTX_SIZE" \
        $GPU_FLAGS \
        --threads 8 \
        --parallel "$PARALLEL" \
        --cont-batching \
        --batch-size "$BATCH_SIZE" \
        --ubatch-size "$UBATCH_SIZE" \
        --log-disable &
}

# --- Helper: wait for server to be ready --------------------
wait_for_server() {
    local port="$1"
    local label="$2"
    local max_wait=120
    local waited=0
    echo "${GREEN}[${label}] Waiting for model to load (max ${max_wait}s)...${NC}"
    while [ $waited -lt $max_wait ]; do
        if curl -sf "http://${HOST}:${port}/v1/models" >/dev/null 2>&1; then
            echo "${GREEN}[${label}] Ready on port ${port}${NC}"
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
        printf "."
    done
    echo "${RED}[${label}] Timeout after ${max_wait}s${NC}"
    return 1
}

# --- Start Base Model (:8080) --------------------------------
start_server "BASE" "models/base/Qwen3.5-4B-Q5_K_M.gguf" 8080

# --- Start Reasoning Model (:8081) ---------------------------
start_server "REASONING" "models/reasoning/Qwen3.5-4B-Q5_K_M.gguf" 8081

# --- Wait for both servers to be ready -----------------------
wait_for_server 8080 "BASE" || exit 1
wait_for_server 8081 "REASONING" || exit 1

# --- Start FastAPI backend -----------------------------------
echo "${GREEN}[FastAPI] Starting backend on :8000 ...${NC}"
cd "$SCRIPT_DIR"
exec uvicorn app.main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --reload \
    --log-level info