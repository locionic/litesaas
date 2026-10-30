'use client';

import React, { useState, useMemo } from 'react';
import {
  Layers,
  TrendingUp,
  Activity,
  CheckCircle2,
  TriangleAlert,
  Sparkles,
  Zap,
  Database,
  Calendar,
  ArrowUpRight,
  BarChart3,
  PieChart,
  HardDrive,
  Clock,
  ShieldCheck,
  ChevronRight,
  Info,
} from 'lucide-react';
import { projectLimitFor } from '@/lib/stripe';

export type SubscriptionPlan = 'free' | 'pro' | 'enterprise';
export type TimeRange = '7d' | '30d' | '90d';
export type MetricCategory = 'projects' | 'api' | 'storage' | 'latency';

export interface DailyUsageMetric {
  date: string;
  label: string;
  activeProjects: number;
  archivedProjects: number;
  apiRequests: number;
  storageKb: number;
  queryLatencyMs: number;
}

export interface SubscriptionUsageChartsProps {
  activeCount: number;
  archivedCount: number;
  subscriptionPlan: SubscriptionPlan;
  storageUsedKb?: number | null;
  apiCallsCount?: number;
  historicalData?: DailyUsageMetric[];
  className?: string;
  onUpgradeClick?: () => void;
}

/**
 * Calculates current quota utilization percentage.
 */
export function calculateQuotaPercentage(activeCount: number, plan: SubscriptionPlan): number {
  const limit = projectLimitFor(plan);
  if (limit === Infinity || limit <= 0) return 0;
  return Math.min(100, Math.round((activeCount / limit) * 100));
}

/**
 * Metadata and display configurations per plan tier.
 */
export function getSubscriptionPlanDetails(plan: SubscriptionPlan) {
  switch (plan) {
    case 'pro':
      return {
        name: 'Pro Lifetime',
        badge: 'Pro Tier',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-sm shadow-emerald-500/10',
        description: 'Unlimited active projects, priority SQLite WAL query concurrency, zero limits.',
        limitText: 'Unlimited Projects',
        isUnlimited: true,
      };
    case 'enterprise':
      return {
        name: 'Enterprise Custom',
        badge: 'Enterprise',
        badgeClass: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
        description: 'Multi-tenant high availability, custom Litestream S3 replication, dedicated support.',
        limitText: 'Custom Quota',
        isUnlimited: false,
      };
    case 'free':
    default:
      return {
        name: 'Free Indie',
        badge: 'Free Tier',
        badgeClass: 'bg-zinc-800 text-zinc-300 border-white/10',
        description: 'Prototyping tier capped at 3 active projects. Archiving preserves full history.',
        limitText: '3 Active Projects',
        isUnlimited: false,
      };
  }
}

/**
 * Generates deterministic fallback usage trend points if none are passed in.
 */
function generateFallbackHistoricalData(
  activeCount: number,
  archivedCount: number,
  storageKb: number,
  days: number
): DailyUsageMetric[] {
  const results: DailyUsageMetric[] = [];
  const baseStorage = Math.max(12, storageKb || 48);

  for (let i = days - 1; i >= 0; i--) {
    const dayOffset = i;
    // Fractional progress towards current count
    const factor = Math.max(0.2, (days - dayOffset) / days);
    const dayActive = Math.max(1, Math.min(activeCount, Math.round(activeCount * factor)));
    const dayArchived = Math.max(0, Math.min(archivedCount, Math.round(archivedCount * factor * 0.8)));
    const dayApi = Math.round(25 + dayActive * 18 + ((days - i) % 7) * 9);
    const dayStorage = Math.round(baseStorage * (0.6 + 0.4 * factor));
    const dayLatency = +(0.012 + ((days - i) % 5) * 0.002).toFixed(3);

    // Format label simply without Intl.DateTimeFormat
    const dayNum = 30 - (dayOffset % 28);
    const label = `Day ${days - i}`;
    const dateStr = `2026-10-${dayNum < 10 ? '0' + dayNum : dayNum}`;

    results.push({
      date: dateStr,
      label,
      activeProjects: dayActive,
      archivedProjects: dayArchived,
      apiRequests: dayApi,
      storageKb: dayStorage,
      queryLatencyMs: dayLatency,
    });
  }

  // Ensure last entry reflects exact current props
  if (results.length > 0) {
    const last = results[results.length - 1];
    last.activeProjects = activeCount;
    last.archivedProjects = archivedCount;
    if (storageKb) last.storageKb = storageKb;
  }

  return results;
}

export default function SubscriptionUsageCharts({
  activeCount,
  archivedCount,
  subscriptionPlan,
  storageUsedKb = 64,
  apiCallsCount = 142,
  historicalData,
  className = '',
  onUpgradeClick,
}: SubscriptionUsageChartsProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [activeMetric, setActiveMetric] = useState<MetricCategory>('projects');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const planDetails = getSubscriptionPlanDetails(subscriptionPlan);
  const projectLimit = projectLimitFor(subscriptionPlan);
  const isUnlimited = planDetails.isUnlimited;
  const quotaPercentage = calculateQuotaPercentage(activeCount, subscriptionPlan);
  const atLimit = !isUnlimited && activeCount >= projectLimit;
  const slotsRemaining = isUnlimited ? Infinity : Math.max(0, projectLimit - activeCount);
  const isNearLimit = !isUnlimited && slotsRemaining === 1;

  const daysCount = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;

  const dataset = useMemo(() => {
    if (historicalData && historicalData.length >= daysCount) {
      return historicalData.slice(-daysCount);
    }
    return generateFallbackHistoricalData(
      activeCount,
      archivedCount,
      storageUsedKb ?? 64,
      daysCount
    );
  }, [historicalData, daysCount, activeCount, archivedCount, storageUsedKb]);

  // Derive metric values for chart rendering
  const chartPoints = useMemo(() => {
    switch (activeMetric) {
      case 'api':
        return dataset.map((d) => ({
          xLabel: d.label,
          val: d.apiRequests,
          secondaryVal: 0,
          date: d.date,
          unit: 'reqs',
        }));
      case 'storage':
        return dataset.map((d) => ({
          xLabel: d.label,
          val: d.storageKb,
          secondaryVal: 0,
          date: d.date,
          unit: 'KB',
        }));
      case 'latency':
        return dataset.map((d) => ({
          xLabel: d.label,
          val: d.queryLatencyMs,
          secondaryVal: 0,
          date: d.date,
          unit: 'ms',
        }));
      case 'projects':
      default:
        return dataset.map((d) => ({
          xLabel: d.label,
          val: d.activeProjects,
          secondaryVal: d.archivedProjects,
          date: d.date,
          unit: 'projects',
        }));
    }
  }, [dataset, activeMetric]);

  // Scaled coordinates for SVG Chart
  const svgWidth = 600;
  const svgHeight = 200;
  const paddingX = 40;
  const paddingY = 28;

  const maxVal = useMemo(() => {
    const rawMax = Math.max(...chartPoints.map((p) => p.val + (p.secondaryVal || 0)), 1);
    if (activeMetric === 'projects' && !isUnlimited) {
      return Math.max(rawMax, projectLimit);
    }
    return rawMax * 1.15;
  }, [chartPoints, activeMetric, isUnlimited, projectLimit]);

  const minVal = useMemo(() => {
    if (activeMetric === 'latency') return 0;
    return 0;
  }, [activeMetric]);

  const coordinates = useMemo(() => {
    const stepX = (svgWidth - paddingX * 2) / Math.max(chartPoints.length - 1, 1);
    return chartPoints.map((point, index) => {
      const x = paddingX + index * stepX;
      const normalizedY = (point.val - minVal) / (maxVal - minVal || 1);
      const y = svgHeight - paddingY - normalizedY * (svgHeight - paddingY * 2);
      return { x, y, point, index };
    });
  }, [chartPoints, maxVal, minVal, svgWidth, svgHeight, paddingX, paddingY]);

  // Line path and area path
  const linePath = useMemo(() => {
    if (coordinates.length === 0) return '';
    return coordinates.reduce(
      (path, pt, i) => (i === 0 ? `M ${pt.x} ${pt.y}` : `${path} L ${pt.x} ${pt.y}`),
      ''
    );
  }, [coordinates]);

  const areaPath = useMemo(() => {
    if (coordinates.length === 0) return '';
    const firstX = coordinates[0].x;
    const lastX = coordinates[coordinates.length - 1].x;
    const bottomY = svgHeight - paddingY;
    return `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  }, [coordinates, linePath, svgHeight, paddingY]);

  // Limit line Y position
  const limitLineY = useMemo(() => {
    if (activeMetric !== 'projects' || isUnlimited) return null;
    const normalizedLimit = (projectLimit - minVal) / (maxVal - minVal || 1);
    return svgHeight - paddingY - normalizedLimit * (svgHeight - paddingY * 2);
  }, [activeMetric, isUnlimited, projectLimit, minVal, maxVal, svgHeight, paddingY]);

  const hoveredPoint = hoveredIndex !== null && coordinates[hoveredIndex] ? coordinates[hoveredIndex] : null;

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-6 shadow-xl shadow-black/20 ${className}`}
      data-testid="subscription-usage-charts"
    >
      {/* Header with Subscription Status and Plan Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">Subscription Usage &amp; Analytics</h2>
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border ${planDetails.badgeClass}`}>
                {planDetails.badge}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">{planDetails.description}</p>
          </div>
        </div>

        {/* Action Button: Upgrade or Status Indicator */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {subscriptionPlan === 'free' ? (
            <button
              type="button"
              onClick={onUpgradeClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black text-xs font-semibold shadow-md shadow-emerald-500/20 transition-all focus:outline-none focus:outline-2 focus:outline-emerald-500"
              aria-label="Upgrade to Pro Subscription"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Upgrade to Pro ($19)</span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Verified Pro License</span>
            </div>
          )}
        </div>
      </div>

      {/* Primary Quota Progress Bar (Capped Tiers) */}
      {!isUnlimited ? (
        <div className="space-y-2 bg-zinc-900/40 rounded-xl p-4 border border-white/5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-emerald-400" />
              Active Project Quota
            </span>
            <span className={`font-mono ${atLimit ? 'text-amber-400 font-semibold' : 'text-zinc-300'}`}>
              {activeCount} of {projectLimit} active
              {atLimit ? ' — limit reached' : ` (${slotsRemaining} ${slotsRemaining === 1 ? 'slot' : 'slots'} available)`}
            </span>
          </div>

          <div
            className="h-2 rounded-full bg-white/5 overflow-hidden p-0.5 border border-white/5"
            role="progressbar"
            aria-valuenow={activeCount}
            aria-valuemin={0}
            aria-valuemax={projectLimit}
            aria-label="Active projects used against plan limit"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                atLimit
                  ? 'bg-gradient-to-r from-amber-500 to-amber-400 shadow-sm shadow-amber-500/30'
                  : isNearLimit
                    ? 'bg-gradient-to-r from-yellow-500 to-amber-400'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-sm shadow-emerald-500/30'
              }`}
              style={{ width: `${quotaPercentage}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1">
            <span>{quotaPercentage}% utilized</span>
            {atLimit ? (
              <span className="text-amber-300 flex items-center gap-1">
                <TriangleAlert className="h-3 w-3" />
                Archive projects to free up capacity
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Capacity healthy
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-4 py-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-emerald-300">
            <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>Unlimited active projects &amp; SQLite records enabled on Pro tier.</span>
          </div>
          <span className="font-mono text-emerald-400 font-semibold text-xs">{activeCount} active projects</span>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Active</span>
            <Layers className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-mono font-bold text-white">{activeCount}</div>
          <p className="text-[10px] text-zinc-400">{isUnlimited ? 'Unlimited' : `Cap: ${projectLimit}`}</p>
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Archived</span>
            <Clock className="h-3.5 w-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-mono font-bold text-zinc-300">{archivedCount}</div>
          <p className="text-[10px] text-zinc-400">Zero quota impact</p>
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Database</span>
            <HardDrive className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <div className="text-xl font-mono font-bold text-white">
            {storageUsedKb === null ? '—' : `${storageUsedKb} KB`}
          </div>
          <p className="text-[10px] text-zinc-400">SQLite single file</p>
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">API Activity</span>
            <Activity className="h-3.5 w-3.5 text-teal-400" />
          </div>
          <div className="text-xl font-mono font-bold text-white">{apiCallsCount}</div>
          <p className="text-[10px] text-zinc-400">Requests handled</p>
        </div>
      </div>

      {/* Chart Section Header with Filter Controls */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Metric Selector Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 bg-zinc-900/80 p-1 rounded-xl border border-white/5">
            <button
              type="button"
              onClick={() => setActiveMetric('projects')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 ${
                activeMetric === 'projects'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Projects Trend
            </button>
            <button
              type="button"
              onClick={() => setActiveMetric('api')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 ${
                activeMetric === 'api'
                  ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              API Calls
            </button>
            <button
              type="button"
              onClick={() => setActiveMetric('storage')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 ${
                activeMetric === 'storage'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Storage (KB)
            </button>
            <button
              type="button"
              onClick={() => setActiveMetric('latency')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 ${
                activeMetric === 'latency'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Engine Latency
            </button>
          </div>

          {/* Time Range Toggle */}
          <div className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-white/5 self-start sm:self-auto">
            {(['7d', '30d', '90d'] as TimeRange[]).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setTimeRange(range)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 ${
                  timeRange === range
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
                aria-label={`Show ${range} timeframe`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive SVG Area/Line Chart */}
        <div className="relative rounded-xl border border-white/5 bg-zinc-950/40 p-4">
          {/* Hover Tooltip Overlay */}
          {hoveredPoint && (
            <div
              className="absolute pointer-events-none z-10 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-white/10 shadow-lg text-xs space-y-0.5"
              style={{
                left: `${Math.min(svgWidth - 120, Math.max(20, (hoveredPoint.x / svgWidth) * 100))}%`,
                top: '12px',
              }}
            >
              <div className="text-[10px] text-zinc-400">{hoveredPoint.point.date}</div>
              <div className="font-mono font-semibold text-white">
                {hoveredPoint.point.val} {hoveredPoint.point.unit}
              </div>
              {activeMetric === 'projects' && hoveredPoint.point.secondaryVal > 0 && (
                <div className="text-[10px] text-purple-400 font-mono">
                  +{hoveredPoint.point.secondaryVal} archived
                </div>
              )}
            </div>
          )}

          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-48 overflow-visible"
            role="img"
            aria-label={`Interactive ${activeMetric} analytics chart over ${timeRange}`}
          >
            <defs>
              <linearGradient id="usageGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="blueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid Guidelines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = svgHeight - paddingY - ratio * (svgHeight - paddingY * 2);
              const labelVal = (minVal + ratio * (maxVal - minVal)).toFixed(
                activeMetric === 'latency' ? 2 : 0
              );
              return (
                <g key={ratio}>
                  <line
                    x1={paddingX}
                    y1={y}
                    x2={svgWidth - paddingX}
                    y2={y}
                    stroke="rgba(255, 255, 255, 0.05)"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={paddingX - 8}
                    y={y + 3}
                    textAnchor="end"
                    fill="#71717a"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {labelVal}
                  </text>
                </g>
              );
            })}

            {/* Plan Limit Baseline (Projects Metric on Capped Plan) */}
            {limitLineY !== null && (
              <g>
                <line
                  x1={paddingX}
                  y1={limitLineY}
                  x2={svgWidth - paddingX}
                  y2={limitLineY}
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
                <text
                  x={svgWidth - paddingX - 4}
                  y={limitLineY - 6}
                  textAnchor="end"
                  fill="#f59e0b"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  Plan Cap ({projectLimit})
                </text>
              </g>
            )}

            {/* Area Fill */}
            <path
              d={areaPath}
              fill={activeMetric === 'storage' ? 'url(#blueGradient)' : 'url(#usageGradient)'}
            />

            {/* Main Trend Line */}
            <path
              d={linePath}
              fill="none"
              stroke={activeMetric === 'storage' ? '#3b82f6' : activeMetric === 'latency' ? '#a855f7' : '#10b981'}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Interactive Data Markers */}
            {coordinates.map(({ x, y, point, index }) => (
              <g key={index}>
                <circle
                  cx={x}
                  cy={y}
                  r={hoveredIndex === index ? 5 : 2.5}
                  fill={hoveredIndex === index ? '#ffffff' : '#10b981'}
                  stroke="#121217"
                  strokeWidth="2"
                  className="transition-all duration-150 cursor-pointer"
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              </g>
            ))}

            {/* Date labels at bottom */}
            {coordinates.map(({ x, point, index }) => {
              // Only render label for periodic intervals to avoid crowding
              const interval = Math.max(1, Math.floor(coordinates.length / 5));
              if (index % interval !== 0 && index !== coordinates.length - 1) return null;
              return (
                <text
                  key={index}
                  x={x}
                  y={svgHeight - 8}
                  textAnchor="middle"
                  fill="#71717a"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {point.xLabel}
                </text>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Segmented Resource Allocation Bar */}
      <div className="pt-2 border-t border-white/5 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <PieChart className="h-3.5 w-3.5 text-zinc-400" />
            Resource Allocation &amp; Capacity Distribution
          </span>
          <span className="text-[11px] font-mono text-zinc-400">
            Total Projects in SQLite: {activeCount + archivedCount}
          </span>
        </div>

        <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden flex p-0.5 border border-white/5">
          {/* Active Projects Segment */}
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-300"
            style={{
              width: isUnlimited
                ? `${Math.min(100, (activeCount / Math.max(activeCount + archivedCount, 1)) * 100)}%`
                : `${(activeCount / Math.max(projectLimit, activeCount + archivedCount || 1)) * 100}%`,
            }}
            title={`Active: ${activeCount}`}
          />
          {/* Archived Projects Segment */}
          <div
            className="h-full bg-purple-500/70 rounded-full transition-all duration-300"
            style={{
              width: isUnlimited
                ? `${Math.min(50, (archivedCount / Math.max(activeCount + archivedCount, 1)) * 100)}%`
                : `${(archivedCount / Math.max(projectLimit, activeCount + archivedCount || 1)) * 100}%`,
            }}
            title={`Archived: ${archivedCount}`}
          />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-400 pt-1">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span>Active Projects ({activeCount})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-purple-500/70" />
            <span>Archived Projects ({archivedCount})</span>
          </div>
          {!isUnlimited && slotsRemaining > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span>Available Quota ({slotsRemaining})</span>
            </div>
          )}
          {isUnlimited && (
            <div className="flex items-center gap-1.5 text-emerald-400">
              <Sparkles className="h-3 w-3" />
              <span>Unlimited Headroom</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Aliases for developer convenience
export {
  SubscriptionUsageCharts,
  SubscriptionUsageCharts as SubscriptionUsageAnalytics,
  SubscriptionUsageCharts as UsageAnalyticsCharts,
};
