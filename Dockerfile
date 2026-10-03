# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

# Step 1: Install Litestream for live S3 WAL replication
#
# ${TARGETARCH}, not a literal amd64. GitHub publishes one tarball per platform
# and the names line up with BuildKit's automatic ARGs exactly — v0.3.13 ships
# both linux-amd64 and linux-arm64. A hardcoded amd64 produced an image whose
# litestream binary cannot execute on a native arm64 host, so `exec litestream
# replicate` died and took the app down with it; but `docker build` on an
# M-series Mac kept passing, because that defaults to amd64 emulation. Broken
# only where nobody tests it.
#
# The ARG is required, not decorative: TARGETARCH is an *automatic* platform ARG
# and BuildKit only sets it for a stage that declares it. The syntax header above
# is what guarantees it is set at all — without BuildKit this expands to
# `linux-.tar.gz` and 404s.
ARG TARGETARCH
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-${TARGETARCH}.tar.gz /tmp/litestream.tar.gz

# Verified before it is executed, not just fetched. `ADD` from a release URL takes
# whatever bytes GitHub serves at build time, so the binary this image runs is
# whatever that URL serves *today* — and a release asset can be replaced, by a
# compromised account or a re-upload, without the tag changing. Both digests were
# computed from two independent fetches that agreed, cross-checked against the
# byte counts GitHub's own API reports. GitHub publishes no digest for these
# assets, which is why they are pinned here rather than read from anywhere.
#
# One digest per architecture because the tarball is per-architecture — a single
# value would have to be wrong for half the platforms. An unrecognised
# TARGETARCH fails the build instead of extracting an unverified binary, so a new
# runner arch lands here as a loud stop rather than an implicit trust.
RUN case "${TARGETARCH}" in \
      amd64) echo "eb75a3de5cab03875cdae9f5f539e6aedadd66607003d9b1e7a9077948818ba0  /tmp/litestream.tar.gz" | sha256sum -c - ;; \
      arm64) echo "9585f5a508516bd66af2b2376bab4de256a5ef8e2b73ec760559e679628f2d59  /tmp/litestream.tar.gz" | sha256sum -c - ;; \
      *) echo "litestream: no pinned digest for TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz \
 && rm /tmp/litestream.tar.gz

# Step 2: Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache python3 make g++ gcc
RUN npm ci

# Step 3: Build application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js inlines NEXT_PUBLIC_* at build time, in the server bundle too — a
# value set in the container's environment afterwards is never read. That is true
# of EVERY NEXT_PUBLIC_* name, not just the app URL: billing.ts reads
# NEXT_PUBLIC_STRIPE_PRO_PRICE_ID on the server, and the compiled line_items
# carries the price as a string literal with no process.env read surviving. So
# each one needs its own ARG — an ARG that is not declared cannot be passed in,
# and the variable then inlines as empty and checkout silently never appears.
# Unset app URL means http://localhost:3000, which billing.ts refuses to charge
# against rather than dead-link the customer.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_STRIPE_PRO_PRICE_ID
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=$NEXT_PUBLIC_STRIPE_PRO_PRICE_ID
RUN npm run build

# Step 4: Production Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p /app/data /app/public

# The single place the image decides where the database is. docker-compose.yml
# may override it, but litestream.yml and the CMD below both read this same
# value — so the app, the schema check, the restore and the replication cannot
# be pointed at different files. They each named /app/data/app.db
# independently, which is a live hazard the moment DATABASE_URL is a real knob:
# set it and the app writes elsewhere while Litestream faithfully replicates a
# file nothing ever writes. S3 fills with a frozen empty snapshot, the container
# starts clean every time, and a restore drops a stale database beside a fresh
# one. Absolute because Litestream resolves a relative path against its own
# working directory rather than the app's.
ENV DATABASE_URL=/app/data/app.db

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts ./scripts
COPY litestream.yml /etc/litestream.yml

EXPOSE 3000
ENV PORT=3000

# Start script: restores from S3 (if configured), then initializes/validates the
# schema, then replicates in background. The restore deliberately comes FIRST:
# init-db checks the restored file for missing columns, and running it before
# would only ever check the empty file the restore is about to replace.
#
# $DATABASE_URL, not a path: restoring somewhere the app does not read is a
# restore that silently achieves nothing. litestream.yml watches the same
# variable for the replicate half, so the two cannot drift apart.
#
# The two guards in front reject a HALF-configured backup. Until they existed,
# $LITESTREAM_BUCKET alone decided whether any backup happened: set it without
# the credentials beside it and litestream ships nothing; set the credentials
# without it and the CMD skips replication entirely. Both produce a container
# that is healthy, serves traffic, restarts clean and has never once backed up
# — and neither prints an error, because there is no code path that fails.
# That is the worst failure mode available for a backup: the operator believes
# they have one until the day they need it. Fully unconfigured is still the
# supported default and stays silent; it is the half-configured states that
# are refused, because those can only have been a mistake.
CMD ["sh", "-c", "if [ -n \"$LITESTREAM_BUCKET\" ] && { [ -z \"$LITESTREAM_ENDPOINT\" ] || [ -z \"$LITESTREAM_ACCESS_KEY_ID\" ] || [ -z \"$LITESTREAM_SECRET_ACCESS_KEY\" ]; }; then echo \"LiteSaaS: LITESTREAM_BUCKET is set but LITESTREAM_ENDPOINT, LITESTREAM_ACCESS_KEY_ID or LITESTREAM_SECRET_ACCESS_KEY is missing - litestream would ship no snapshot and nothing in this container would say so.\" >&2; exit 1; fi; if [ -z \"$LITESTREAM_BUCKET\" ] && { [ -n \"$LITESTREAM_ENDPOINT\" ] || [ -n \"$LITESTREAM_ACCESS_KEY_ID\" ] || [ -n \"$LITESTREAM_SECRET_ACCESS_KEY\" ]; }; then echo \"LiteSaaS: LITESTREAM_* is set but LITESTREAM_BUCKET is not - with no bucket litestream ships no snapshot and nothing in this container would say so.\" >&2; exit 1; fi; if [ -n \"$LITESTREAM_BUCKET\" ]; then litestream restore -if-replica-exists -config /etc/litestream.yml \"$DATABASE_URL\"; fi && node scripts/init-db.mjs && if [ -n \"$LITESTREAM_BUCKET\" ]; then exec litestream replicate -config /etc/litestream.yml -exec 'node_modules/.bin/next start'; else exec node_modules/.bin/next start; fi"]
