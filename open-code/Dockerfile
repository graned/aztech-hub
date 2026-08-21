# syntax=docker/dockerfile:1.14

FROM node:22-alpine AS base
RUN apk add --no-cache git openssh-client curl ca-certificates && corepack enable
RUN mkdir -p -m 700 /root/.ssh
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]

FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
RUN set -eux; \
    helper_source=; \
    for candidate in /app/node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers; do \
      if [ -d "$candidate" ]; then helper_source=$candidate; break; fi; \
    done; \
    test -n "$helper_source"; \
    for next_dependencies in /app/.next/standalone/node_modules/.pnpm/next@*/node_modules; do \
      test -d "$next_dependencies" || continue; \
      mkdir -p "$next_dependencies/@swc/helpers"; \
      cp -a "$helper_source/." "$next_dependencies/@swc/helpers/"; \
    done

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
