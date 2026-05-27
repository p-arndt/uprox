# Stage 0: Base image
FROM node:24 AS base
WORKDIR /app
RUN npm install -g pnpm

# Stage 1: Install all dependencies (including dev)
FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: Build the application
FROM dependencies AS builder
WORKDIR /app
COPY . .
RUN pnpm run build

# Stage 3: Prepare production dependencies
FROM base AS prod-dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod


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