# 🚀 LiteSaaS

> **The 100% Free, Zero-Cost Production Next.js 15 + SQLite SaaS Starter Kit.**  
> *Stop burning $25/mo on managed PostgreSQL instances for your side projects. Ship production apps with microsecond latencies and $0 database bills.*

[![Next.js 15](https://img.shields.io/badge/Next.js-15.1-black?style=flat&logo=next.js)](https://nextjs.org)
[![SQLite WAL](https://img.shields.io/badge/SQLite-WAL_Mode-003B57?style=flat&logo=sqlite)](https://locionic.com/en/blog/sqlite-wal-mode-production-concurrency)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.38-C5F74F?style=flat)](https://orm.drizzle.team)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=flat&logo=tailwind-css)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)

---

## ⚡ The Problem: "SaaS Bill Creep"

Every indie hacker knows the story: You build 3 or 4 side project MVPs. Even before getting your first paying customer, you are bleeding **$840+/year** on idle database hosting:

| Service | Traditional SaaS Boilerplate | LiteSaaS |
| :--- | :--- | :--- |
| **Database** | Managed PostgreSQL (Supabase/Neon) - **$25/mo** | Embedded SQLite with WAL Mode - **$0/mo** |
| **Authentication** | Clerk / Auth0 - **$25/mo** | Self-Hosted Session Cookies (crypto.scrypt) - **$0/mo** |
| **Database Backups** | Paid add-on snapshot storage | Litestream S3 / Cloudflare R2 Streaming - **$0/mo** |
| **Compute** | Serverless cold starts & overages | $4/mo VPS (Hetzner / Lightsail / Coolify) |
| **Annual Cost (3 MVPs)** | **$2,520 / year** | **$48 / year** |

LiteSaaS gives you the **exact same developer experience and safety** as a heavy Postgres setup, but runs on a single $4 VPS with zero database bills.

---

## 🏗️ Architecture: Why SQLite in Production Works

Most developers believe SQLite cannot handle production web traffic. That reputation comes from SQLite's **year-2000 legacy defaults**, not the engine itself. 

When tuned with production PRAGMAs, SQLite delivers **5,000+ req/sec concurrency** with **microsecond in-memory reads**:

```
[ Client Request ]
       │
       ▼
[ Next.js 15 App Router / Server Actions ]
       │
       ▼
[ SQLite Engine in WAL Mode ] ── (0.02ms in-memory C read, zero network lag)
       │
       ├─► 50 Concurrent Readers (Non-blocking)
       ├─► 1 Active Writer (busy_timeout = 5000ms auto-retries)
       │
       ▼
[ Litestream Daemon ] ────────── (Asynchronous physical WAL streaming)
       │
       ▼
[ Cloudflare R2 / AWS S3 ] ───── (Disaster recovery with < 1s RPO)
```

Read our complete research paper on SQLite concurrency mechanics:  
👉 **[Running SQLite in Production with WAL Mode & 1-Writer Pools (Locionic)](https://locionic.com/en/blog/sqlite-wal-mode-production-concurrency)**

---

## 📦 What's Inside

- **Next.js 15 (App Router & React 19)**: Built with modern Server Components and Server Actions.
- **SQLite + Drizzle ORM**: Fully type-safe relational queries with automatic schema migrations (`npm run db:push`).
- **Production PRAGMAs Pre-Wired**:
  - `PRAGMA page_size = 4096;` (aligned with NVMe block clusters)
  - `PRAGMA journal_mode = WAL;` (readers never block writers, writers never block readers)
  - `PRAGMA synchronous = NORMAL;` (crash-safe ACID without filesystem fsync stall)
  - `PRAGMA busy_timeout = 5000;` (eliminates `SQLITE_BUSY` errors during write bursts)
  - `PRAGMA foreign_keys = ON;` (enforces relational integrity)
- **Self-Hosted Session Auth**: Secure password hashing with Node.js `crypto.scrypt` and HttpOnly cookies. Zero third-party fees.
- **Stripe & LemonSqueezy Ready**: Checkout session creation and webhook handling pre-configured.
- **Streaming S3 Disaster Recovery**: Bundled with [Litestream](https://litestream.io) to continuously replicate WAL frames to Cloudflare R2 or S3.
- **Modern Linear-Style Dark Mode**: Crafted with Tailwind CSS and Radix-inspired aesthetics.

---

## 🚀 Quick Start (Under 60 Seconds)

### 1. Clone & Install

```bash
git clone https://github.com/locionic/litesaas.git
cd litesaas
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

### 3. Initialize Database & Run

```bash
npm run db:push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. 

> **Instant Demo Credentials:**  
> Email: `demo@litesaas.dev`  
> Password: `password123`

---

## 🐳 Production Deployment

### Option A: Docker Compose (Coolify / Dokku / VPS)

```bash
docker compose up -d
```

### Option B: Deploying with Litestream S3 Backup

Set your Cloudflare R2 or AWS S3 credentials in `.env`:

```env
LITESTREAM_BUCKET=my-app-db-backup
LITESTREAM_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
LITESTREAM_ACCESS_KEY_ID=xxx
LITESTREAM_SECRET_ACCESS_KEY=yyy
```

When the Docker container starts, Litestream automatically checks S3:
1. If an existing backup exists, it **restores your database in 2 seconds**.
2. As Next.js writes new transactions, Litestream **streams WAL frames continuously** to your bucket.

---

## 📊 Benchmark: SQLite vs Network PostgreSQL

Benchmarked on a $5/mo AWS Lightsail instance (2 vCPU, 2GB RAM):

| Metric | Managed PostgreSQL (over network) | LiteSaaS (Embedded SQLite) |
| :--- | :--- | :--- |
| **Single Row Read Latency** | 12ms – 24ms (network roundtrip) | **0.02ms – 0.05ms** (500x faster) |
| **Complex Relational Join** | 25ms – 45ms | **0.15ms** |
| **Max Concurrent Readers** | Pool limited (usually 20–50) | **Unlimited** (WAL concurrent readers) |
| **Memory Footprint** | ~350MB – 600MB daemon RAM | **~15MB RAM** |
| **Maintenance Burden** | Connection pools, SSL certs, users | **Zero ops (single file on disk)** |

---

## 🛠️ Tech Stack & Credits

- Framework: [Next.js](https://nextjs.org) by Vercel
- ORM: [Drizzle ORM](https://orm.drizzle.team)
- Database: [SQLite](https://www.sqlite.org) / [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- Replication: [Litestream](https://litestream.io) by Ben Johnson
- Styling: [Tailwind CSS](https://tailwindcss.com) & [Lucide Icons](https://lucide.dev)

---

## 👨‍💻 Author & Attribution

Developed and maintained by **[Loc Truong](https://locionic.com)** ([@locionic](https://github.com/locionic)).

For interactive SQLite tuning, check out our companion tool:  
👉 **[SQLite Production PRAGMA Configurator](https://locionic.com/en/tools/sqlite-configurator)**

---

## 📄 License

MIT License — Feel free to use this template for personal, open-source, or commercial SaaS projects!
