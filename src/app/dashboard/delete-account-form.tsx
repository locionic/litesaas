'use client';

import { useActionState } from 'react';
import { Trash2, AlertCircle } from 'lucide-react';
import { deleteAccountAction, type AccountState } from '@/app/actions/account';

/**
 * Delete the account. Irreversible, and larger than the project delete beside it.
 *
 * A client component for the reason project-form.tsx is: `useActionState` needs
 * a client boundary, and the dashboard that hosts this is a server component
 * that already read the row.
 *
 * `autoComplete="current-password"` rather than `"new-password"`: this field
 * exists to re-prove the password the account was made with, and that is
 * exactly the hint browsers offer the saved one for. It is not a password
 * manager handing a credential to the action — the action compares it against
 * the stored hash and refuses when it does not match.
 */
export default function DeleteAccountForm({ email }: { email: string }) {
  const [state, formAction, isPending] = useActionState<AccountState | null, FormData>(
    deleteAccountAction,
    null
  );

  return (
    <form
      action={formAction}
      className="space-y-4"
      onSubmit={(e) => {
        // Same shape as delete-project-button.tsx: this button has no handler of
        // its own, only a veto, and the form is what performs the delete. The
        // confirm names the account, because "OK" to a dialog that does not say
        // what it is closing is a reflex rather than a decision.
        if (
          !window.confirm(
            `Delete ${email}?\n\nThis removes your account, your projects and your sessions. It cannot be undone.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
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
          htmlFor="delete-account-password"
          className="text-xs font-semibold uppercase tracking-wider text-zinc-400"
        >
          Confirm your password
        </label>
        <input
          id="delete-account-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Your account password"
          className="w-full px-3.5 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-500 focus:outline-2 focus:outline-offset-2 focus:outline-red-500 transition-colors"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-1.5 py-2.5 px-4 rounded-xl bg-red-500/90 hover:bg-red-500 text-white font-bold text-xs disabled:opacity-50 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {isPending ? 'Deleting...' : 'Delete account permanently'}
      </button>
    </form>
  );
}