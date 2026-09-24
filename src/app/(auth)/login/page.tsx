'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Database, Lock, Mail, ArrowRight, Sparkles, AlertCircle } from 'lucide-react';
import { loginAction } from '@/app/actions/auth';

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const fillDemo = () => {
    setEmail('demo@litesaas.dev');
    setPassword('password123');
  };

  return (
    <div className="min-h-[calc(100vh-14rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 items-center justify-center text-emerald-400 mb-2">
            <Database className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Welcome back</h1>
          <p className="text-sm text-zinc-400">Sign in to your LiteSaaS dashboard</p>
        </div>

        {/* Demo Quick-Fill Banner */}
        <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-emerald-300">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>Pre-seeded demo account available</span>
          </div>
          <button
            type="button"
            onClick={fillDemo}
            className="font-bold underline text-emerald-400 hover:text-emerald-300"
          >
            Auto-fill credentials
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#121217] p-6 sm:p-8 space-y-6 shadow-xl">
          {state?.error && (
            <div className="p-3 rounded-xl border border-red-500/20 bg-red-950/20 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3 h-4 w-4 text-zinc-500" />
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-zinc-500" />
                <input
                  name="password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full py-3 px-4 rounded-xl bg-emerald-500 text-zinc-950 font-bold text-sm hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2 shadow-sm shadow-emerald-500/20 disabled:opacity-50"
            >
              {isPending ? 'Signing in...' : 'Sign In'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <div className="pt-4 border-t border-white/5 text-center text-xs text-zinc-500">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-emerald-400 font-semibold hover:underline">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
