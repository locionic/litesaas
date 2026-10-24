'use client';

import React, { useState } from 'react';
import { Download, FileCode, FileSpreadsheet, Check, Sparkles } from 'lucide-react';
import {
  createProjectBackup,
  packageActiveProjects,
  serializeBackupJson,
  serializeBackupCsv,
  type ExportRow,
  type ExportAccount,
  type StructuredProjectBackup,
} from '@/lib/export';

export interface DashboardExportProps {
  /** Optional projects array to package and export directly */
  projects?: ExportRow[];
  /** Optional account metadata to include in JSON backup */
  account?: ExportAccount;
  /** Active projects count (for display/labeling) */
  activeCount?: number;
  /** Server export API endpoint (defaults to '/api/projects/export') */
  exportEndpoint?: string;
  /** Optional custom download handler or export callback */
  onExport?: (format: 'json' | 'csv', content?: string) => void;
  /** Optional container class name */
  className?: string;
  /** Visual display variant */
  variant?: 'buttons' | 'card' | 'compact';
}

/**
 * Client-side file trigger helper. Packages text data into an active file download.
 */
function triggerFileDownload(content: string, filename: string, mimeType: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function DashboardExport({
  projects,
  account,
  activeCount,
  exportEndpoint = '/api/projects/export',
  onExport,
  className = '',
  variant = 'buttons',
}: DashboardExportProps) {
  const [downloadingFormat, setDownloadingFormat] = useState<'json' | 'csv' | null>(null);

  // Derive active projects count from explicit prop or project records
  const computedActiveCount =
    activeCount !== undefined
      ? activeCount
      : projects
      ? projects.filter((p) => p.status === 'active').length
      : undefined;

  /**
   * Packages current active project metadata, timestamps, and status into structured exports.
   */
  const handleExport = (format: 'json' | 'csv') => {
    setDownloadingFormat(format);
    setTimeout(() => setDownloadingFormat(null), 1500);

    if (projects) {
      // Package active project metadata, timestamps, and status into structured backup
      const backup = createProjectBackup(projects, account, { activeOnly: true });
      const content = format === 'json' ? backup.json : backup.csv;
      const mime = format === 'json' ? 'application/json' : 'text/csv';
      const fname = backup.filename(format);

      if (onExport) {
        onExport(format, content);
      }

      triggerFileDownload(content, fname, mime);
      return;
    }

    if (onExport) {
      onExport(format);
    }
  };

  const jsonHref = `${exportEndpoint}?format=json`;
  const csvHref = `${exportEndpoint}?format=csv`;

  if (variant === 'card') {
    return (
      <div
        className={`rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-4 ${className}`}
        data-testid="dashboard-export-card"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Download className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Project Backup &amp; Export</h3>
              <p className="text-xs text-zinc-400">
                Package active project metadata, timestamps, and status into structured exports
              </p>
            </div>
          </div>
          {computedActiveCount !== undefined && (
            <span className="text-[11px] font-mono text-zinc-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
              {computedActiveCount} active
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {projects ? (
            <>
              <button
                type="button"
                onClick={() => handleExport('json')}
                aria-label="Export active projects as JSON backup"
                className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 transition-colors border border-white/10"
              >
                {downloadingFormat === 'json' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <FileCode className="h-3.5 w-3.5 text-emerald-400" />
                )}
                Export JSON Backup
              </button>
              <button
                type="button"
                onClick={() => handleExport('csv')}
                aria-label="Export active projects as CSV spreadsheet"
                className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 transition-colors border border-white/10"
              >
                {downloadingFormat === 'csv' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                )}
                Export CSV Spreadsheet
              </button>
            </>
          ) : (
            <>
              <a
                href={jsonHref}
                aria-label="Export active projects as JSON backup"
                className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 transition-colors border border-white/10"
              >
                <FileCode className="h-3.5 w-3.5 text-emerald-400" />
                Export JSON Backup
              </a>
              <a
                href={csvHref}
                aria-label="Export active projects as CSV spreadsheet"
                className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 transition-colors border border-white/10"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                Export CSV Spreadsheet
              </a>
            </>
          )}
        </div>
      </div>
    );
  }

  // Default 'buttons' variant matching dashboard export affordances
  return (
    <div
      className={`inline-flex items-center gap-2 ${className}`}
      data-testid="dashboard-export-actions"
      role="group"
      aria-label="Project export actions"
    >
      {projects ? (
        <>
          <button
            type="button"
            onClick={() => handleExport('json')}
            aria-label="Export projects as JSON"
            title="Export active projects structured JSON"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white px-3 py-2 rounded-xl hover:bg-white/5 transition-colors border border-white/5"
          >
            {downloadingFormat === 'json' ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            JSON
          </button>
          <button
            type="button"
            onClick={() => handleExport('csv')}
            aria-label="Export projects as CSV"
            title="Export active projects CSV spreadsheet"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white px-3 py-2 rounded-xl hover:bg-white/5 transition-colors border border-white/5"
          >
            {downloadingFormat === 'csv' ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            CSV
          </button>
        </>
      ) : (
        <>
          <a
            href={jsonHref}
            aria-label="Export projects as JSON"
            title="Export active projects structured JSON"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white px-3 py-2 rounded-xl hover:bg-white/5 transition-colors border border-white/5"
          >
            <Download className="h-3.5 w-3.5" />
            JSON
          </a>
          <a
            href={csvHref}
            aria-label="Export projects as CSV"
            title="Export active projects CSV spreadsheet"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white px-3 py-2 rounded-xl hover:bg-white/5 transition-colors border border-white/5"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </a>
        </>
      )}
    </div>
  );
}

export { DashboardExport };
