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
 *
 * `=== 'development'`, deliberately, not `!== 'production'`. This is the only
 * check in the app that decides whether a *known* password is live, so "yes"
 * has to be positively established. Blocklisting production makes every other
 * value — `staging`, `test`, `''`, unset, a typo, a deploy that never set the
 * variable — read as a developer machine and plant the account, in exactly the
 * environments nobody was thinking about when they ran the deploy. That is also
 * why the login banner is not enough on its own: it would advertise the
 * credentials beside the form. SEED_DEMO_USER is the one way to opt in.
 */
export function isDemoEnabled(env: {
  NODE_ENV?: string;
  SEED_DEMO_USER?: string;
}): boolean {
  return env.NODE_ENV === 'development' || env.SEED_DEMO_USER === 'true';
}
