# 🚀 LiteSaaS

> **The 100% Free, Zero-Cost Production Next.js 15 + SQLite SaaS Starter Kit.**  
> *Stop burning $25/mo on managed PostgreSQL instances for your side projects. Ship production apps with microsecond latencies and $0 database bills.*

[![Next.js 15](https://img.shields.io/badge/Next.js-15.1-black?style=flat&logo=next.js)](https://nextjs.org)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Online-10b981?style=flat&logo=railway)](https://litesaas-production.up.railway.app)
[![SQLite WAL](https://img.shields.io/badge/SQLite-WAL_Mode-003B57?style=flat&logo=sqlite)](https://locionic.com/en/blog/sqlite-wal-mode-production-concurrency)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.38-C5F74F?style=flat)](https://orm.drizzle.team)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=flat&logo=tailwind-css)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)

👉 **Live Interactive Demo:** [https://litesaas-production.up.railway.app](https://litesaas-production.up.railway.app) *(Instant login: `demo@litesaas.dev` / `password123`)* — that deployment sets `SEED_DEMO_USER=true`. A default deploy does **not**, so it shows neither the account nor the login banner.

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
- **SQLite + Drizzle ORM**: Fully type-safe relational queries. Schema changes apply themselves on the next start — see [Upgrading](#upgrading-an-existing-deployment).
- **Production PRAGMAs Pre-Wired**:
  - `PRAGMA page_size = 4096;` (aligned with NVMe block clusters)
  - `PRAGMA journal_mode = WAL;` (readers never block writers, writers never block readers)
  - `PRAGMA synchronous = NORMAL;` (crash-safe ACID without filesystem fsync stall)
  - `PRAGMA busy_timeout = 5000;` (eliminates `SQLITE_BUSY` errors during write bursts)
  - `PRAGMA foreign_keys = ON;` (enforces relational integrity)
  - `PRAGMA cache_size = -64000;` (a ceiling of ~64MB of page cache — SQLite fills it lazily against the working set, so a small database uses far less)
  - `PRAGMA temp_store = MEMORY;` (sorts and joins never touch the disk)
- **Self-Hosted Session Auth**: Secure password hashing with Node.js `crypto.scrypt` and HttpOnly cookies. Zero third-party fees.
- **Stripe & LemonSqueezy Ready**: Checkout session creation and webhook handling pre-configured.
- **Streaming S3 Disaster Recovery**: Bundled with [Litestream](https://litestream.io) to continuously replicate WAL frames to Cloudflare R2 or S3.
- **Modern Linear-Style Dark Mode**: Crafted with Tailwind CSS and Radix-inspired aesthetics.
- **A Dashboard That Costs Nothing to Hydrate**: The project list, the search box, the status tabs, the plan-usage meter and the export links are all Server Components — no state, no effects, no client bundle. Only the parts that must display an error a Server Action returned (the create and edit forms, the delete confirmation) and the timezone-correct date are client components, and each one earns it.
- **Take Your Data With You**: `GET /api/projects/export?format=json|csv`, scoped in the query rather than filtered afterwards. The JSON carries the account alongside its projects — id, email, plan and status, so a restore has the billing state too, and never the password hash. The CSV is projects-only: a spreadsheet expects one header row, and an account line above the project rows becomes a second header the reader has to know to skip. The CSV is RFC 4180 escaped and guards against spreadsheet formula injection, so a project named `=SUM(A1:A9)` exports as data.
- **Delete Your Account, For Real**: The one action that cannot be undone by re-registering. It asks for your password, because the session cookie is the only other authorisation and it rides on every request the browser makes for the next 30 days. It refuses while a paid plan is still billing — deleting the row under an active subscription arrives as a chargeback rather than as a support ticket. One statement removes the account, its projects and its sessions together; removing them one at a time would leave a partial account if the process died halfway, with no way back. The demo account cannot do this, because its password is printed below.
- **Filter, Search and Edit Inline**: Search by name or description, narrow to active or archived, and rename a project without leaving the page. The search and the status tab compose — switching one keeps the other — and none of it is client state.

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
>
> Seeded automatically by `npm run dev`. In production this account is **not**
> created — it has a published password and a Pro plan, so enabling it on a real
> deployment ships a backdoor. Only set `SEED_DEMO_USER=true` for a hosted
> public demo, never for a deployment with real users.
>
> `docker compose` reads that flag from your `.env` (no edit to the compose file
> needed). Note that a host with an ephemeral disk — a Railway container, most
> PaaS free tiers — starts with an empty database on every deploy, so a hosted
> demo needs the flag on *every* deploy, not just the first.

---

## Upgrading an existing deployment

Pull the new version and restart. `scripts/init-db.mjs` runs first on every
container start, compares the file on disk against the schema the app needs, and
**adds any column that is missing** — so a schema change needs no migration step
and no downtime. It logs exactly what it added:

```
LiteSaaS: added subscriptions.lemon_nonce to /app/data/app.db (schema was behind)
```

Two cases it deliberately will not do for you, both because they are decisions
about rows that already exist rather than about the schema:

- a column that is `NOT NULL`, or part of a `PRIMARY KEY` / `UNIQUE` / `CHECK` /
  `FOREIGN KEY`
- anything that needs a value invented for the rows already in the table

For those it refuses to start and names the table and column, rather than
starting an app that is about to serve an error page. Add them by hand, or delete
the file and let it be recreated (losing its contents).

> **On `npm run db:push`:** it creates the database for a fresh local clone, which
> is what the quickstart above uses it for. It does **not** migrate an existing
> one — drizzle-kit 0.30.6 fails against a file this project's own `init-db`
> created, because `init-db` declares unique constraints inline (SQLite stores
> those as anonymous `sqlite_autoindex_*` entries) and `db:push` expects to create
> its own named indexes over the top. The restart path above is the supported
> one; reach for `db:push` only on a brand-new file.

---

## 🐳 Production Deployment

### Option A: Docker Compose (Coolify / Dokku / VPS)

```bash
docker compose up -d
```

Serve it over HTTPS. The session cookie is `Secure` in production, and browsers
refuse to store a `Secure` cookie from a plain-`http` response — Coolify and Dokku
terminate TLS for you, and on a bare VPS put Caddy or nginx in front.

If you do put a reverse proxy in front, set `TRUST_PROXY=true` in `.env` and
recreate the container. That turns on the per-network sign-in and signup limits,
which key on the caller's address as reported by the proxy. It is off by default
because without a proxy that address is the caller's own claim about themselves,
and behind a published port every visitor arrives at the app as the same address
— so the limit would be one any caller can switch off, and then one that locks
everybody out on a single stranger's wrong guesses. Password protection does not
depend on it: the tighter per-account limit is always on.

If you're taking payments, set `NEXT_PUBLIC_APP_URL` in `.env` to the deployment's
public origin **before building** — Stripe returns a customer to it after they
pay, and Next.js inlines `NEXT_PUBLIC_*` when it builds, so setting it in the
container afterwards does nothing:

```bash
docker compose build --no-cache && docker compose up -d
```

Until it's set, checkout is refused with an explanation on the dashboard rather
than taking the money and returning the customer to `localhost`.

#### Taking payments: the fourth variable

`NEXT_PUBLIC_APP_URL` is not enough. `checkout.session.completed` is the **only**
thing that grants Pro, and it arrives at `/api/webhooks/stripe` — so a deployment
with a secret key and a price id but no webhook **charges customers and never
delivers the plan they paid for**. The dashboard says so as `?billing=webhook`,
but only after somebody clicks Upgrade.

In Stripe: **Developers → Webhooks → Add endpoint**, pointing at
`https://your-origin/api/webhooks/stripe`, subscribed to `checkout.session.completed`
and `charge.refunded`. Paste the `whsec_…` secret it shows you into
`STRIPE_WEBHOOK_SECRET` in `.env`. Unlike the two `NEXT_PUBLIC_*` variables this
one is read at runtime — a restart is enough, no rebuild.

Until all four are real, leave the placeholders alone and checkout stays off. That
is deliberate: refusing to sell is recoverable, and a silent non-delivery is not.

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

Replication is switched by `LITESTREAM_BUCKET` alone, so the container refuses to
start on a **half-configured** backup — the bucket without its credentials, or the
credentials without the bucket — rather than coming up healthy with no snapshots
and no error. Leaving all four unset is still the supported default and stays
silent; it is only the partial states that fail, because those can only have
been a mistake. Fix the named variable and the container starts.

The Litestream binary is fetched from its GitHub release at build time, and the
image **verifies its sha256 before extracting it** — one pinned digest per
architecture (`amd64`, `arm64`). A release asset can be replaced without the tag
changing, so the image refuses to run a tarball that does not match what was
verified, and fails the build outright on an architecture it has no digest for.
To move to a newer Litestream, update the `ADD` URL and the digests together.

---

## 📊 SQLite vs Network PostgreSQL

Indicative figures for a typical small SaaS workload — **not a benchmark you can
reproduce from this repository.** There is no benchmark harness here, and there
could not be: the PostgreSQL column would need a managed instance to measure
against, so the numbers are the shape of the trade-off rather than the output of
a script in `scripts/`.

| Metric | Managed PostgreSQL (over network) | LiteSaaS (Embedded SQLite) |
| :--- | :--- | :--- |
| **Single Row Read Latency** | ~12ms – 24ms (network roundtrip) | ~0.02ms – 0.05ms — **250x–1200x**, depending on which ends of the ranges you compare |
| **Complex Relational Join** | ~25ms – 45ms | ~0.15ms |
| **Concurrent Readers** | Bounded by the pool (usually 20–50) | Not pool-limited — WAL readers do not block the writer, though they still share your CPU and RAM |
| **Memory Footprint** | ~350MB – 600MB daemon RAM | ~15MB RAM |
| **Maintenance Burden** | Connection pools, SSL certs, users | Zero ops (a single file on disk) |

What is *not* in the table, and is the honest reason to choose embedded SQLite:
a roundtrip that does not leave the process. On a hosted database every query
pays a network hop and a daemon, and that is a cost and a failure mode that grow
with traffic — which is the bill creep this project exists to avoid.

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
