import Link from 'next/link';
import {
  Database,
  Zap,
  ShieldCheck,
  HardDrive,
  Cloud,
  CheckCircle2,
  Terminal,
  ArrowRight,
  Sparkles,
  Layers,
  Lock,
  RefreshCw,
  TrendingDown,
} from 'lucide-react';
import { PLANS } from '@/lib/stripe';
import { seedDemoUserIfNeeded } from '@/lib/auth';

export default async function HomePage() {
  // Ensure demo user is seeded for instant evaluation
  await seedDemoUserIfNeeded();

  return (
    <div className="space-y-24 pb-20">
      {/* Hero Section */}
      <section className="relative pt-20 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center">
        {/* Subtle background glow */}
        <div className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80">
          <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-emerald-500 to-indigo-500 opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]" />
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-semibold mb-8 animate-fade-in">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Zero-Cost Infrastructure for Indie Founders</span>
        </div>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-4xl mx-auto leading-[1.1]">
          Ship Profitable SaaS Without{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">
            Database Bills
          </span>
          .
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          Stop burning $25/month on managed PostgreSQL for unvalidated side projects. LiteSaaS gives you{' '}
          <strong className="text-zinc-200">Next.js 15, Drizzle ORM, SQLite in WAL mode</strong>, self-hosted session auth, and streaming S3 backups.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/register"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-500 text-zinc-950 font-bold px-6 py-3.5 rounded-xl hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98]"
          >
            Get Started Free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-zinc-900 border border-white/10 text-zinc-200 font-semibold px-6 py-3.5 rounded-xl hover:bg-zinc-800 transition-colors"
          >
            Try Live Demo
          </Link>
        </div>

        {/* Live Terminal Architecture Preview */}
        <div className="mt-14 max-w-3xl mx-auto text-left rounded-2xl border border-white/10 bg-[#0d0d10] p-4 sm:p-6 shadow-2xl glow-subtle">
          <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-4">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-red-500/80" />
              <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
              <div className="h-3 w-3 rounded-full bg-green-500/80" />
              <span className="text-xs font-mono text-zinc-500 ml-2">production-connection.ts</span>
            </div>
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              0.02ms Read Latency
            </span>
          </div>
          <pre className="font-mono text-xs sm:text-sm text-zinc-300 overflow-x-auto leading-relaxed">
            <code>
              <span className="text-purple-400">sqlite</span>.<span className="text-blue-400">pragma</span>(<span className="text-emerald-300">&apos;journal_mode = WAL&apos;</span>); <span className="text-zinc-500">// Non-blocking concurrent readers</span>{'\n'}
              <span className="text-purple-400">sqlite</span>.<span className="text-blue-400">pragma</span>(<span className="text-emerald-300">&apos;synchronous = NORMAL&apos;</span>); <span className="text-zinc-500">// Crash-safe ACID without fsync overhead</span>{'\n'}
              <span className="text-purple-400">sqlite</span>.<span className="text-blue-400">pragma</span>(<span className="text-emerald-300">&apos;busy_timeout = 5000&apos;</span>); <span className="text-zinc-500">// Auto-retries locked writes for 5s</span>{'\n'}
              <span className="text-purple-400">sqlite</span>.<span className="text-blue-400">pragma</span>(<span className="text-emerald-300">&apos;cache_size = -64000&apos;</span>); <span className="text-zinc-500">// 64MB in-memory RAM page cache</span>{'\n'}
              <span className="text-purple-400">sqlite</span>.<span className="text-blue-400">pragma</span>(<span className="text-emerald-300">&apos;foreign_keys = ON&apos;</span>); <span className="text-zinc-500">// Enforce relational integrity</span>
            </code>
          </pre>
        </div>
      </section>

      {/* Cost Comparison Section */}
      <section id="calculator" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            The Hidden Cost of the Modern SaaS Stack
          </h2>
          <p className="mt-4 text-zinc-400">
            Indie makers often bleed money maintaining idle databases for apps that are still finding product-market fit.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Traditional Stack */}
          <div className="rounded-2xl border border-red-500/20 bg-red-950/10 p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wider text-red-400">
                Traditional Next.js Stack
              </span>
              <span className="text-2xl font-bold text-red-400 font-mono">$840 / yr</span>
            </div>
            <ul className="space-y-3 text-sm text-zinc-300">
              <li className="flex items-center justify-between border-b border-white/5 pb-2">
                <span>Managed PostgreSQL (Supabase/Neon)</span>
                <span className="font-mono text-zinc-400">$25/mo</span>
              </li>
              <li className="flex items-center justify-between border-b border-white/5 pb-2">
                <span>Auth Provider (Clerk/Auth0)</span>
                <span className="font-mono text-zinc-400">$25/mo</span>
              </li>
              <li className="flex items-center justify-between border-b border-white/5 pb-2">
                <span>Serverless Compute Overages</span>
                <span className="font-mono text-zinc-400">$20/mo</span>
              </li>
              <li className="flex items-center justify-between text-red-400 font-semibold pt-2">
                <span>Cost for 3 active side projects:</span>
                <span className="font-mono">$2,520 / yr</span>
              </li>
            </ul>
          </div>

          {/* LiteSaaS Stack */}
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-6 sm:p-8 space-y-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-emerald-500 text-zinc-950 text-[10px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider">
              Zero Recurring DB Fee
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wider text-emerald-400">
                LiteSaaS Production Stack
              </span>
              <span className="text-2xl font-bold text-emerald-400 font-mono">$48 / yr</span>
            </div>
            <ul className="space-y-3 text-sm text-zinc-300">
              <li className="flex items-center justify-between border-b border-white/5 pb-2">
                <span>Embedded SQLite Database (WAL mode)</span>
                <span className="font-mono text-emerald-400">$0/mo</span>
              </li>
              <li className="flex items-center justify-between border-b border-white/5 pb-2">
                <span>Self-Hosted Cookie Session Auth</span>
                <span className="font-mono text-emerald-400">$0/mo</span>
              </li>
              <li className="flex items-center justify-between border-b border-white/5 pb-2">
                <span>Cloudflare R2 Litestream S3 Backup</span>
                <span className="font-mono text-emerald-400">$0/mo (Free Tier)</span>
              </li>
              <li className="flex items-center justify-between border-b border-white/5 pb-2">
                <span>Cheap $4/mo VPS (Hetzner / Lightsail)</span>
                <span className="font-mono text-zinc-400">$4/mo</span>
              </li>
              <li className="flex items-center justify-between text-emerald-400 font-semibold pt-2">
                <span>You Save Every Single Year:</span>
                <span className="font-mono font-bold">+$792.00</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Bento Grid Features */}
      <section id="architecture" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Engineered for Single-Box Scale
          </h2>
          <p className="mt-4 text-zinc-400">
            Everything you need to launch, authenticate users, accept recurring revenue, and guarantee data durability.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-white/10 bg-[#121217] p-6 space-y-4">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Database className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-white">Drizzle ORM & Typed Schema</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Full TypeScript safety with zero runtime schema bloat. If you ever need to migrate to PostgreSQL down the road, Drizzle handles it with a 5-minute config change.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#121217] p-6 space-y-4">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Cloud className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-white">Streaming Litestream S3 Backups</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Every committed transaction frame is asynchronously replicated to Cloudflare R2 or AWS S3 in milliseconds. Zero data loss if the server crashes.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#121217] p-6 space-y-4">
            <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Lock className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-white">Self-Hosted Session Auth</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Native crypto-scrypt password hashing with HttpOnly secure session cookies. No third-party redirect popups and no Clerk monthly active user tier limits.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#121217] p-6 space-y-4">
            <div className="h-10 w-10 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-yellow-400">
              <Zap className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-white">5,000+ Req/Sec Concurrency</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              By utilizing WAL mode and in-process C memory lookups, database queries execute in 0.02ms—completely bypassing socket TCP handshakes and wire serialization.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#121217] p-6 space-y-4">
            <div className="h-10 w-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
              <HardDrive className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-white">Docker 1-Click Deployment</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Pre-configured multi-stage `Dockerfile` with Litestream bundled. Deploy to Coolify, Dokku, Hetzner, DigitalOcean, or Fly.io in under 60 seconds.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#121217] p-6 space-y-4">
            <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Layers className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-white">Pre-Wired Stripe Webhooks</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Ready-to-use subscription checkout sessions and background webhook reconciliation to automatically grant Pro entitlements upon successful payment.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Simple, Transparent Pricing
          </h2>
          <p className="mt-4 text-zinc-400">
            Everything is 100% free and open-source under the MIT license.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-2xl border p-8 flex flex-col justify-between ${
                plan.popular
                  ? 'border-emerald-500 bg-emerald-950/10 ring-1 ring-emerald-500 shadow-xl'
                  : 'border-white/10 bg-[#121217]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                  {plan.popular && (
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500 text-zinc-950 uppercase tracking-wider">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-4xl font-extrabold text-white">{plan.price}</span>
                  <span className="text-sm text-zinc-400 font-medium">/ {plan.frequency}</span>
                </div>
                <p className="text-sm text-zinc-400 mb-6">{plan.description}</p>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-sm text-zinc-300">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Link
                href="/register"
                className={`w-full text-center py-3 px-4 rounded-xl text-sm font-bold transition-all ${
                  plan.popular
                    ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/20'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Call to action */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-10 sm:p-14 space-y-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Build Your Next SaaS on Solid Ground.
          </h2>
          <p className="text-zinc-400 max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
            Clone the repository, run `npm install`, and launch your next idea without worrying about database limits or surprise bills.
          </p>
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 bg-emerald-500 text-zinc-950 font-bold px-7 py-3.5 rounded-xl hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-500/25"
            >
              Start Building Now
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="https://github.com/locionic/litesaas"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-white/5 border border-white/10 text-white font-medium px-6 py-3.5 rounded-xl hover:bg-white/10 transition-colors"
            >
              Star on GitHub
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
