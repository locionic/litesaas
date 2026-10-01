'use client';

import { Trash2 } from 'lucide-react';

/**
 * The only destructive control in the app, and it sits one gap away from an
 * Archive button that is otherwise identical — same icon size, same grey, the
 * difference is the glyph and a hover colour. Deleting is not reversible and
 * nothing restores the row, so a stray click is a silent, permanent loss.
 *
 * The form and its action stay server-rendered; only the button is a client
 * component, because `confirm` and `onClick` need a client boundary.
 *
 * ponytail: native `confirm()`. A bespoke modal dialog would be nicer and would
 * also be a component, a focus trap, and a test surface for a destructive path
 * that fires at most a handful of times a day.
 */
export default function DeleteProjectButton({ name }: { name: string }) {
  return (
    <button
      type="submit"
      className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
      title="Delete project"
      aria-label="Delete project"
      onClick={(e) => {
        if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
