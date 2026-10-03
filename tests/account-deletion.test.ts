import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyPassword, hashPassword } from '../src/lib/password.ts';

// Run: npm test
//
// Account deletion — the only action in this app that cannot be undone by
// re-registering. Everything here is source-asserted because
// src/app/actions/account.ts is a 'use server' module: it pulls next/navigation,
// the db and next/headers, so `node --test` cannot import it. The same reason
// every other action test in this repo reads text.
//
// Two things here are NOT source assertions, and they are the two that matter:
//
//   - The plan/status gate, lifted with `new Function` and run. The claim is
//     about which combinations of plan and status delete and which refuse, and
//     no regex can answer that — a condition reading `plan !== 'free' &&
//     status !== 'canceled'` looks like the shipped one and blocks every free
//     account on earth.
//   - The password check, called for real. `verifyPassword` is pure and
//     importable, so the refusal is measured rather than read.

const code = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const account = code('../src/app/actions/account.ts');
const form = code('../src/app/dashboard/delete-account-form.tsx');
const dashboard = code('../src/app/dashboard/page.tsx');

/**
 * The billing gate, lifted and run.
 *
 * `sub` is faked, so this exercises the decision without a database: the
 * condition is `sub && plan !== 'free' && LIVE.includes(status)`, and every
 * operand is pure. A signup writes `plan: 'free'` and `status: 'active'` by
 * default, so the pair that matters most is the free one — if the gate tested
 * `status` alone, every free account would be permanently unable to delete
 * itself, and the one thing a free user has no reason to hesitate over would be
 * the one thing they could not do.
 */
const refuses = (sub: { plan: string; status: string } | null): boolean => {
  const at = account.indexOf('const LIVE =');
  assert.notEqual(at, -1, 'the billing gate is gone; this test needs revisiting');
  const expr = account
    .slice(at)
    .match(/const LIVE\s*=\s*(\[[^\]]*\]);[\s\S]*?if \(([\s\S]*?)\) \{/);
  assert.ok(expr, 'the billing gate no longer has the shape this lifts');

  return new Function(
    'sub',
    `const LIVE =${expr[1]}; return (${expr[2]});`
  )(sub) as boolean;
};

test('a free account can delete itself; a paid, live one cannot', () => {
  // Every row a signup or a webhook can actually produce. `free`/`active` is
  // the signup default and is first for that reason.
  const ALLOWS_DELETE = [
    { plan: 'free', status: 'active' },
    { plan: 'free', status: 'trialing' },
    { plan: 'free', status: 'past_due' },
    { plan: 'free', status: 'canceled' },
  ];
  const REFUSES_DELETE = [
    { plan: 'pro', status: 'active' },
    { plan: 'pro', status: 'trialing' },
    { plan: 'pro', status: 'past_due' },
    { plan: 'enterprise', status: 'active' },
    { plan: 'enterprise', status: 'past_due' },
  ];

  for (const sub of ALLOWS_DELETE) {
    assert.equal(refuses(sub), false, `a free account (${sub.status}) must be able to delete itself`);
  }
  for (const sub of REFUSES_DELETE) {
    assert.equal(
      refuses(sub),
      true,
      `a ${sub.plan}/${sub.status} account is still being billed and must not delete`
    );
  }

  // A missing row — an account created before signup wrote one — is not a paid
  // entitlement. `getCurrentUser` reads the same row the same way and treats
  // its absence as 'free'.
  //
  // Falsiness rather than `=== false`: `sub && …` short-circuits to `sub`, so a
  // null subscription returns `null`. The gate is only ever consumed by `if`,
  // where that is indistinguishable from `false` — asserting `false` here would
  // pin the operand order rather than the decision.
  assert.ok(!refuses(null), 'a missing subscription row blocks deletion');
});

test('`pro` + `canceled` cannot happen, and that is why a cancelled account can delete', () => {
  // The gate reads `plan !== 'free' && LIVE.includes(status)`. On its own that
  // refuses a cancelled Pro account forever, because `canceled` is deliberately
  // absent from LIVE — and the intended reading is "the billing has stopped".
  //
  // What makes that safe is an invariant in the other direction, held by both
  // webhooks: a cancellation downgrades the plan in the same UPDATE that sets
  // the status. So every `canceled` row is also `plan: 'free'`, and the plan
  // clause is what lets it through.
  //
  // Asserted here because the day somebody changes a webhook to keep the plan
  // on cancellation, nothing about this app visibly breaks — a cancelled
  // customer simply becomes unable to delete their account, with a message
  // telling them to cancel a subscription they already cancelled.
  for (const rel of [
    '../src/app/api/webhooks/stripe/route.ts',
    '../src/app/api/webhooks/lemonsqueezy/route.ts',
  ]) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    assert.match(
      src,
      /\.set\(\{\s*plan: 'free',\s*status: 'canceled'/,
      `${rel} no longer downgrades the plan when cancelling, so a cancelled account can never delete itself`
    );
  }
});

test('the gate reads the subscription, it does not infer the plan', () => {
  // `user.subscriptionPlan` is the *plan* only. Reading status from anywhere
  // else means a cancelled-but-not-expired Pro account can delete itself while
  // the processor still bills it, which is the chargeback the gate exists to
  // prevent.
  assert.match(
    account,
    /db\.query\.subscriptions\.findFirst\(\{\s*where: eq\(subscriptions\.userId, user\.id\)/,
    'the gate does not read the subscription row'
  );

  // And it must be read before the delete. Reading it after the row is gone is
  // a check that always passes.
  assert.ok(
    account.indexOf('subscriptions.findFirst') < account.indexOf('db.delete(users)'),
    'the billing state is checked after the account is deleted'
  );
});

test('deleting requires the account password, and it is compared for real', () => {
  // The session cookie is the only authorisation here, and it rides on every
  // request the browser makes for 30 days. `verifyPassword` is pure and
  // importable, so the refusal is measured rather than asserted about.
  const stored = hashPassword('correct horse battery staple');

  assert.equal(verifyPassword('correct horse battery staple', stored), true);
  assert.equal(verifyPassword('Correct horse battery staple', stored), false, 'the compare is case-sensitive');
  assert.equal(verifyPassword('', stored), false);

  // …and the action reads it the way it reads every other field. A
  // `formData.get('password') as string` is the bug `formText` was written to
  // stop, and a POST can send the field as a File part.
  assert.match(
    account,
    /verifyPassword\(formText\(formData, 'password'\), user\.passwordHash\)/,
    'the password is not read through formText, or is compared against the wrong column'
  );

  // No fallback path. An `if (!user || verifyPassword(...))` short-circuits, so
  // the null branch answers in microseconds while a wrong password costs a
  // scrypt — the same oracle `DUMMY_HASH` exists to close at login.
  assert.doesNotMatch(
    account,
    /if \(!user \|\|/,
    'the password check short-circuits on the session and times the difference'
  );

  // It refuses rather than redirects: a wrong password is a form error the user
  // has to see and correct, not a page change.
  assert.match(
    account,
    /throw new UserError\('That password is not correct\.'\)/,
    'a wrong password does not produce a user-facing refusal'
  );
});

test('the account is deleted in one statement, scoped to the session', () => {
  // The cascade is declared on all three child tables and the connection sets
  // `PRAGMA foreign_keys = ON` on every open, so this one DELETE removes every
  // row the account owns. Deleting them one at a time leaves a half-deleted
  // account if the process dies between statements — with no way back.
  const deletes = account.match(/db\.delete\(/g) ?? [];
  assert.equal(deletes.length, 1, 'the account is not removed in a single statement');
  assert.match(
    account,
    /db\.delete\(users\)\.where\(eq\(users\.id, user\.id\)\)/,
    'the delete is not scoped to the signed-in user'
  );

  // No id arrives from the form. This action takes a password and nothing else,
  // so there is no submitted value that could be swapped for another account's.
  const read = [...account.matchAll(/formText\(formData, '([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(read, ['password'], 'the action reads form fields other than the password');

  // …and the prune is conditional on the pragma, which is conditional on
  // nothing. A cascade that silently does not fire leaves orphan session rows
  // that still authenticate.
  const db = readFileSync(fileURLToPath(new URL('../src/db/index.ts', import.meta.url)), 'utf8');
  assert.match(db, /pragma\('foreign_keys = ON'\)/, 'foreign_keys is off; every cascade in this app is a no-op');
});

test('the success redirect is outside the catch, and the session goes with the row', () => {
  // `redirect()` THROWS. Inside a catch-all it is swallowed, so the user reads
  // "Could not delete your account" *after* their account is gone — and the page
  // it would have shown is the dashboard of a user that no longer exists. This
  // is the trap billing-redirect.test.ts guards against, on the path where
  // getting it wrong is the worst version of it.
  const at = account.indexOf('redirect(');
  assert.notEqual(at, -1, 'the action does not redirect after deleting');
  assert.ok(
    at > account.indexOf('catch (err)'),
    'the redirect is inside the catch-all, so the catch swallows it and reports a failure for a delete that worked'
  );
  assert.match(account, /redirect\('\/login\?deleted=1'\)/);

  // The cookie has to be cleared. The cascade already removed the session row,
  // so `getCurrentUser` returns null on the next request — but the browser is
  // still carrying a cookie for an account that does not exist, and every
  // request with it takes the "no session" path until something clears it.
  assert.match(account, /await destroySession\(\)/);
  assert.ok(
    account.indexOf('destroySession()') < at,
    'the cookie is cleared after the redirect, which never runs'
  );

  // …and the page has to render the confirmation it points at, or the user
  // lands on a login form with no idea what happened.
  assert.match(dashboard, /params\.deleted === 'true'/);
});

test('the form submits through the state wrapper, and announces errors', () => {
  // Same three contract as every other form in the app, asserted the same three
  // ways, because wiring it to the raw action instead keeps every line of this
  // passing while the error goes nowhere.
  const destructure = form.match(/const\s*\[\s*state\s*,\s*(\w+)[^]*?\]/);
  assert.ok(destructure, 'the form does not destructure useActionState');
  const submit = destructure[1] ?? 'formAction';
  assert.match(form, new RegExp(`action=\\{${submit}\\}`), 'the form does not post to the wrapper');
  assert.doesNotMatch(form, /action=\{deleteAccountAction\}/);

  assert.match(form, /\{state\?\.error &&/);
  assert.match(form.slice(form.indexOf('{state?.error &&')).slice(0, 400), /role="alert"/);
  assert.match(form, /useActionState(?:<[^>]*>)?\(\s*deleteAccountAction\s*,\s*null\s*\)/);

  // Irreversible, so it confirms and names the account — and the button is the
  // one that submits. `type="button"` here is a no-op that looks correct.
  assert.match(form, /window\.confirm\(/);
  assert.match(form, /\$\{email\}/);
  assert.match(form, /type="submit"/);
  assert.doesNotMatch(form, /type="button"/);
  assert.match(form, /autoComplete="current-password"/);
});

test('the danger zone is not offered on the shared demo account', () => {
  // The demo password is printed in the README, so anyone reading the repo has
  // it. A deleted demo account is a broken live demo link, not a security win,
  // and it cannot be recovered without the operator.
  assert.match(dashboard, /const isDemo = user\.email === DEMO_EMAIL;/);
  assert.match(dashboard, /import \{ getCurrentUser, DEMO_EMAIL \} from '@\/lib\/auth';/);
  assert.match(dashboard, /\{!isDemo && \([\s\S]*?<DeleteAccountForm email=\{user\.email\} \/>/);

  // Native disclosure, for the same reason the edit form is: the dashboard is a
  // server component and the affordance only has to open.
  assert.match(dashboard, /<details className="group\/danger">[\s\S]*?<summary/);
});