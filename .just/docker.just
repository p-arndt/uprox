# docker.just — image and compose recipes. Synced from github.com/p-arndt/just-common.
#
# The importing justfile sets:
#   IMAGE := "orbit"                           (required) image name
# and may override (needs `set allow-duplicate-variables`):
#   REGISTRY   := "reg.example.com/team"       default "ghcr.io/p-arndt"
#   DOCKERFILE := "docker/Dockerfile"          default "Dockerfile"
#   TARGET     := "runtime"                    build stage, default: last stage
#   COMPOSE    := "compose.prod.yaml"          compose file, default: docker's lookup
#   PLATFORM   := "linux/amd64,linux/arm64"    what `push` builds for, default "linux/amd64"

REGISTRY := "ghcr.io/p-arndt"
DOCKERFILE := "Dockerfile"
TARGET := ""
COMPOSE := ""

# The server, not this machine: a Mac builds arm64 by default, a VPS runs amd64.
PLATFORM := "linux/amd64"

_REF := REGISTRY + "/" + IMAGE
_TARGET_FLAG := if TARGET == "" { "" } else { "--target " + TARGET }
_COMPOSE_FLAG := if COMPOSE == "" { "" } else { "-f " + COMPOSE }

# Build for this machine to run locally as <registry>/<image>:<tag>.  just image  |  just image 1.2.0
image TAG="dev":
    docker build -f {{DOCKERFILE}} {{_TARGET_FLAG}} -t {{_REF}}:{{TAG}} .

# CI normally does this on a tag; this is for a manual push. Built with buildx for
# PLATFORM (the server's architecture), so it works from an Apple Silicon Mac.
# Needs `docker login` for the registry.
[doc('Build for PLATFORM and push :<tag> plus :latest.  just push  |  just push 1.2.0')]
push TAG="latest":
    docker buildx build --platform {{PLATFORM}} -f {{DOCKERFILE}} {{_TARGET_FLAG}} -t {{_REF}}:{{TAG}} {{ if TAG == "latest" { "" } else { "-t " + _REF + ":latest" } }} --push .

# Start the compose stack in the background.
up:
    docker compose {{_COMPOSE_FLAG}} up -d

# Stop the compose stack (volumes survive).
down:
    docker compose {{_COMPOSE_FLAG}} down

# Follow the compose logs:  just logs  |  just logs db
logs *SERVICE:
    docker compose {{_COMPOSE_FLAG}} logs -f {{SERVICE}}

# Show the stack's containers.
ps:
    docker compose {{_COMPOSE_FLAG}} ps
