'use client';

import { useActionState } from 'react';
import { Pencil, AlertCircle } from 'lucide-react';
import { updateProjectAction, type ProjectState } from '@/app/actions/projects';
// Same reasoning as project-form.tsx: validate.ts is pure, so the caps are safe
// to read on the client and the browser's limits cannot drift from the ones
// updateProjectAction enforces server-side.
import { MAX_NAME, MAX_DESCRIPTION } from '@/lib/validate';

/**
 * The edit form inside a project row.
 *
 * A client component for the one reason project-form.tsx is: `useActionState`
 * needs a client boundary, and the row that hosts this is a server component
 * that already read the row it is rendering.
 *
 * `defaultValue` seeds both inputs, which is what makes this an edit rather than
 * an empty create form. A server action posts to the current URL, so the seeded
 * values survive the revalidate — and the row that re-renders underneath is the
 * row whose values were just saved.
 */
export default function EditProjectForm({
  projectId,
  name,
  description,
}: {
  projectId: string;
  name: string;
  description: string | null;
}) {
  const [state, formAction, isPending] = useActionState<ProjectState | null, FormData>(
    updateProjectAction.bind(null, projectId),
    null
  );

  return (
    <form action={formAction} className="space-y-3 pt-3" aria-label={`Edit ${name}`}>
      {state?.error && (
        <div
          role="alert"
          className="p-3 rounded-xl border border-red-500/20 bg-red-950/20 text-red-400 text-xs flex items-start gap-2"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <label
          htmlFor={`name-${projectId}`}
          className="text-xs font-semibold uppercase tracking-wider text-zinc-400"
        >
          Name
        </label>
        <input
          id={`name-${projectId}`}
          name="name"
          defaultValue={name}
          autoComplete="off"
          required
          maxLength={MAX_NAME}
          className="w-full px-3.5 py-2 rounded-xl border border-white/10 bg-zinc-900 text-sm text-white focus:outline-none focus:border-emerald-500 focus:outline-2 focus:outline-offset-2 focus:outline-emerald-500 transition-colors"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={`description-${projectId}`}
          className="text-xs font-semibold uppercase tracking-wider text-zinc-400"
        >
          Description (Optional)
        </label>
        <textarea
          id={`description-${projectId}`}
          name="description"
          defaultValue={description ?? ''}
          autoComplete="off"
          rows={2}
          maxLength={MAX_DESCRIPTION}
          className="w-full px-3.5 py-2 rounded-xl border border-white/10 bg-zinc-900 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 focus:outline-2 focus:outline-offset-2 focus:outline-emerald-500 transition-colors"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-1.5 py-2 px-4 rounded-xl bg-emerald-500 text-zinc-950 font-bold text-xs hover:bg-emerald-400 disabled:opacity-50 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
          {isPending ? 'Saving...' : 'Save changes'}
        </button>
        {/* Stated, not implied: this saves the two fields above and nothing
            else. A row's archive state and its owner are decided elsewhere, and
            saying so is what keeps the disclosure from reading as a form that
            has forgotten the rest of the row. */}
        <span className="text-[11px] text-zinc-600">
          Name and description only — archive from the row itself.
        </span>
      </div>
    </form>
  );
}