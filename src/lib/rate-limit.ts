/**
 * Fixed-window rate limiting backed by process memory.
 *
 * ponytail: in-process Map. This is the right ceiling for the single-VPS
 * deployment this kit targets (one Node process, no cache to pay for). If you
 * scale to multiple instances or serverless, limits reset per instance — swap
 * the Map for a shared store (Redis/Upstash) behind the same two functions.
 */

type Bucket = { count: number; resetAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitBuckets: Map<string, Bucket> | undefined;
}

// Reuse the global-singleton pattern from src/db/index.ts so dev hot-reload
// doesn't hand every visitor a fresh set of empty buckets.
const buckets = global.__rateLimitBuckets ?? new Map<string, Bucket>();
if (process.env.NODE_ENV !== 'production') {
  global.__rateLimitBuckets = buckets;
}

const WINDOW_MS = 15 * 60 * 1000;

/** How often to reclaim expired buckets. Memory hygiene only — see checkRateLimit. */
const SWEEP_INTERVAL_MS = 1000;
let lastSweep = 0;

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number };

/**
 * Drop expired buckets so a sustained attack can't grow the Map unbounded.
 *
 * Throttled, because this walked every live key on every single call: with a
 * key flood (each request using a fresh ip/email key) that is n buckets scanned
 * per request, i.e. quadratic work driven by unauthenticated input. Once a
 * second is orders of magnitude more often than reaping needs, and the common
 * path becomes O(1).
 *
 * This is reclamation only. Whether a bucket has expired is decided inline in
 * checkRateLimit, so throttling the sweep can never extend a lockout.
 */
function sweepIfDue(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Record an attempt against `key` and report whether it is allowed.
 *
 * Counts on every call, so callers must call `resetRateLimit` after a success —
 * otherwise a legitimate user who mistypes a few times stays throttled.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number = WINDOW_MS
): RateLimitResult {
  const now = Date.now();
  sweepIfDue(now);

  // An expired bucket is treated as absent regardless of whether the sweep has
  // reached it yet — correctness here must not depend on sweep timing.
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/** Clear an account's counter after a successful auth. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test seam: clear all buckets between cases, and allow an immediate sweep. */
export function clearRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}