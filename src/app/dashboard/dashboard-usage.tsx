import { Archive, Layers } from 'lucide-react';

export type UsageProps = {
  plan: string;
  activeCount: number;
  archivedCount: number;
  projectLimit: number;
};

export default function DashboardUsage({
  plan,
  activeCount,
  archivedCount,
  projectLimit,
}: UsageProps) {
  // `projectLimitFor` is the only thing that decides what a plan allows, and it
  // answers Infinity for Pro. Deriving everything from its result keeps this
  // component from becoming a second place that knows which plans are capped.
  const capped = Number.isFinite(projectLimit);

  // Infinity - n is Infinity, so Pro needs no separate branch for headroom.
  const headroom = projectLimit - activeCount;
  const atCap = headroom <= 0;

  const total = activeCount + archivedCount;
  // Scaled to the wider of the quota and what the account actually holds. An
  // account with more archived projects than the free tier has slots would
  // otherwise pin the bar at 100% and hide the overflow behind it.
  const scale = Math.max(capped ? projectLimit : 0, total, 1);
  const width = (n: number) => `${(n / scale) * 100}%`;

  // Amber at the cap and nowhere else. The meter above this card already owns
  // that colour, and two widgets next to each other disagreeing about whether
  // the same account is at its limit is worse than a missing warning.
  const accent = capped && atCap ? 'amber' : 'emerald';

  return (
    <section
      aria-labelledby="usage-analytics-heading"
      className="rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2
          id="usage-analytics-heading"
          className="text-sm font-bold text-white flex items-center gap-2"
        >
          <Layers className="h-4 w-4 text-emerald-400" />
          Usage analytics
        </h2>
        <span
          className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-0.5 rounded-full border ${
            capped
              ? 'bg-zinc-800 text-zinc-400 border-white/5'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}
        >
          {plan} plan
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-0.5">
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            Active
          </span>
          <div className="text-xl font-mono font-bold text-white">{activeCount}</div>
          <span className="text-[11px] text-zinc-500">
            {capped ? `of ${projectLimit} allowed` : 'no cap'}
          </span>
        </div>

        <div className="space-y-0.5">
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1">
            <Archive className="h-3 w-3" />
            Archived
          </span>
          <div className="text-xl font-mono font-bold text-white">{archivedCount}</div>
          <span className="text-[11px] text-zinc-500">not charged to quota</span>
        </div>

        <div className="space-y-0.5">
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            Headroom
          </span>
          <div className="text-xl font-mono font-bold text-white">
            {capped ? headroom : '∞'}
          </div>
          <span className="text-[11px] text-zinc-500">
            {capped ? 'before the cap' : 'unlimited'}
          </span>
        </div>
      </div>

      {/* Composition, not usage against a denominator: archived projects are
          shown at their real width but the slot line marks where the quota
          runs out, so the two can be read against each other. The numbers above
          already say all of this, so the bar is decoration to a screen reader. */}
      <div className="space-y-1.5">
        <div aria-hidden="true" className="relative h-2 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${
              accent === 'amber' ? 'bg-amber-400' : 'bg-emerald-500'
            }`}
            style={{ width: width(activeCount) }}
          />
          <div
            className="absolute inset-y-0 rounded-full bg-zinc-600"
            style={{ left: width(activeCount), width: width(archivedCount) }}
          />
          {capped && (
            <div className="absolute inset-y-0 w-px bg-white/70" style={{ left: width(projectLimit) }} />
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Active
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-zinc-600" />
              Archived
            </span>
          </span>
          {capped ? (
            <span className="font-mono">{Math.round((activeCount / projectLimit) * 100)}% of quota</span>
          ) : (
            <span className="font-mono">{total} total</span>
          )}
        </div>
      </div>

      <p className={`text-[11px] ${accent === 'amber' ? 'text-amber-400' : 'text-zinc-500'}`}>
        {capped
          ? atCap
            ? 'At the cap — archiving one makes room for another.'
            : `${headroom} more ${headroom === 1 ? 'project' : 'projects'} before the ${plan} cap.`
          : `Unlimited projects — the ${plan} plan has no quota.`}
      </p>
    </section>
  );
}
