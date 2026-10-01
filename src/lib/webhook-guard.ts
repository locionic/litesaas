/**
 * Ordering guard for billing webhooks.
 *
 * Both Stripe and LemonSqueezy retry for days and explicitly do NOT guarantee
 * ordering. Every handler here is an unconditional `set()`, so a delayed
 * `subscription_created` retry landing after a `subscription_cancelled`
 * resurrects a canceled subscription to Pro — and because the subscription is
 * already over, no further event will ever arrive to correct it. The state is
 * then permanently wrong with no way to fix it except a manual database edit.
 *
 * A `processed_events` table would also suppress replays, but every mutation
 * here writes the same values for the same input, so a duplicate delivery is
 * already a no-op. The thing that is NOT a no-op is a stale one, and
 * `subscriptions.updatedAt` — already written by every handler, already on the
 * row — is the watermark that detects it. No new table, no migration.
 */

import { lte, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * Slack for clock skew between the provider's clock and ours.
 *
 * A user can sign up and complete checkout inside the same second, making a
 * legitimate `checkout.session.completed` a fraction of a second older than the
 * row it applies to. Without grace that grant is silently dropped. Genuinely
 * stale events are seconds-to-days old — far outside any plausible skew — so a
 * minute of tolerance loses nothing.
 */
export const CLOCK_SKEW_GRACE_SECONDS = 60;

/**
 * True when this event is older than the last change already applied to the
 * row, i.e. applying it would move the subscription backwards in time.
 *
 * `rowUpdatedAt` is null/undefined when nothing has been recorded yet, which
 * is always "apply".
 */
export function isStaleEvent(
  eventCreatedUnixSeconds: number,
  rowUpdatedAt: Date | number | null | undefined,
  graceSeconds: number = CLOCK_SKEW_GRACE_SECONDS
): boolean {
  if (rowUpdatedAt == null) return false;
  if (!Number.isFinite(eventCreatedUnixSeconds)) return false;

  const rowUpdatedMs = rowUpdatedAt instanceof Date ? rowUpdatedAt.getTime() : rowUpdatedAt;
  if (!Number.isFinite(rowUpdatedMs)) return false;

  return eventCreatedUnixSeconds * 1000 < rowUpdatedMs - graceSeconds * 1000;
}

/**
 * The same rule as `isStaleEvent`, expressed as a WHERE clause.
 *
 * `isStaleEvent` decides by reading the row and the handler then writes. Between
 * those two awaits another delivery for the same customer can land — both
 * requests read the same pre-update `updatedAt`, both judge "not stale", and
 * whichever writes last wins. If the older one is last, the subscription it
 * resurrected is exactly the permanent corruption this file exists to prevent.
 * Putting the watermark in the WHERE hands the decision to SQLite, which
 * evaluates it and the write as one statement, so a lost race updates nothing.
 *
 * Returns undefined for a non-finite event time, which `and()` drops — the same
 * "fail open on nonsense" the boolean form keeps, so a missing timestamp still
 * applies rather than silently discarding a billing event.
 */
export function notStaleSql(
  updatedAtColumn: AnySQLiteColumn,
  eventCreatedUnixSeconds: number,
  graceSeconds: number = CLOCK_SKEW_GRACE_SECONDS
): SQL | undefined {
  if (!Number.isFinite(eventCreatedUnixSeconds)) return undefined;
  return lte(updatedAtColumn, new Date((eventCreatedUnixSeconds + graceSeconds) * 1000));
}
