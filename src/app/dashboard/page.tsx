import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUser, DEMO_EMAIL } from '@/lib/auth';
import { db, rawSqlite, DB_PATH } from '@/db';
import { projects } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { logoutAction } from '@/app/actions/auth';
import { deleteProjectAction, toggleProjectStatusAction } from '@/app/actions/projects';

export const metadata: Metadata = { title: 'Dashboard' };
import ProjectForm from './project-form';
import EditProjectForm from './edit-project-form';
import DeleteProjectButton from './delete-project-button';
import { upgradeToProAction } from '@/app/actions/billing';
import DeleteAccountForm from './delete-account-form';
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
  Download,
  Search,
  Pencil,
  TriangleAlert,
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

  // Fetch user projects via Drizzle. Timed, because the four cards in the
  // metrics strip below are all read from this database and the strip gave the
  // last one a hardcoded sub-millisecond figure — so a visitor saw four live
  // readings and one invented one, in the same font, with nothing to tell them
  // apart. The marketing figures on the landing page stay hardcoded; those are
  // the pitch. This one is a claim about *this* instance, so it has to be one.
  const queryStart = performance.now();
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, user.id),
    orderBy: [desc(projects.createdAt)],
  });
  const queryMs = performance.now() - queryStart;

  const activeCount = userProjects.filter((p) => p.status === 'active').length;
  const archivedCount = userProjects.length - activeCount;
  // Reaching the free tier's cap is a normal state, not a mistake. The action
  // still refuses server-side — that check is the trust boundary and must never
  // depend on the client — but refusing by *throwing* sends the user to Next's
  // error page. Saying so on the button keeps the server check a backstop
  // instead of the thing the user actually runs into.
  const projectLimit = projectLimitFor(user.subscriptionPlan);
  const atProjectLimit = activeCount >= projectLimit;

  // The seeded demo account. Its password is printed in the README, so anybody
  // reading the repo has it — and a shared public demo is the account most
  // likely to be deleted by someone who did not mean to.
  const isDemo = user.email === DEMO_EMAIL;

  // The filter narrows the LIST, never the counts. `activeCount` gates the
  // create button and the meter beside it, so counting the filtered rows would
  // tell someone with three projects and a search open that they have none — and
  // light up a button the server is about to refuse.
  //
  // In memory rather than in SQL, and deliberately so: the page already reads
  // every row to compute the counts and the strip, so a second scoped query
  // would buy nothing and could drift out of step with the first.
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const needle = q.toLowerCase();

  // Second filter, same rules. The free tier caps *active* projects, but
  // archiving is unlimited and the cap message tells users to archive — so the
  // archive list is the one that grows without bound, and it grows inside a list
  // that also shows everything else. Only ever one of the three, and read off a
  // closed set rather than passed through: `?status=` is attacker-chosen the
  // same way `?q=` is, and an unrecognised value falls back to 'all' rather
  // than narrowing to nothing.
  const status =
    params.status === 'archived' ? 'archived' : params.status === 'active' ? 'active' : 'all';
  const statusMatched =
    status === 'all' ? userProjects : userProjects.filter((p) => p.status === status);

  const visibleProjects = needle
    ? statusMatched.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          (p.description ?? '').toLowerCase().includes(needle)
      )
    : statusMatched;

  /**
   * A filter link that keeps the other one.
   *
   * `?q` and `?status` are independent and compose, so switching status with a
   * search open should not silently discard the search. Dropping the other
   * parameter instead is the tempting one-line version and it is what makes a
   * user lose their place twice in a row.
   */
  const filterHref = (next: string): string => {
    const search = new URLSearchParams();
    if (needle) search.set('q', q);
    if (next !== 'all') search.set('status', next);
    const query = search.toString();
    return query ? `/dashboard?${query}` : '/dashboard';
  };

  // Counts per tab come from `userProjects`, not from `statusMatched`. They are
  // navigation, and a navigation target that changes size depending on where you
  // came from is a tab that makes you distrust it.
  const statusTabs = [
    { key: 'all', label: 'All', count: userProjects.length },
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'archived', label: 'Archived', count: archivedCount },
  ];

  // Query actual SQLite runtime engine PRAGMAs
  const journalMode = rawSqlite.pragma('journal_mode', { simple: true });
  const synchronous = rawSqlite.pragma('synchronous', { simple: true });
  const busyTimeout = rawSqlite.pragma('busy_timeout', { simple: true });
  const pageSize = rawSqlite.pragma('page_size', { simple: true });

  // Get actual database size on disk
  let dbSizeKb: number | null = null;
  try {
    const stats = fs.statSync(DB_PATH);
    dbSizeKb = Math.round(stats.size / 1024);
  } catch {
    // Left null, and rendered as an em dash below — deliberately not 0 and not
    // the 4 this used to invent. The other four cards are live PRAGMA readings
    // in the same font on the same strip, and a plausible number for a
    // measurement that never happened is the exact thing the query-time card
    // above was changed to stop doing. `4` looked like a small database and
    // read as fact; a dash reads as "unknown", which is what it is.
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

      {params.billing === 'price' && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <code className="font-mono">STRIPE_SECRET_KEY</code> is set, so checkout is ready —
            but there is no price to charge. Create a one-time $19 Price in Stripe and set{' '}
            <code className="font-mono">NEXT_PUBLIC_STRIPE_PRO_PRICE_ID</code> to its{' '}
            <code className="font-mono">price_…</code> id, then{' '}
            <strong>rebuild</strong>: Next.js inlines it at build time, so restarting the container
            or editing its environment changes nothing.
          </span>
        </div>
      )}

      {params.billing === 'webhook' && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            Checkout is switched off:{' '}
            <code className="font-mono">STRIPE_WEBHOOK_SECRET</code> is missing or is still the{' '}
            <code className="font-mono">whsec_…</code> placeholder from{' '}
            <code className="font-mono">.env.example</code>. That webhook is the only thing that turns
            a paid order into Pro, so without it a customer is charged and never receives the plan.
            In Stripe add the endpoint <code className="font-mono">/api/webhooks/stripe</code> for the{' '}
            <code className="font-mono">checkout.session.completed</code> and{' '}
            <code className="font-mono">charge.refunded</code> events, paste its signing secret here,
            and <strong>restart</strong> the container.
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
            The payment provider returns customers to{' '}
            <code className="font-mono">NEXT_PUBLIC_APP_URL</code> once they have paid, so checkout
            stays off while that is still <code className="font-mono">localhost</code>. Set it to this
            deployment&apos;s public
            origin (for example <code className="font-mono">https://your-domain.com</code>) and{' '}
            <strong>rebuild</strong> — Next.js inlines it at build time, so restarting the container
            or editing its environment changes nothing.
          </span>
        </div>
      )}

      {params.deleted === 'true' && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            Your account and everything in it has been deleted. Export anything you
            wanted to keep first — the JSON and CSV links above the project list.
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
          {/* Plain links, not forms and not a client component. A download is a
              GET, and a GET needs no button, no state and no hydration. */}
          <a
            href="/api/projects/export?format=json"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white px-3 py-2 rounded-xl hover:bg-white/5 transition-colors border border-white/5"
          >
            <Download className="h-3.5 w-3.5" />
            JSON
          </a>
          <a
            href="/api/projects/export?format=csv"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white px-3 py-2 rounded-xl hover:bg-white/5 transition-colors border border-white/5"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </a>
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

      {/* Plan usage — the one number that is about to stop the user doing
          something, so it gets a shape rather than a sentence. Pro has no cap,
          which is why this is conditional rather than showing a full bar. */}
      {user.subscriptionPlan !== 'pro' && (
        <div className="rounded-2xl border border-white/10 bg-[#121217] px-5 py-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-zinc-400 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-emerald-400" />
              Plan usage
            </span>
            <span
              className={`font-mono ${atProjectLimit ? 'text-amber-400' : 'text-zinc-400'}`}
            >
              {activeCount} of {projectLimit} active
              {atProjectLimit ? ' — archive one to make room' : ''}
            </span>
          </div>
          <div
            className="h-1.5 rounded-full bg-white/5 overflow-hidden"
            role="progressbar"
            aria-valuenow={activeCount}
            aria-valuemin={0}
            aria-valuemax={projectLimit}
            aria-label="Active projects used"
          >
            <div
              className={`h-full rounded-full ${atProjectLimit ? 'bg-amber-400' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, (activeCount / projectLimit) * 100)}%` }}
            />
          </div>
        </div>
      )}

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
          <div className="text-xl font-mono font-bold text-white">
            {dbSizeKb === null ? '—' : `${dbSizeKb} KB`}
          </div>
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
            <span className="text-xs font-mono text-zinc-500">
              Query Time: {queryMs < 0.01 ? '<0.01' : queryMs.toFixed(2)}ms
            </span>
          </div>

          {/* Plain links and a plain GET form — no client component, no hydrated
              state, no tab dependency. The tab carries `q` through its href and
              the form carries `status` through a hidden input, because a GET
              form replaces the whole query string with its own fields: without
              that input, typing in the search box quietly drops you back to
              "all" and there is no way back. Only offered once there is
              something to filter. */}
          {userProjects.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                {statusTabs.map((tab) => (
                  <a
                    key={tab.key}
                    href={filterHref(tab.key)}
                    aria-current={status === tab.key ? 'page' : undefined}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      status === tab.key
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-white/5 text-zinc-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {tab.label}
                    <span className="font-mono text-[10px] text-zinc-500">{tab.count}</span>
                  </a>
                ))}
              </div>

              <form method="get" action="/dashboard" className="relative">
                {status !== 'all' && <input type="hidden" name="status" value={status} />}
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Filter projects…"
                  aria-label="Filter projects by name or description"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-white/10 bg-zinc-900 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 focus:outline-2 focus:outline-offset-2 focus:outline-emerald-500 transition-colors"
                />
              </form>
            </div>
          )}

          {userProjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-[#121217]/50 p-12 text-center space-y-3">
              <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center mx-auto text-zinc-500">
                <FolderGit2 className="h-5 w-5" />
              </div>
              <p className="text-sm text-zinc-400 font-medium">No projects created yet.</p>
              <p className="text-xs text-zinc-600">Create your first project on the left to test SQLite write speeds.</p>
            </div>
          ) : visibleProjects.length === 0 ? (
            // A distinct state, not the "create your first project" one above:
            // telling someone with nine projects that they have none, because
            // they typed a filter that missed, is the failure this avoids. The
            // message names which filter got there — "nothing matches" is wrong
            // when the search was empty and they were looking at Archived.
            <div className="rounded-2xl border border-dashed border-white/10 bg-[#121217]/50 p-12 text-center space-y-3">
              <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center mx-auto text-zinc-500">
                <Search className="h-5 w-5" />
              </div>
              <p className="text-sm text-zinc-400 font-medium">
                {needle
                  ? `Nothing matches “${q}”${status === 'all' ? '.' : ` in ${status} projects.`}`
                  : status === 'archived'
                    ? 'No archived projects.'
                    : 'No active projects.'}
              </p>
              {/* Both filters, so the link says what it does. `filterHref('all')`
                  would keep `q`, and a link labelled "clear the filter" that
                  leaves half of it in place is worse than no link. */}
              <a
                href="/dashboard"
                className="inline-block text-xs text-emerald-400 font-semibold hover:underline"
              >
                Clear the filter
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleProjects.map((p) => (
                <div
                  key={p.id}
                  className={`rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-3 hover:border-white/20 transition-colors group ${
                    p.status === 'archived' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
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
                          title={p.status === 'archived' ? `Restore ${p.name}` : `Archive ${p.name}`}
                          aria-label={p.status === 'archived' ? `Restore ${p.name}` : `Archive ${p.name}`}
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

                  {/* A native disclosure, not a button plus `useState`. The row is
                      a server component and the only thing this needs is to open —
                      which `<details>` does from the keyboard and the screen
                      reader with no client JS at all. The form it reveals is the
                      one part that has to be a client component. */}
                  <details className="group/edit">
                    <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-emerald-400 transition-colors [&::-webkit-details-marker]:hidden">
                      <Pencil className="h-3 w-3" />
                      Edit name &amp; description for {p.name}
                    </summary>
                    <EditProjectForm projectId={p.id} name={p.name} description={p.description} />
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Danger zone. Behind a native disclosure for the same reason the edit form
          is: the row is a server component and the only thing this needs is to
          open. Not rendered at all on the demo account — a shared public demo
          whose password is printed in the README is exactly the account someone
          else would delete, and a deleted demo account is a broken live link
          rather than a security win. */}
      {!isDemo && (
        <div className="rounded-2xl border border-red-500/20 bg-red-950/10">
          <details className="group/danger">
            <summary className="cursor-pointer list-none px-6 py-4 inline-flex items-center gap-2 text-xs font-semibold text-zinc-400 hover:text-white transition-colors [&::-webkit-details-marker]:hidden">
              <TriangleAlert className="h-3.5 w-3.5 text-red-400" />
              Danger zone
              <span className="text-zinc-600 font-normal">— delete this account</span>
            </summary>
            <div className="px-6 pb-6 pt-2 max-w-md space-y-3">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Deletes your account, every project in it, and every session. There
                is no undo and no recovery — export first if you want a copy.
              </p>
              <DeleteAccountForm email={user.email} />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
