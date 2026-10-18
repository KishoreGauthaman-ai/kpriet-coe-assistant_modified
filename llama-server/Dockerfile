# ===== llama.cpp server — pre-built binary (NO git clone, NO cmake) =====
FROM ubuntu:22.04

RUN --mount=type=cache,target=/var/cache/apt,id=llama-server-apt-cache \
    --mount=type=cache,target=/var/lib/apt,id=llama-server-apt-lib \
    apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY bin/llama-server /usr/local/bin/llama-server
COPY bin/*.so* /usr/local/lib/

ENV LD_LIBRARY_PATH=/usr/local/lib

VOLUME ["/models"]
EXPOSE 8080

ENTRYPOINT ["llama-server"]