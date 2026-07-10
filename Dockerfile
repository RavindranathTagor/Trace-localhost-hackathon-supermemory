# Runs the Supermemory Local binary (which has no Windows build) inside a Linux
# container, so it works on Windows via Docker Desktop. Trace itself still runs on
# Windows with `npm run dev`; it just talks to this container at localhost:6767.
FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Pin the release + platform. Downloaded directly (bypassing the interactive installer)
# so the build is deterministic. Override with --build-arg for arm64 hosts.
ARG SM_VERSION=server-v0.0.3
ARG SM_PLATFORM=linux-x64
RUN curl -fsSL -o /usr/local/bin/supermemory-server \
      "https://github.com/supermemoryai/supermemory/releases/download/${SM_VERSION}/supermemory-server-${SM_PLATFORM}" \
  && chmod +x /usr/local/bin/supermemory-server

# All state lives here; docker-compose mounts it to ./.supermemory on the host so the
# generated API key + graph survive a restart.
ENV SUPERMEMORY_DATA_DIR=/data
# Bind on all interfaces so the mapped port is reachable from Windows (the server may
# default to localhost inside the container). Harmless if the binary ignores these.
ENV HOST=0.0.0.0
ENV SUPERMEMORY_HOST=0.0.0.0
ENV PORT=6767

EXPOSE 6767
CMD ["supermemory-server"]
