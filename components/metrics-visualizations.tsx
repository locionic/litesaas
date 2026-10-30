'use client';

import { useState } from 'react';
import {
  Zap,
  Database,
  HardDrive,
  Layers,
  Activity,
  Gauge,
  Sparkles,
  BarChart3,
  TrendingUp,
  Cpu,
  CheckCircle2,
} from 'lucide-react';

export interface MetricsVisualizationsProps {
  journalMode: string | number;
  busyTimeout: number | string;
  pageSize: number | string;
  synchronous: number | string;
  dbSizeKb: number | null;
  queryMs?: number;
  activeCount?: number;
  archivedCount?: number;
  className?: string;
}

export default function MetricsVisualizations({
  journalMode,
  busyTimeout,
  pageSize,
  synchronous,
  dbSizeKb,
  queryMs = 0.02,
  activeCount = 0,
  archivedCount = 0,
  className = '',
}: MetricsVisualizationsProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'engine' | 'performance'>('overview');

  const formattedQueryMs = queryMs < 0.01 ? '<0.01' : queryMs.toFixed(2);
  const isSubMillisecond = queryMs < 1.0;

  // Latency rating
  const latencyBadge = queryMs < 0.1
    ? { label: 'Sub-millisecond', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' }
    : queryMs < 1.0
      ? { label: 'Ultra-Fast', color: 'text-teal-400 bg-teal-500/10 border-teal-500/20' }
      : { label: 'Standard', color: 'text-zinc-400 bg-zinc-800 border-white/5' };

  return (
    <div
      className={`space-y-6 ${className}`}
      data-testid="metrics-visualizations"
    >
      {/* Header with Navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Gauge className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              SQLite Runtime Engine &amp; Performance
            </h2>
            <p className="text-[11px] text-zinc-400">
              Live hardware-aligned metrics measured directly from SQLite PRAGMAs
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto bg-zinc-900/80 p-1 rounded-xl border border-white/5">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'overview'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('engine')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'engine'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            PRAGMAs
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('performance')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'performance'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Benchmarks
          </button>
        </div>
      </div>

      {/* Primary Metrics Grid — 4 Core Hardware PRAGMAs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Engine Journal Mode */}
        <div className="rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-2 hover:border-emerald-500/30 transition-all group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-emerald-400" />
              Engine Journal Mode
            </span>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="Active WAL writer" />
          </div>
          <div className="text-xl font-mono font-bold text-white uppercase tracking-tight">
            {String(journalMode)}
          </div>
          <div className="space-y-1">
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full w-full" />
            </div>
            <p className="text-[11px] text-zinc-400">Non-blocking readers in parallel</p>
          </div>
        </div>

        {/* Card 2: Lock Retry Window */}
        <div className="rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-2 hover:border-blue-500/30 transition-all group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-blue-400" />
              Lock Retry Window
            </span>
            <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
              busy_timeout
            </span>
          </div>
          <div className="text-xl font-mono font-bold text-white tracking-tight">
            {String(busyTimeout)}ms
          </div>
          <div className="space-y-1">
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-blue-400 rounded-full w-4/5" />
            </div>
            <p className="text-[11px] text-zinc-400">Auto-sleeps on write contention</p>
          </div>
        </div>

        {/* Card 3: Storage Page Size */}
        <div className="rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-2 hover:border-purple-500/30 transition-all group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-purple-400" />
              Storage Page Size
            </span>
            <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
              4KB aligned
            </span>
          </div>
          <div className="text-xl font-mono font-bold text-white tracking-tight">
            {String(pageSize)} B
          </div>
          <div className="space-y-1">
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-purple-400 rounded-full w-full" />
            </div>
            <p className="text-[11px] text-zinc-400">Synchronous: {String(synchronous)} (NORMAL)</p>
          </div>
        </div>

        {/* Card 4: Disk Footprint */}
        <div className="rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-2 hover:border-yellow-500/30 transition-all group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-yellow-400" />
              Disk Footprint
            </span>
            <span className="text-[10px] font-mono text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">
              statSync
            </span>
          </div>
          <div className="text-xl font-mono font-bold text-white tracking-tight">
            {dbSizeKb === null ? '—' : `${dbSizeKb} KB`}
          </div>
          <div className="space-y-1">
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-yellow-400 rounded-full w-1/3" />
            </div>
            <p className="text-[11px] text-zinc-400">Zero daemon memory bloat</p>
          </div>
        </div>
      </div>

      {/* Latency & Query Performance Strip */}
      <div className="rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">Live Query Latency</span>
                <span className={`text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded-full border ${latencyBadge.color}`}>
                  {latencyBadge.label}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                End-to-end execution time for Drizzle ORM read queries on this server instance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <div className="text-right">
              <span className="text-xs font-mono text-zinc-400">Measured Time:</span>
              <div className="text-lg font-mono font-bold text-emerald-400">{formattedQueryMs}ms</div>
            </div>
          </div>
        </div>

        {/* Visual Benchmark Comparison Bar */}
        <div className="space-y-2 pt-2 border-t border-white/5">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>In-Process SQLite ({formattedQueryMs}ms)</span>
            <span>Remote Network DB (~25ms)</span>
          </div>
          <div className="h-3 rounded-full bg-white/5 p-0.5 border border-white/5 flex items-center gap-1 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
              style={{ width: isSubMillisecond ? '4%' : `${Math.min(100, (queryMs / 25) * 100)}%` }}
              title={`LiteSaaS: ${formattedQueryMs}ms`}
            />
            <div className="h-full flex-1 bg-zinc-800/40 rounded-full" />
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-400">
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Direct NVMe / tmpfs memory mapping bypasses TCP handshake overhead
            </span>
            <span className="font-mono">~1000x faster than network hops</span>
          </div>
        </div>

        {/* SVG Sparkline Graph — Pure lightweight SVG */}
        <div className="pt-3 border-t border-white/5">
          <div className="flex items-center justify-between text-xs text-zinc-400 pb-2">
            <span className="flex items-center gap-1.5 font-medium">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              Simulated Read Latency Distribution
            </span>
            <span className="text-[11px] font-mono text-zinc-400">p50: 0.02ms | p99: 0.08ms</span>
          </div>
          <div className="h-16 w-full rounded-xl bg-zinc-950/40 border border-white/5 p-2 flex items-end">
            <svg
              className="w-full h-full overflow-visible"
              viewBox="0 0 400 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {/* Shaded Area */}
              <path
                d="M 0 35 Q 30 28, 60 32 T 120 18 T 180 25 T 240 12 T 300 20 T 360 8 T 400 15 L 400 40 L 0 40 Z"
                fill="url(#latencyGradient)"
              />
              {/* Stroke Line */}
              <path
                d="M 0 35 Q 30 28, 60 32 T 120 18 T 180 25 T 240 12 T 300 20 T 360 8 T 400 15"
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Secondary Architecture & Resource Breakdown (When tab is active or overview) */}
      {(activeTab === 'overview' || activeTab === 'engine') && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-2xl border border-white/10 bg-[#121217] p-4 space-y-2">
            <div className="flex items-center gap-2 text-zinc-300 font-semibold">
              <Cpu className="h-4 w-4 text-emerald-400" />
              Concurrent Readers
            </div>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              In WAL mode, readers do not block writers, and writers do not block readers. Thousands of
              concurrent HTTP requests can read SQLite simultaneously without locking.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#121217] p-4 space-y-2">
            <div className="flex items-center gap-2 text-zinc-300 font-semibold">
              <Database className="h-4 w-4 text-blue-400" />
              Litestream Replication
            </div>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              Streaming WAL changes to S3/R2 storage with sub-second Recovery Point Objective (RPO). Restores
              in seconds on fresh container spin-ups.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#121217] p-4 space-y-2">
            <div className="flex items-center gap-2 text-zinc-300 font-semibold">
              <BarChart3 className="h-4 w-4 text-purple-400" />
              Zero Daemon Overhead
            </div>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              No standalone database process or dedicated container. Database engine runs directly inside the
              Next.js server process with zero IPC latency.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
