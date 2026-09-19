# uprox. The web app runs on pnpm scripts (see package.json); the recipes below are
# thin wrappers for the common ones.
#
# Shared recipes (image, up/down, version, release, …) live in .just/, copied from
# ~/coding/just-common. Edit them there and run `just sync-common`. Note that
# `just release` here cuts a stamp release (bump, commit, tag, push), and `just up`
# starts the local Postgres from compose.yaml.

import '.just/common.just'
import '.just/docker.just'
import '.just/release.just'

# Registry (ghcr.io/p-arndt) and target (last Dockerfile stage) keep the defaults.
IMAGE := "uprox"

# Start the dev server
dev:
    pnpm dev

# Type check (svelte-check)
check:
    pnpm check

# Unit tests and DB tests (PGlite, no server needed)
test:
    pnpm test:unit --run
    pnpm test:db

# End-to-end tests (needs a running Postgres, see `just up` and .env)
e2e:
    pnpm test:e2e

# What CI's verify job runs. The drift check and E2E run in CI only.
ci: check
    pnpm lint
    just test
    pnpm build
