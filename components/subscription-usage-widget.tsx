'use client';

import { useState, useEffect } from 'react';
import {
  Layers,
  CheckCircle2,
  TriangleAlert,
  Sparkles,
  Zap,
  TrendingUp,
  ShieldCheck,
  Activity,
  ArrowUpRight,
  PieChart,
} from 'lucide-react';
import { projectLimitFor } from '@/lib/stripe';

export type SubscriptionPlan = 'free' | 'pro' | 'enterprise';

export interface SubscriptionUsageWidgetProps {
  activeCount: number;
  archivedCount: number;
  subscriptionPlan: SubscriptionPlan;
  storageUsedKb?: number | null;
  apiCallsCount?: number;
  showBreakdown?: boolean;
  className?: string;
}

export default function SubscriptionUsageWidget({
  activeCount,
  archivedCount,
  subscriptionPlan,
  storageUsedKb = null,
  apiCallsCount = 0,
  showBreakdown = true,
  className = '',
}: SubscriptionUsageWidgetProps) {
  const [usagePercentage, setUsagePercentage] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const limit = projectLimitFor(subscriptionPlan);
    if (limit === Infinity || limit === 0) {
      setUsagePercentage(0);
    } else {
      setUsagePercentage(Math.min(100, (activeCount / limit) * 100));
    }
  }, [activeCount, subscriptionPlan]);

  const limit = projectLimitFor(subscriptionPlan);
  const isUnlimited = limit === Infinity;
  const atLimit = !isUnlimited && activeCount >= limit;
  const slotsRemaining = isUnlimited ? Infinity : Math.max(0, limit - activeCount);
  const isNearLimit = !isUnlimited && slotsRemaining === 1;

  const usageText = isUnlimited
    ? `${activeCount} active${archivedCount > 0 ? `, ${archivedCount} archived` : ''}`
    : `${activeCount} of ${limit} active${archivedCount > 0 ? `, ${archivedCount} archived` : ''}`;

  const planBadgeConfig = {
    free: {
      label: 'Free Plan',
      badgeClass: 'bg-zinc-800/80 text-zinc-300 border-white/10',
      description: '3 active projects cap',
    },
    pro: {
      label: 'Pro Plan',
      badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-sm shadow-emerald-500/10',
      description: 'Unlimited active projects & priority SQLite performance',
    },
    enterprise: {
      label: 'Enterprise',
      badgeClass: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
      description: 'Custom multi-region & high availability',
    },
  }[subscriptionPlan] ?? {
    label: `${subscriptionPlan} Plan`,
    badgeClass: 'bg-zinc-800 text-zinc-400 border-white/5',
    description: 'Active subscription tier',
  };

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-4 shadow-xl shadow-black/20 ${className}`}
      data-testid="subscription-usage-widget"
    >
      {/* Header with Title, Plan Badge & Quick Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-white">Project Usage &amp; Analytics</span>
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border ${planBadgeConfig.badgeClass}`}>
                {planBadgeConfig.label}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">{planBadgeConfig.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {isUnlimited ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
              <Sparkles className="h-3 w-3" />
              Unlimited Quota
            </span>
          ) : atLimit ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
              <TriangleAlert className="h-3 w-3" />
              Limit Reached
            </span>
          ) : isNearLimit ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-yellow-300 bg-yellow-500/10 px-2.5 py-1 rounded-lg border border-yellow-500/20">
              <Activity className="h-3 w-3" />
              1 Slot Left
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
              <ShieldCheck className="h-3 w-3" />
              Healthy Quota
            </span>
          )}
        </div>
      </div>

      {/* Main Usage Summary & Metric Counter */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            Project Usage
          </span>
          <span className={`font-mono text-xs ${atLimit ? 'text-amber-400 font-semibold' : 'text-zinc-300'}`}>
            {usageText}
            {atLimit && ' — archive one to make room'}
          </span>
        </div>

        {/* Progress bar for capped tiers */}
        {subscriptionPlan !== 'pro' ? (
          <div className="space-y-1.5">
            <div
              className="h-2 rounded-full bg-white/5 overflow-hidden p-0.5 border border-white/5"
              role="progressbar"
              aria-valuenow={activeCount}
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-label="Active projects used"
            >
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  atLimit
                    ? 'bg-gradient-to-r from-amber-500 to-amber-400 shadow-sm shadow-amber-500/20'
                    : isNearLimit
                      ? 'bg-gradient-to-r from-yellow-500 to-amber-400'
                      : 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-sm shadow-emerald-500/20'
                }`}
                style={{ width: `${usagePercentage}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-0.5">
              <span>{Math.round(usagePercentage)}% of active quota utilized</span>
              <span>{slotsRemaining} {slotsRemaining === 1 ? 'slot' : 'slots'} remaining</span>
            </div>
          </div>
        ) : (
          /* Pro plan unlimited banner */
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-4 py-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-emerald-300">
              <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>Unlimited active projects on Pro plan. No quota thresholds enforced.</span>
            </div>
            <span className="font-mono text-emerald-400 font-semibold">{activeCount} active</span>
          </div>
        )}
      </div>

      {/* Warning or Remaining Slot Notification */}
      {subscriptionPlan !== 'pro' && (
        <>
          {atLimit ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 flex items-start gap-2.5">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
              <div className="space-y-1">
                <p className="font-medium text-amber-200">
                  You&apos;ve reached your project limit. Archive inactive projects to continue creating.
                </p>
                <p className="text-[11px] text-amber-300/80">
                  Archived projects retain full database history and can be restored at any time once a slot opens up.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-xs text-emerald-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  {limit - activeCount} {limit - activeCount === 1 ? 'slot' : 'slots'} remaining
                </span>
              </div>
              <span className="text-[11px] font-mono text-zinc-400">
                Cap: {limit} active
              </span>
            </div>
          )}
        </>
      )}

      {/* Analytical Breakdown Grid */}
      {showBreakdown && (
        <div className="pt-2 border-t border-white/5 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400 font-medium flex items-center gap-1.5">
              <PieChart className="h-3.5 w-3.5 text-zinc-500" />
              Capacity Breakdown
            </span>
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
            >
              {expanded ? 'Show Less' : 'Show Details'}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-3 space-y-1">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Active</span>
              <div className="text-lg font-mono font-bold text-white">{activeCount}</div>
              <p className="text-[10px] text-emerald-400">Consumes quota</p>
            </div>

            <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-3 space-y-1">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Archived</span>
              <div className="text-lg font-mono font-bold text-zinc-300">{archivedCount}</div>
              <p className="text-[10px] text-zinc-400">Zero quota impact</p>
            </div>

            <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-3 space-y-1">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Total</span>
              <div className="text-lg font-mono font-bold text-white">{activeCount + archivedCount}</div>
              <p className="text-[10px] text-zinc-400">Total in SQLite</p>
            </div>

            <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-3 space-y-1">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Capacity</span>
              <div className="text-lg font-mono font-bold text-emerald-400">
                {isUnlimited ? '∞' : `${Math.round(usagePercentage)}%`}
              </div>
              <p className="text-[10px] text-zinc-400">{isUnlimited ? 'No limit' : 'Utilization'}</p>
            </div>
          </div>

          {/* Segmented Capacity Bar */}
          <div className="space-y-1.5 pt-1">
            <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden flex">
              {/* Active portion */}
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{
                  width: isUnlimited
                    ? `${Math.min(100, activeCount * 15)}%`
                    : `${(activeCount / Math.max(limit, activeCount + archivedCount || 1)) * 100}%`,
                }}
                title={`Active: ${activeCount}`}
              />
              {/* Archived portion */}
              <div
                className="h-full bg-purple-500/70 transition-all duration-300"
                style={{
                  width: isUnlimited
                    ? `${Math.min(50, archivedCount * 10)}%`
                    : `${(archivedCount / Math.max(limit, activeCount + archivedCount || 1)) * 100}%`,
                }}
                title={`Archived: ${archivedCount}`}
              />
            </div>
            <div className="flex items-center gap-4 text-[10px] text-zinc-400">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                Active ({activeCount})
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-purple-500 inline-block" />
                Archived ({archivedCount})
              </span>
              {!isUnlimited && slotsRemaining > 0 && (
                <span className="flex items-center gap-1 text-zinc-400">
                  <span className="h-2 w-2 rounded-full bg-zinc-700 inline-block" />
                  Available ({slotsRemaining})
                </span>
              )}
            </div>
          </div>

          {/* Expanded detailed breakdown */}
          {expanded && (
            <div className="pt-2 text-xs text-zinc-400 space-y-2 border-t border-white/5 animate-fadeIn">
              <div className="flex justify-between items-center py-1">
                <span>Database Disk Footprint</span>
                <span className="font-mono text-white">{storageUsedKb === null ? '—' : `${storageUsedKb} KB`}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span>API Usage Tracked</span>
                <span className="font-mono text-white">{apiCallsCount > 0 ? `${apiCallsCount} calls` : 'Standard'}</span>
              </div>
              {subscriptionPlan === 'free' && (
                <div className="mt-3 p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-transparent border border-emerald-500/20 text-xs text-emerald-300 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-white">Need unlimited projects?</p>
                    <p className="text-[11px] text-zinc-400">Upgrade to Pro for $19 one-time payment.</p>
                  </div>
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-400 text-xs">
                    Learn more <ArrowUpRight className="h-3 w-3" />
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
