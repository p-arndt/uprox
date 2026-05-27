# Stage 0: Base image
FROM node:24 AS base
WORKDIR /app
RUN npm install -g pnpm

# Stage 1: Install all dependencies (including dev)
FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: Build the application
FROM dependencies AS builder
WORKDIR /app
COPY . .
# SvelteKit's build executes server modules to analyse routes, so anything that
# validates env / opens a connection at import time (the DB client, better-auth)
# needs *some* value present. These are throwaway build-time placeholders — this
# stage is discarded, so they never reach the runtime image, which supplies its
# own real env at startup.
ENV POSTGRES_HOST=build \
    POSTGRES_USER=build \
    POSTGRES_PASSWORD=build \
    POSTGRES_DB=build \
    BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime \
    ORIGIN=http://localhost
RUN pnpm run build

# Stage 3: Prepare production dependencies
FROM base AS prod-dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile


FROM gcr.io/distroless/nodejs24-debian12:nonroot AS production
WORKDIR /app

COPY --from=prod-dependencies /app/node_modules /app/node_modules
COPY --from=builder /app/build /app/build
COPY --from=builder /app/drizzle /app/drizzle

ENV NODE_ENV=production
ENV BODY_SIZE_LIMIT=Infinity
# We need to set the trust proxy to true to make sure that the application works behind a reverse proxy
ENV AUTH_TRUST_HOST=true

EXPOSE 3000 
CMD ["build/index.js"]