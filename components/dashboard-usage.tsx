import { Layers } from 'lucide-react';

interface DashboardUsageProps {
  activeCount: number;
  projectLimit: number | Infinity;
  atProjectLimit: boolean;
  subscriptionPlan: string;
}

export default function DashboardUsage({
  activeCount,
  projectLimit,
  atProjectLimit,
  subscriptionPlan,
}: DashboardUsageProps) {
  const isPro = subscriptionPlan === 'pro';
  const displayLimit = isPro ? Infinity : projectLimit;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#121217] px-5 py-4 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-zinc-400 flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-emerald-400" />
          Project usage
        </span>
        <span
          className={`font-mono ${atProjectLimit ? 'text-amber-400' : 'text-zinc-400'}`}
        >
          {activeCount} of {displayLimit}
          {atProjectLimit ? ' — archive one to make room' : ''}
        </span>
      </div>
      {!isPro && (
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
      )}
    </div>
  );
}