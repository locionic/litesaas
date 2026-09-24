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

# Start script: initializes database tables, optionally restores from S3, then replicates in background
CMD ["sh", "-c", "node scripts/init-db.mjs && if [ -n \"$LITESTREAM_BUCKET\" ]; then litestream restore -if-replica-exists -config /etc/litestream.yml /app/data/app.db && exec litestream replicate -config /etc/litestream.yml -exec 'node_modules/.bin/next start'; else exec node_modules/.bin/next start; fi"]
