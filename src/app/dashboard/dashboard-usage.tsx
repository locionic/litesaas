'use client';

import { useState, useEffect } from 'react';
import { Layers, CheckCircle2, TriangleAlert } from 'lucide-react';
import { projectLimitFor } from '@/lib/stripe';

export type SubscriptionPlan = 'free' | 'pro' | 'enterprise';

export interface DashboardUsageProps {
  activeCount: number;
  archivedCount: number;
  subscriptionPlan: SubscriptionPlan;
}

export default function DashboardUsage({ activeCount, archivedCount, subscriptionPlan }: DashboardUsageProps) {
  const [usagePercentage, setUsagePercentage] = useState(0);

  useEffect(() => {
    const limit = projectLimitFor(subscriptionPlan);
    if (limit === Infinity || limit === 0) {
      setUsagePercentage(0);
    } else {
      setUsagePercentage(Math.min(100, (activeCount / limit) * 100));
    }
  }, [activeCount, subscriptionPlan]);

  const limit = projectLimitFor(subscriptionPlan);
  const atLimit = limit !== Infinity && activeCount >= limit;
  const usageText = limit === Infinity
    ? `${activeCount} active${archivedCount > 0 ? `, ${archivedCount} archived` : ''}`
    : `${activeCount} of ${limit} active${archivedCount > 0 ? `, ${archivedCount} archived` : ''}`;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#121217] px-5 py-4 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-zinc-400 flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-emerald-400" />
          Project Usage
        </span>
        <span
          className={`font-mono ${atLimit ? 'text-amber-400' : 'text-zinc-400'}`}
        >
          {usageText}
          {atLimit && ' — archive one to make room'}
        </span>
      </div>

      {subscriptionPlan !== 'pro' && (
        <>
          <div
            className="h-1.5 rounded-full bg-white/5 overflow-hidden"
            role="progressbar"
            aria-valuenow={activeCount}
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-label="Active projects used"
          >
            <div
              className={`h-full rounded-full transition-all duration-200 ${atLimit ? 'bg-amber-400' : 'bg-emerald-500'}`}
              style={{ width: `${usagePercentage}%` }}
            />
          </div>

          {atLimit ? (
            <div className="flex items-start gap-2 pt-2 text-xs text-amber-300">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>You've reached your project limit. Archive inactive projects to continue creating.</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 pt-2 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {limit - activeCount} {limit - activeCount === 1 ? 'slot' : 'slots'} remaining
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}