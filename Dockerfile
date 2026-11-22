# syntax=docker/dockerfile:1
# Production image (Next.js standalone) plus a "migrator" image for migrations and admin scripts.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Builds never need runtime secrets (env is read on first request, see CLAUDE.md).
RUN npm run build

# One-off tasks: `docker compose run --rm migrator` (migrations) or `... migrator npx tsx scripts/grant-admin.ts`.
FROM ${NODE_IMAGE} AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY db ./db
COPY scripts ./scripts
USER node
CMD ["node", "scripts/migrate.mjs"]

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Argon2's native binary is loaded at runtime; make sure the platform package is present.
COPY --from=build --chown=node:node /app/node_modules/@node-rs ./node_modules/@node-rs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
