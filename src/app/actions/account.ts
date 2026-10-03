'use server';

import { redirect } from 'next/navigation';
import { getCurrentUser, destroySession } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { db } from '@/db';
import { users, subscriptions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { formText, UserError } from '@/lib/validate';

export type AccountState = { error?: string };

/**
 * Delete the signed-in account and everything it owns.
 *
 * Three things have to be true before the row goes, in this order, because this
 * is the only action in the app that cannot be undone by re-registering.
 *
 * 1. **The caller knows the password.** The session cookie is the only
 *    authorisation here, and it rides on every request the browser makes for the
 *    next 30 days: a stale tab on a shared machine, a form restored from
 *    bfcache, a support engineer with the path pasted in. `delete-account-form`
 *    asks for a `confirm()` the way the project delete does, but a confirm
 *    dialog is one click — and this is the difference between losing a project
 *    and losing the account. The cost is one scrypt call against a hash the
 *    session already carried.
 *
 * 2. **There is nothing being paid for.** `plan` defaults to `'free'` and
 *    `status` to `'active'` on every signup, so gating on the status alone
 *    would block every free account from ever deleting itself — the one thing a
 *    free user has no reason to hesitate over. The test is a *paid* plan in a
 *    live state: deleting the row then leaves the processor billing for an
 *    account that no longer exists, which arrives as a chargeback rather than as
 *    a support ticket. `past_due` counts as live for the same reason.
 *
 * 3. **The session goes with it.** Not as a separate step — see the cascade
 *    note below — but because clearing the cookie is what stops the browser
 *    carrying a session id for a user who no longer exists.
 *
 * The refusal for (2) is a message rather than a `?billing=` redirect on
 * purpose: there is no upstream account state to fix and no provider this app
 * can cancel through, so the only honest thing is to say what happened and stop.
 */
export async function deleteAccountAction(
  _prev: AccountState | null,
  formData: FormData
): Promise<AccountState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: 'Your session expired. Sign in again to delete your account.' };
  }

  try {
    if (!verifyPassword(formText(formData, 'password'), user.passwordHash)) {
      throw new UserError('That password is not correct.');
    }

    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, user.id),
    });

    const LIVE = ['active', 'trialing', 'past_due'];
    if (sub && sub.plan !== 'free' && LIVE.includes(sub.status)) {
      throw new UserError(
        `Your ${sub.plan} plan is still billing. Cancel it with the provider you paid, wait for the period to end, then delete your account here — otherwise the charge continues for an account that no longer exists.`
      );
    }

    // One statement. `sessions`, `subscriptions` and `projects` all declare
    // `onDelete: 'cascade'` and the connection sets `PRAGMA foreign_keys = ON`
    // on every open (src/db/index.ts:40), so this removes every row the account
    // owns. Deleting them one at a time instead would leave a partial account if
    // the process died between statements, and there is no way back from that.
    //
    // Scoped to `user.id`, and the row to delete comes from the session — this
    // action reads no id from the form at all, so there is no submitted id that
    // could be swapped for someone else's.
    await db.delete(users).where(eq(users.id, user.id));
  } catch (err) {
    return {
      error:
        err instanceof UserError
          ? err.message
          : 'Could not delete your account. Try again.',
    };
  }

  // Outside the try. `redirect()` THROWS a NEXT_REDIRECT error, so inside a
  // catch-all it is swallowed and the user lands on the error banner instead of
  // a signed-out app — while their account is already gone. The same trap
  // billing-redirect.test.ts guards against, on the path where the outcome is
  // worse: the page it would have shown is the dashboard of a deleted account.
  await destroySession();
  redirect('/login?deleted=1');
}