# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

# Step 1: Install Litestream for live S3 WAL replication
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && rm /tmp/litestream.tar.gz

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
# value set in the container's environment afterwards is never read. This is the
# app origin Stripe returns a paying customer to, so it has to be baked in here.
# Unset means http://localhost:3000, which src/app/actions/billing.ts refuses to
# charge against rather than dead-link the customer.
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN npm run build

# Step 4: Production Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p /app/data /app/public

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
CMD ["sh", "-c", "if [ -n \"$LITESTREAM_BUCKET\" ]; then litestream restore -if-replica-exists -config /etc/litestream.yml /app/data/app.db; fi && node scripts/init-db.mjs && if [ -n \"$LITESTREAM_BUCKET\" ]; then exec litestream replicate -config /etc/litestream.yml -exec 'node_modules/.bin/next start'; else exec node_modules/.bin/next start; fi"]
