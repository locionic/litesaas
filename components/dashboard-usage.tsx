import React from 'react';
import {
  Layers,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  TrendingUp,
  FolderGit2,
  Archive,
} from 'lucide-react';

export const DEFAULT_FREE_PROJECT_LIMIT = 3;

/**
 * Computes the maximum active projects allowed for a given subscription plan.
 * Free plan is capped at DEFAULT_FREE_PROJECT_LIMIT (3); Pro plan is Infinity (unlimited).
 */
export function getProjectLimit(plan?: string, explicitLimit?: number): number {
  if (explicitLimit !== undefined) {
    return explicitLimit;
  }
  if (!plan) {
    return DEFAULT_FREE_PROJECT_LIMIT;
  }
  return plan.toLowerCase() === 'pro' ? Infinity : DEFAULT_FREE_PROJECT_LIMIT;
}

/**
 * Calculates bounded quota usage percentage (0 - 100).
 * Unlimited quota returns 0 (uncapped).
 */
export function calculateUsagePercentage(activeCount: number, limit: number): number {
  if (!Number.isFinite(limit) || limit === Infinity) {
    return 0;
  }
  if (limit <= 0) {
    return 100;
  }
  const pct = (activeCount / limit) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/**
 * Derived quota status analytics.
 */
export function getQuotaStatus(
  activeCount: number,
  limit: number,
  plan?: string
) {
  const isUnlimited = !Number.isFinite(limit) || limit === Infinity;
  const usagePercentage = calculateUsagePercentage(activeCount, limit);
  const atLimit = !isUnlimited && activeCount >= limit;
  const nearLimit = !isUnlimited && !atLimit && activeCount >= Math.ceil(limit * 0.66);
  const remainingSlots = isUnlimited ? Infinity : Math.max(0, limit - activeCount);
  const isPro = (plan || '').toLowerCase() === 'pro';

  return {
    isUnlimited,
    usagePercentage,
    atLimit,
    nearLimit,
    remainingSlots,
    isPro,
  };
}

export interface ProjectItem {
  status: 'active' | 'archived' | string;
  [key: string]: unknown;
}

export interface DashboardUsageProps {
  /** Number of active projects */
  activeCount?: number;
  /** Quota limit for active projects (defaults to 3 for Free, Infinity for Pro) */
  projectLimit?: number;
  /** User subscription plan: 'free' | 'pro' | string */
  subscriptionPlan?: string;
  /** Number of archived projects (optional) */
  archivedCount?: number;
  /** Total project count (optional) */
  totalCount?: number;
  /** Optional project collection to automatically compute active/archived counts */
  projects?: ProjectItem[];
  /** Whether to show detailed analytics breakdown cards (default: true) */
  showAnalyticsBreakdown?: boolean;
  /** Additional CSS class names */
  className?: string;
}

export default function DashboardUsage({
  activeCount,
  projectLimit,
  subscriptionPlan = 'free',
  archivedCount,
  totalCount,
  projects,
  showAnalyticsBreakdown = true,
  className = '',
}: DashboardUsageProps) {
  // Derive counts from projects array if passed, otherwise use explicit counts
  const derivedActiveCount = projects ? projects.filter((p) => p.status === 'active').length : 0;
  const derivedArchivedCount = projects ? projects.filter((p) => p.status === 'archived').length : 0;
  const derivedTotalCount = projects ? projects.length : 0;

  const effectiveActiveCount = activeCount ?? (projects ? derivedActiveCount : 0);
  const effectiveArchivedCount = archivedCount ?? (projects ? derivedArchivedCount : 0);
  const effectiveTotalCount =
    totalCount ?? (projects ? derivedTotalCount : effectiveActiveCount + effectiveArchivedCount);

  const effectiveLimit = getProjectLimit(subscriptionPlan, projectLimit);
  const status = getQuotaStatus(effectiveActiveCount, effectiveLimit, subscriptionPlan);

  const planLabel = status.isPro ? 'Pro' : subscriptionPlan.charAt(0).toUpperCase() + subscriptionPlan.slice(1);

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-5 ${className}`}
      data-testid="dashboard-usage-widget"
    >
      {/* Header with Title and Plan Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              Subscription &amp; Quota Usage
            </h2>
            <p className="text-xs text-zinc-400">Project capacity and active usage analytics</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-0.5 rounded-full border ${
              status.isPro
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-zinc-800 text-zinc-400 border-white/5'
            }`}
          >
            {planLabel} Plan
          </span>
        </div>
      </div>

      {/* Visual Progress Bar Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-emerald-400" />
            Active Projects Quota
            <span
              className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
                status.isUnlimited
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : status.atLimit
                  ? 'bg-amber-400/10 text-amber-400'
                  : 'bg-white/5 text-zinc-400'
              }`}
            >
              {status.isUnlimited ? 'Unlimited' : `${status.usagePercentage}% Used`}
            </span>
          </span>

          <span
            className={`font-mono ${
              status.atLimit ? 'text-amber-400 font-semibold' : 'text-zinc-400'
            }`}
          >
            {status.isUnlimited
              ? `${effectiveActiveCount} active • No quota limit`
              : `${effectiveActiveCount} of ${effectiveLimit} active${
                  status.atLimit ? ' — limit reached' : ''
                }`}
          </span>
        </div>

        {/* Progress Bar Track & Indicator */}
        <div
          className="h-2.5 rounded-full bg-white/5 overflow-hidden"
          role="progressbar"
          aria-valuenow={effectiveActiveCount}
          aria-valuemin={0}
          aria-valuemax={status.isUnlimited ? 100 : effectiveLimit}
          aria-label="Active projects used"
          aria-valuetext={
            status.isUnlimited
              ? `${effectiveActiveCount} active projects (Unlimited quota)`
              : `${effectiveActiveCount} of ${effectiveLimit} active projects used (${status.usagePercentage}%)`
          }
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              status.isUnlimited
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400 w-full'
                : status.atLimit
                ? 'bg-amber-400'
                : status.nearLimit
                ? 'bg-amber-300'
                : 'bg-emerald-500'
            }`}
            style={{ width: status.isUnlimited ? '100%' : `${status.usagePercentage}%` }}
          />
        </div>
      </div>

      {/* Analytics Breakdown Grid */}
      {showAnalyticsBreakdown && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          <div className="rounded-xl border border-white/5 bg-zinc-950/40 p-3 space-y-1">
            <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1">
              <FolderGit2 className="h-3 w-3 text-emerald-400" />
              Active Projects
            </span>
            <div className="text-lg font-mono font-bold text-white">
              {effectiveActiveCount}
            </div>
            <p className="text-[10px] text-zinc-500 font-mono">
              of {status.isUnlimited ? '∞' : effectiveLimit} allowed
            </p>
          </div>

          <div className="rounded-xl border border-white/5 bg-zinc-950/40 p-3 space-y-1">
            <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1">
              <Layers className="h-3 w-3 text-blue-400" />
              Plan Quota
            </span>
            <div className="text-lg font-mono font-bold text-white">
              {status.isUnlimited ? 'Unlimited' : `${effectiveLimit}`}
            </div>
            <p className="text-[10px] text-zinc-500">
              {status.isPro ? 'No project limit' : 'Active project cap'}
            </p>
          </div>

          <div className="rounded-xl border border-white/5 bg-zinc-950/40 p-3 space-y-1">
            <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-purple-400" />
              Usage Rate
            </span>
            <div className="text-lg font-mono font-bold text-white">
              {status.isUnlimited ? 'Uncapped' : `${status.usagePercentage}%`}
            </div>
            <p className="text-[10px] text-zinc-500">
              {status.atLimit ? 'At maximum quota' : status.nearLimit ? 'High capacity' : 'Healthy usage'}
            </p>
          </div>

          <div className="rounded-xl border border-white/5 bg-zinc-950/40 p-3 space-y-1">
            <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1">
              <Archive className="h-3 w-3 text-yellow-400" />
              Available Slots
            </span>
            <div className="text-lg font-mono font-bold text-white">
              {status.isUnlimited ? '∞' : status.remainingSlots}
            </div>
            <p className="text-[10px] text-zinc-500">
              {status.isUnlimited
                ? 'Unrestricted'
                : status.remainingSlots === 0
                ? 'Archive to free up'
                : 'Remaining capacity'}
            </p>
          </div>
        </div>
      )}

      {/* Advisory Status Banner */}
      {status.isPro ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            Production Pro license active. Enjoy unlimited projects, automated backups, and unrestricted SQLite databases.
          </span>
        </div>
      ) : status.atLimit ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            Plan quota limit reached ({effectiveActiveCount} of {effectiveLimit} active projects). Archive existing projects to create space, or upgrade to Pro for unlimited projects.
          </span>
        </div>
      ) : status.nearLimit ? (
        <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-300/90 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            Approaching quota limit: {status.remainingSlots} project slot remaining before reaching your plan limit.
          </span>
        </div>
      ) : (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 text-xs text-zinc-400 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            {status.remainingSlots} active project {status.remainingSlots === 1 ? 'slot' : 'slots'} available on your Free Indie plan.
          </span>
        </div>
      )}
    </div>
  );
}

export { DashboardUsage };
