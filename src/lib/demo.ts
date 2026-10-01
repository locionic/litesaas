/**
 * Whether the demo account exists in this deployment.
 *
 * One predicate, two callers that must agree: `seedDemoUserIfNeeded` (which
 * creates the account) and the login page (which advertises it). When they were
 * decided separately, a deployment could show "Pre-seeded demo account
 * available" with an auto-fill button for an account that had never been
 * created — the UI kept advertising a backdoor the server had correctly
 * refused to plant.
 *
 * The account has a published password and a Pro plan, so it is opt-in in
 * production. A local clone needs nothing: development always seeds it.
 */
export function isDemoEnabled(env: {
  NODE_ENV?: string;
  SEED_DEMO_USER?: string;
}): boolean {
  return env.NODE_ENV !== 'production' || env.SEED_DEMO_USER === 'true';
}
