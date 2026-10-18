#!/usr/bin/env bash
# ============================================================
# KPRIET COE Assistant — Rebuild llama-server with CUDA backend
# ============================================================
# Run this on the GPU host AFTER installing:
#   1. NVIDIA driver (>= 525)  →  verify: nvidia-smi
#   2. CUDA Toolkit 12.4       →  verify: nvcc --version
#   3. CMake >= 3.22           →  verify: cmake --version
#   4. Build tools (gcc, git)  →  verify: gcc --version
#
# This script:
#   - clones llama.cpp (pins to a stable tag matching the bundled CPU build)
#   - builds with -DGGML_CUDA=ON
#   - copies the resulting CUDA-enabled binaries into llama-server/bin/
#
# 5-minute one-time setup. After running this, `docker compose up` with
# docker-compose.gpu.yml will fully use the NVIDIA L4 GPU.
# ============================================================
set -e

# --- Config --------------------------------------------------
LLAMA_REPO="https://github.com/ggml-org/llama.cpp.git"
# Pin to the build tag matching the bundled CPU binary revision (b10146).
# Update this if the bundled libs show a different version.
LLAMA_TAG="b10146"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/llama-server/bin"
BUILD_DIR="$HOME/llama.cpp-cuda"

# --- Preflight checks ----------------------------------------
echo "Checking prerequisites..."

if ! command -v nvidia-smi &>/dev/null; then
    echo "ERROR: nvidia-smi not found. Install NVIDIA driver >= 525 first."
    exit 1
fi

if ! command -v nvcc &>/dev/null; then
    echo "ERROR: nvcc not found. Install CUDA Toolkit 12.4 first."
    exit 1
fi

if ! command -v cmake &>/dev/null; then
    echo "ERROR: cmake not found. Install cmake >= 3.22 first."
    exit 1
fi

echo "  nvidia-smi found: $(nvidia-smi --query-gpu=name --format=csv,noheader)"
echo "  nvcc version:     $(nvcc --version | grep release)"
echo "  cmake version:    $(cmake --version | head -n1)"
echo ""

# --- Back up the existing CPU-only binary --------------------
echo "Backing up CPU-only llama-server binaries to bin/cpu-backup/"
mkdir -p "$BIN_DIR/cpu-backup"
cp -n "$BIN_DIR/llama-server"          "$BIN_DIR/cpu-backup/" 2>/dev/null || true
cp -n "$BIN_DIR"/lib*.so*               "$BIN_DIR/cpu-backup/" 2>/dev/null || true
echo "  CPU backup saved to: $BIN_DIR/cpu-backup/"
echo ""

# --- Clone and build -------------------------------------------
if [ -d "$BUILD_DIR" ]; then
    echo "Existing llama.cpp build dir found at $BUILD_DIR — pulling latest..."
    cd "$BUILD_DIR"
    git fetch --tags
    git checkout "$LLAMA_TAG"
    git submodule update --init --recursive
else
    echo "Cloning llama.cpp ($LLAMA_TAG) to $BUILD_DIR..."
    git clone --recursive "$LLAMA_REPO" "$BUILD_DIR"
    cd "$BUILD_DIR"
    git checkout "$LLAMA_TAG"
fi

echo ""
echo "Configuring with CUDA support (-DGGML_CUDA=ON)..."
mkdir -p build-cuda
cd build-cuda
cmake .. \
    -DGGML_CUDA=ON \
    -DLLAMA_CURL=ON \
    -DBUILD_SHARED_LIBS=ON \
    -DCMAKE_BUILD_TYPE=Release
echo ""

echo "Building (this takes 2-5 min depending on CPU)..."
cmake --build . --config Release -j 8
echo ""

# --- Copy CUDA-enabled binaries to project --------------------
echo "Copying CUDA-enabled binaries to $BIN_DIR/"
BUILD_BIN="$BUILD_DIR/build-cuda/bin"

# Verify key files were built
if [ ! -f "$BUILD_BIN/llama-server" ]; then
    echo "ERROR: llama-server binary not found at $BUILD_BIN/llama-server."
    echo "  The build may have failed. Check output above."
    exit 1
fi
if [ ! -f "$BUILD_BIN/libggml-cuda.so" ] && [ ! -f "$BUILD_BIN/libggml-cuda.so.0" ]; then
    echo "ERROR: libggml-cuda.so not built. Ensure GGML_CUDA=ON was accepted by cmake."
    echo "  Verify with: cmake .. -DGGML_CUDA=ON -LAH | grep CUDA"
    exit 1
fi

# Copy all runtime artifacts — keep existing CPU libs as fallback.
cp -f "$BUILD_BIN/llama-server"          "$BIN_DIR/"
cp -f "$BUILD_BIN"/libllama*.so*           "$BIN_DIR/" 2>/dev/null || true
cp -f "$BUILD_BIN"/libggml*.so*            "$BIN_DIR/" 2>/dev/null || true

# Confirm the CUDA backend is now present
if ldd "$BIN_DIR"/llama-server 2>&1 | grep -qi cuda; then
    echo ""
    echo "SUCCESS: llama-server now links against CUDA."
    ldd "$BIN_DIR"/llama-server | grep -iE "cuda|cublas|ggml" || true
else
    echo ""
    echo "WARNING: Could not detect CUDA libs via ldd. Manually verify with:"
    echo "  lld $BIN_DIR/llama-server | grep cuda"
    echo "Also ensure libggml-cuda.so is in $BIN_DIR/"
fi

echo ""
echo "============================================================"
echo "Done. You can now start GPU mode:"
echo ""
echo "  cd $PROJECT_ROOT"
echo "  docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build -d"
echo ""
echo "To revert to CPU (dev mode):"
echo "  cp -f $BIN_DIR/cpu-backup/* $BIN_DIR/"
echo "  docker compose up --build -d"
echo "============================================================"
