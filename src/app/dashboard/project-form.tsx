'use client';

import { useActionState } from 'react';
import { Plus, Lock, AlertCircle } from 'lucide-react';
import { createProjectAction } from '@/app/actions/projects';
// validate.ts is pure (no Next imports), so these caps are safe to read on the
// client. Importing the real constants keeps the browser's limits and
// createProjectAction's server-side limits from drifting apart.
import { MAX_NAME, MAX_DESCRIPTION } from '@/lib/validate';

/**
 * Split out of page.tsx so useActionState has a client boundary. The parent is
 * a server component that reads the database and cannot hold that state.
 *
 * The cap is passed in rather than re-derived: it is a property of the rendered
 * page, and a client-side recount would go stale the moment another tab creates
 * a project — the server check is what actually enforces the limit.
 */
export default function ProjectForm({
  atProjectLimit,
  projectLimit,
}: {
  atProjectLimit: boolean;
  projectLimit: number;
}) {
  const [state, formAction, isPending] = useActionState(createProjectAction, null);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#121217] p-6 space-y-5 h-fit">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
          <Plus className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-base font-bold text-white">Create New Project</h2>
          <p className="text-xs text-zinc-400">Inserts immediately into local SQLite</p>
        </div>
      </div>

      {/* Without this the action's `{ error }` had nowhere to render, and a
          rejected submit — an over-long name, or the plan cap — looked exactly
          like a button that did nothing. */}
      {state?.error && (
        <div
          role="alert"
          className="p-3 rounded-xl border border-red-500/20 bg-red-950/20 text-red-400 text-xs flex items-start gap-2"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
          <span>{state.error}</span>
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="project-name" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Project Name</label>
          <input
            id="project-name"
            name="name"
            autoComplete="off"
            required
            maxLength={MAX_NAME}
            placeholder="e.g. AI Video Repurposer"
            className="w-full px-3.5 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 focus:outline-2 focus:outline-offset-2 focus:outline-emerald-500 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="project-description" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Description (Optional)</label>
          <textarea
            id="project-description"
            name="description"
            autoComplete="off"
            rows={3}
            maxLength={MAX_DESCRIPTION}
            placeholder="A brief overview of what this project does..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 focus:outline-2 focus:outline-offset-2 focus:outline-emerald-500 transition-colors"
          />
        </div>

        <button
          type="submit"
          disabled={atProjectLimit || isPending}
          title={atProjectLimit ? 'Archive a project to free a slot, or upgrade to Pro' : undefined}
          className={`w-full py-2.5 px-4 rounded-xl bg-emerald-500 text-zinc-950 font-bold text-xs hover:bg-emerald-400 transition-colors flex items-center justify-center gap-1.5 shadow-sm shadow-emerald-500/20 ${
            atProjectLimit ? 'opacity-40 cursor-not-allowed hover:bg-emerald-500' : ''
          }`}
        >
          {atProjectLimit ? <Lock className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {atProjectLimit ? `Limit reached (${projectLimit} active)` : isPending ? 'Saving...' : 'Save Project'}
        </button>
      </form>
    </div>
  );
}