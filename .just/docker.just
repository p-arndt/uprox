# docker.just — image and compose recipes. Synced from github.com/p-arndt/just-common.
#
# The importing justfile sets:
#   IMAGE := "orbit"                           (required) image name
# and may override (needs `set allow-duplicate-variables`):
#   REGISTRY   := "reg.example.com/team"       default "ghcr.io/p-arndt"
#   DOCKERFILE := "docker/Dockerfile"          default "Dockerfile"
#   TARGET     := "runtime"                    build stage, default: last stage
#   COMPOSE    := "compose.prod.yaml"          compose file, default: docker's lookup

REGISTRY := "ghcr.io/p-arndt"
DOCKERFILE := "Dockerfile"
TARGET := ""
COMPOSE := ""

_REF := REGISTRY + "/" + IMAGE
_TARGET_FLAG := if TARGET == "" { "" } else { "--target " + TARGET }
_COMPOSE_FLAG := if COMPOSE == "" { "" } else { "-f " + COMPOSE }

# Build the image locally as <registry>/<image>:<tag>.  just image  |  just image 1.2.0
image TAG="dev":
    docker build -f {{DOCKERFILE}} {{_TARGET_FLAG}} -t {{_REF}}:{{TAG}} .

# CI normally does this on a tag; this is for a manual push. Needs `docker login`
# for the registry.
[doc('Build and push <tag> and :latest.')]
push TAG:
    docker build -f {{DOCKERFILE}} {{_TARGET_FLAG}} -t {{_REF}}:{{TAG}} -t {{_REF}}:latest .
    docker push {{_REF}}:{{TAG}}
    docker push {{_REF}}:latest

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
