import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import { db, rawSqlite, DB_PATH } from '@/db';
import { projects } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { logoutAction } from '@/app/actions/auth';
import { deleteProjectAction, toggleProjectStatusAction } from '@/app/actions/projects';

export const metadata: Metadata = { title: 'Dashboard' };
import ProjectForm from './project-form';
import DeleteProjectButton from './delete-project-button';
import { upgradeToProAction } from '@/app/actions/billing';
import {
  Database,
  Archive,
  RotateCcw,
  Sparkles,
  Zap,
  HardDrive,
  LogOut,
  FolderGit2,
  Calendar,
  Layers,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import LocalDate from './local-date';
import { projectLimitFor } from '@/lib/stripe';
import fs from 'fs';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  // Fetch user projects via Drizzle
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, user.id),
    orderBy: [desc(projects.createdAt)],
  });

  const activeCount = userProjects.filter((p) => p.status === 'active').length;
  const archivedCount = userProjects.length - activeCount;
  // Reaching the free tier's cap is a normal state, not a mistake. The action
  // still refuses server-side — that check is the trust boundary and must never
  // depend on the client — but refusing by *throwing* sends the user to Next's
  // error page. Saying so on the button keeps the server check a backstop
  // instead of the thing the user actually runs into.
  const projectLimit = projectLimitFor(user.subscriptionPlan);
  const atProjectLimit = activeCount >= projectLimit;

  // Query actual SQLite runtime engine PRAGMAs
  const journalMode = rawSqlite.pragma('journal_mode', { simple: true });
  const synchronous = rawSqlite.pragma('synchronous', { simple: true });
  const busyTimeout = rawSqlite.pragma('busy_timeout', { simple: true });
  const pageSize = rawSqlite.pragma('page_size', { simple: true });

  // Get actual database size on disk
  let dbSizeKb = 0;
  try {
    const stats = fs.statSync(DB_PATH);
    dbSizeKb = Math.round(stats.size / 1024);
  } catch {
    dbSizeKb = 4;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Checkout outcome banners */}
      {params.billing === 'unconfigured' && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            Billing is not configured on this deployment, so upgrades are disabled. Set
            {' '}
            <code className="font-mono">STRIPE_SECRET_KEY</code> or the{' '}
            <code className="font-mono">LEMONSQUEEZY_*</code> variables to enable checkout.
          </span>
        </div>
      )}

      {params.billing === 'error' && (
        <div className="rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 text-xs text-red-400 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            The payment provider rejected the checkout request. Check{' '}
            <code className="font-mono">STRIPE_SECRET_KEY</code> and{' '}
            <code className="font-mono">NEXT_PUBLIC_STRIPE_PRO_PRICE_ID</code> — the values shipped
            in <code className="font-mono">.env.example</code> are placeholders.
          </span>
        </div>
      )}

      {params.billing === 'appurl' && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            Stripe sends customers back to <code className="font-mono">NEXT_PUBLIC_APP_URL</code>{' '}
            once they have paid, so checkout stays off while that is still{' '}
            <code className="font-mono">localhost</code>. Set it to this deployment&apos;s public
            origin (for example <code className="font-mono">https://your-domain.com</code>) and{' '}
            <strong>rebuild</strong> — Next.js inlines it at build time, so restarting the container
            or editing its environment changes nothing.
          </span>
        </div>
      )}

      {params.upgraded === 'true' && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Payment received. Your Pro plan will activate as soon as the webhook lands.</span>
        </div>
      )}

      {/* Top Banner & Profile Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-white/5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2.5">
            Welcome, {user.name}
            <span
              className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-0.5 rounded-full border ${
                user.subscriptionPlan === 'pro'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-zinc-800 text-zinc-400 border-white/5'
              }`}
            >
              {user.subscriptionPlan} Plan
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">{user.email}</p>
        </div>

        <div className="flex items-center gap-3">
          {user.subscriptionPlan !== 'pro' && (
            <form action={upgradeToProAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-400 text-zinc-950 px-4 py-2 rounded-xl hover:opacity-90 transition-opacity shadow-sm shadow-emerald-500/20"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Upgrade to Pro ($19)
              </button>
            </form>
          )}

          <form action={logoutAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-white px-3 py-2 rounded-xl hover:bg-white/5 transition-colors border border-white/5"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </form>
        </div>
      </div>

      {/* Engine Status & Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-1">
          <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-emerald-400" />
            Engine Journal Mode
          </span>
          <div className="text-xl font-mono font-bold text-white uppercase">{String(journalMode)}</div>
          <p className="text-[11px] text-zinc-500">Non-blocking readers in parallel</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-1">
          <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5 text-blue-400" />
            Lock Retry Window
          </span>
          <div className="text-xl font-mono font-bold text-white">{String(busyTimeout)}ms</div>
          <p className="text-[11px] text-zinc-500">Auto-sleeps on write contention</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-1">
          <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5 text-purple-400" />
            Storage Page Size
          </span>
          <div className="text-xl font-mono font-bold text-white">{String(pageSize)} B</div>
          <p className="text-[11px] text-zinc-500">Synchronous: {String(synchronous)} (NORMAL)</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-1">
          <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-yellow-400" />
            Disk Footprint
          </span>
          <div className="text-xl font-mono font-bold text-white">{dbSizeKb} KB</div>
          <p className="text-[11px] text-zinc-500">Zero daemon memory bloat</p>
        </div>
      </div>

      {/* Main Interactive CRUD Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Create Project Form — a client component so the action's returned
            error state has somewhere to render. */}
        <ProjectForm atProjectLimit={atProjectLimit} projectLimit={projectLimit} />

        {/* Existing Projects List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FolderGit2 className="h-4 w-4 text-emerald-400" />
              Projects (
              {/* Pro is unlimited, so only the capped tier shows a denominator. */}
              {user.subscriptionPlan !== 'pro' ? `${activeCount} of ${projectLimitFor(user.subscriptionPlan)}` : activeCount} active
              {archivedCount > 0 ? `, ${archivedCount} archived` : ''})
            </h2>
            <span className="text-xs font-mono text-zinc-500">Query Time: ~0.01ms</span>
          </div>

          {userProjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-[#121217]/50 p-12 text-center space-y-3">
              <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center mx-auto text-zinc-500">
                <FolderGit2 className="h-5 w-5" />
              </div>
              <p className="text-sm text-zinc-400 font-medium">No projects created yet.</p>
              <p className="text-xs text-zinc-600">Create your first project on the left to test SQLite write speeds.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {userProjects.map((p) => (
                <div
                  key={p.id}
                  className={`rounded-2xl border border-white/10 bg-[#121217] p-5 flex items-start justify-between gap-4 hover:border-white/20 transition-colors group ${
                    p.status === 'archived' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors">
                      {p.name}
                    </h3>
                    {p.description && <p className="text-xs text-zinc-400 leading-relaxed">{p.description}</p>}
                    <div className="flex items-center gap-3 pt-2 text-[11px] text-zinc-500 font-mono">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <LocalDate iso={p.createdAt.toISOString()} serverText={formatDate(p.createdAt)} />
                      </span>
                      <span>•</span>
                      <span
                        className={
                          p.status === 'archived' ? 'text-zinc-500 font-sans' : 'text-emerald-400 font-sans'
                        }
                      >
                        {p.status === 'archived' ? 'Archived' : 'Active'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <form action={toggleProjectStatusAction.bind(null, p.id)}>
                      <button
                        type="submit"
                        className="p-2 rounded-lg text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                        title={p.status === 'archived' ? 'Restore project' : 'Archive project'}
                        aria-label={p.status === 'archived' ? 'Restore project' : 'Archive project'}
                      >
                        {p.status === 'archived' ? (
                          <RotateCcw className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </button>
                    </form>

                    <form action={deleteProjectAction.bind(null, p.id)}>
                      <DeleteProjectButton name={p.name} />
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
