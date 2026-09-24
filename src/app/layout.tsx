import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { Database, Github, ArrowRight, Sparkles } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'LiteSaaS - Zero-Cost Production Next.js 15 + SQLite SaaS Starter Kit',
  description:
    'Stop paying $25/mo for managed PostgreSQL. Production-ready Next.js 15 boilerplate powered by SQLite, Drizzle ORM, Self-Hosted Auth, and Litestream S3 backup.',
  openGraph: {
    title: 'LiteSaaS - Zero-Cost Next.js 15 + SQLite SaaS Starter',
    description: 'Production-ready SQLite architecture with 5,000+ req/s concurrency and zero database bills.',
    type: 'website',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen flex flex-col bg-[#09090b] text-zinc-100 antialiased selection:bg-emerald-500/20 selection:text-emerald-400">
        {/* Navigation Bar */}
        <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-[#09090b]/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                <Database className="h-4 w-4" />
              </div>
              <span className="font-bold text-base tracking-tight text-white flex items-center gap-1.5">
                LiteSaaS
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  SQLite
                </span>
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-sm text-zinc-400 font-medium">
              <Link href="/#architecture" className="hover:text-white transition-colors">
                Architecture
              </Link>
              <Link href="/#calculator" className="hover:text-white transition-colors">
                Cost Calculator
              </Link>
              <Link href="/#pricing" className="hover:text-white transition-colors">
                Pricing
              </Link>
              <a
                href="https://locionic.com/en/blog/sqlite-wal-mode-production-concurrency"
                target="_blank"
                rel="noreferrer"
                className="hover:text-white transition-colors flex items-center gap-1 text-emerald-400"
              >
                <Sparkles className="h-3.5 w-3.5" />
                SQLite Benchmark Guide
              </a>
            </nav>

            <div className="flex items-center gap-3">
              <a
                href="https://github.com/locionic/litesaas"
                target="_blank"
                rel="noreferrer"
                className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                title="GitHub Repository"
              >
                <Github className="h-4 w-4" />
              </a>

              {user ? (
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-500 text-zinc-950 px-3.5 py-2 rounded-lg hover:bg-emerald-400 transition-colors shadow-sm shadow-emerald-500/20"
                >
                  Dashboard
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-xs font-medium text-zinc-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    Log In
                  </Link>
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white text-zinc-950 px-3.5 py-2 rounded-lg hover:bg-zinc-200 transition-colors"
                  >
                    Get Started Free
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1">{children}</main>

        {/* Global Footer */}
        <footer className="border-t border-white/5 bg-[#09090b] py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-zinc-500">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-400" />
              <span className="font-semibold text-zinc-300">LiteSaaS</span>
              <span>— MIT Open-Source SaaS Starter Kit</span>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <a
                href="https://locionic.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-emerald-400 transition-colors"
              >
                Built by Locionic
              </a>
              <a
                href="https://locionic.com/en/blog/sqlite-wal-mode-production-concurrency"
                target="_blank"
                rel="noreferrer"
                className="hover:text-emerald-400 transition-colors"
              >
                SQLite Architecture Paper
              </a>
              <a
                href="https://github.com/locionic/litesaas"
                target="_blank"
                rel="noreferrer"
                className="hover:text-white transition-colors"
              >
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
