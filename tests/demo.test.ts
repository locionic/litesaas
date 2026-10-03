import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDemoEnabled } from '../src/lib/demo.ts';

// Run: npm test
//
// The demo account has a published password and a Pro plan. In production it is
// opt-in, so `seedDemoUserIfNeeded` refuses to create it.
//
// That guard and the login page's "Pre-seeded demo account available" banner
// were separate decisions. Gating the seed while leaving the banner
// unconditional left production advertising — with a working auto-fill button —
// an account that did not exist, for credentials anyone reading the README
// could try. These tests pin the single predicate both now share.

test('development always seeds the demo account', () => {
  // A local clone must work with zero configuration; that is the whole point.
  // One exact value, because that is what `next dev` sets.
  assert.equal(isDemoEnabled({ NODE_ENV: 'development' }), true);
});

test('an unrecognised NODE_ENV is not a developer machine', () => {
  // This is the predicate's whole job. `!== 'production'` answered yes to every
  // one of these — they are all "not production" — and so planted an account
  // with a published password and a Pro plan on a host nobody was testing. Each
  // value is a real way a deploy arrives with the variable set to something
  // other than what its author expected.
  for (const NODE_ENV of ['staging', 'test', '', 'Production', 'prod', 'production ']) {
    assert.equal(
      isDemoEnabled({ NODE_ENV }),
      false,
      `NODE_ENV=${JSON.stringify(NODE_ENV)} must not seed the demo account`
    );
  }
  // Never set at all. The empty env is the common case, not a corner one.
  assert.equal(isDemoEnabled({}), false);
  assert.equal(isDemoEnabled({ SEED_DEMO_USER: 'false' }), false);
});

test('production does not seed the demo account by default', () => {
  assert.equal(isDemoEnabled({ NODE_ENV: 'production' }), false);
  assert.equal(isDemoEnabled({ NODE_ENV: 'production', SEED_DEMO_USER: '' }), false);
  assert.equal(isDemoEnabled({ NODE_ENV: 'production', SEED_DEMO_USER: 'false' }), false);
  assert.equal(isDemoEnabled({ NODE_ENV: 'production', SEED_DEMO_USER: '1' }), false);
  assert.equal(isDemoEnabled({ NODE_ENV: 'production', SEED_DEMO_USER: 'TRUE' }), false);
});

test('a hosted demo opts in explicitly', () => {
  assert.equal(isDemoEnabled({ NODE_ENV: 'production', SEED_DEMO_USER: 'true' }), true);
});

const code = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the seed gate and the login banner both use the one predicate', () => {
  // If either inlines its own NODE_ENV check they can drift again, and the
  // failure mode is a false claim on the login page.
  assert.match(code('../src/lib/auth.ts'), /if \(!isDemoEnabled\(process\.env\)\) return;/);
  assert.match(code('../src/app/(auth)/login/page.tsx'), /isDemoEnabled\(process\.env\)/);

  // The banner must be conditional markup, not an unconditional block.
  assert.match(code('../src/app/(auth)/login/login-form.tsx'), /\{demoEnabled &&/);
});

test('the demo env var is read in exactly one module', () => {
  // Scoped to SEED_DEMO_USER, not to NODE_ENV: auth.ts legitimately compares
  // NODE_ENV against 'production' for the session cookie's `secure` flag, and
  // that is not demo policy. The variable that *is* the policy must not be read
  // anywhere else — a second reader is how the gate and the banner drift again.
  const readers = [
    '../src/lib/auth.ts',
    '../src/app/(auth)/login/page.tsx',
    '../src/app/(auth)/login/login-form.tsx',
  ].filter((f) => /SEED_DEMO_USER/.test(code(f)));
  assert.deepEqual(readers, [], `decide the demo policy in src/lib/demo.ts only: ${readers.join(', ')}`);
});

test('the demo account is seeded atomically', () => {
  // Source-asserted, like every test in this file: the seed lives in a module
  // that imports next/headers and the db, and neither loads under `node --test`.
  const auth = code('../src/lib/auth.ts');
  const at = auth.indexOf('export async function seedDemoUserIfNeeded');
  assert.notEqual(at, -1, 'seedDemoUserIfNeeded was renamed or removed; this test needs revisiting');
  const seed = auth.slice(at);

  // The two inserts are separate statements and subscriptions.user_id is a FK to
  // users.id, so a fault between them left a user row with no subscription — and
  // the `if (!existing)` gate made it permanent. Every later visit found the
  // user, skipped the block, and the demo account sat on the schema's default
  // 'free' plan for good — capping every visitor at three projects in the one
  // account they use to judge the paid tier. No error anywhere.
  assert.match(
    seed,
    /await db\.transaction\(async \(tx\) =>/,
    'the two demo rows must commit together or not at all'
  );

  // The sharp half. `tx` is the transaction handle; `db` is the pool. Writing
  // the second insert as `db.insert(...)` inside the callback looks identical
  // and is not — it issues on a different connection, outside the transaction,
  // so the rollback covers one insert and not the other. That is precisely the
  // regression the transaction exists to prevent, and it sails past a test that
  // only checks for db.transaction.
  assert.doesNotMatch(
    seed,
    /\bdb\.insert\(/,
    'an insert issued on db bypasses the transaction handle and is not covered by the rollback'
  );
  assert.match(seed, /tx\.insert\(users\)/, 'the user row must go through the transaction');
  assert.match(seed, /tx\.insert\(subscriptions\)/, 'so must the subscription row');
});

test('a seed that fails is invisible to nobody', () => {
  // The catch around the seed is deliberate — it must not 500 the marketing page,
  // and the demo account really is an affordance. But it was a bare `catch {}`,
  // and that made the failure invisible from both ends: the page renders fine,
  // and isDemoEnabled goes on advertising "Pre-seeded demo account available"
  // with an auto-fill button for an account that was never created.
  //
  // Which is the drift the predicate exists to prevent. src/lib/demo.ts spells
  // it out: the banner and the seed "must agree", and when they were decided
  // separately a deployment showed an auto-fill button for an account the
  // server had correctly refused to plant. The gate agreeing is only half the
  // invariant — if the seed fails, they disagree anyway, and now the only
  // symptom is a visitor typing published credentials that do not work.
  //
  // Swallowing is about the response. The log is about the evidence, and the
  // stated reason for swallowing does not argue against it — console.error
  // still does not throw.
  const seed = code('../src/lib/auth.ts');
  const from = seed.indexOf('export async function seedDemoUserIfNeeded');
  assert.notEqual(from, -1, 'the seed was renamed or removed; this test needs revisiting');

const caught = seed.indexOf('catch', from);
  assert.notEqual(caught, -1, 'the seed is no longer guarded; revisit this test');
  assert.match(
    seed.slice(caught),
    /console\.error\(/,
    'a failed seed must leave a trace, or the banner keeps advertising an account that does not exist'
  );
});
test('the credentials the banner offers are the ones the seed planted', () => {
  // Two independent literals for one credential: `hashPassword('password123')`
  // goes into the row, `setPassword('password123')` goes into the form. Nothing
  // spans them — the seed is behind `'use server'` and `next/headers`, the form
  // is a client component, and the banner's claim is a boolean that says nothing
  // about what it is offering.
  //
  // So the one thing a visitor does with the demo account is unverified: the
  // page says "Pre-seeded demo account available", the button fills both fields,
  // they press Sign In, and they get "Invalid email or password". Every other
  // test in this file asks whether the account *exists* — the gate, the
  // idempotence, the transaction, the re-seed after a failure. None of them asks
  // whether the advertised way in actually works.
  //
  // Lifted, not restated: a copy of the string here would keep passing after
  // either side changed, which is the whole failure being guarded against.
  const auth = code('../src/lib/auth.ts');
  const form = code('../src/app/(auth)/login/login-form.tsx');

  const seeded = auth.match(/passwordHash: hashPassword\('([^']*)'\)/);
  assert.ok(seeded, 'the demo row no longer hashes a literal password; revisit this test');
  const filled = form.match(/setPassword\('([^']*)'\)/);
  assert.ok(filled, 'the auto-fill button no longer fills a literal password; revisit this test');

  // And it has to be a password at all: an empty string passes an equality check
  // between two empties, and `required` on the input is client-side only.
  assert.ok(seeded[1].length >= 8, `the seeded demo password is ${seeded[1].length} chars; MIN_PASSWORD is 8`);
  assert.equal(filled[1], seeded[1], 'the auto-filled password must be the one the seed hashed');

  // The email has the same shape — exported as DEMO_EMAIL on one side, typed as
  // a literal on the other — and the same failure: the form fills an address no
  // such account has.
  const demoEmail = auth.match(/export const DEMO_EMAIL = '([^']*)'/);
  assert.ok(demoEmail, 'DEMO_EMAIL is gone; this test needs revisiting');
  const filledEmail = form.match(/setEmail\('([^']*)'\)/);
  assert.ok(filledEmail, 'the auto-fill button no longer fills a literal email');
  assert.equal(filledEmail[1], demoEmail[1], 'the auto-filled email must be the one the seed inserted');
});

test('the demo account is seeded on the plan the demo exists to show', () => {
  // The seed's other two literals are pinned — the test above checks the password
  // and the email against what the login banner offers — but the plan was checked
  // against nothing, because the README does not claim a plan for the demo account
  // and neither does the banner.
  //
  // It still has to be pro, and not because of a documented promise. This is the
  // account a visitor signs into to judge the kit, and the thing being judged is
  // the paid tier: projectLimitFor('pro') is Infinity and projectLimitFor('free')
  // is 3, so a downgrade quietly turns the showcase into the free plan it exists
  // to be contrasted against, and a visitor who never sees the headline feature
  // has learned nothing about whether they want it.
  //
  // And it would not be a transient mistake. The seed only runs when the user row
  // is absent, so a deployment whose demo row landed on the schema's default
  // never repairs it — not on the next deploy, not ever. `if (!existing)` is the
  // only path back and it is closed. Which is the same permanence as the half
  // written above, reached by a different road.
  const auth = code('../src/lib/auth.ts');
  const from = auth.indexOf('export async function seedDemoUserIfNeeded');
  assert.notEqual(from, -1, 'the seed was renamed or removed; this test needs revisiting');

  assert.match(
    auth.slice(from),
    /tx\.insert\(subscriptions\)\.values\(\{[\s\S]*?plan: 'pro'/,
    'the demo account is the showcase for the paid tier; seeded free, every visitor is capped at three projects'
  );
});

test('the seed is idempotent, not attempted on every visit', () => {
  // The `if (!existing)` guard is what makes a second landing-page visit a no-op.
  // Remove it and every visit after the first reaches the INSERT, gets
  // SQLITE_CONSTRAINT_UNIQUE back, and lands in the catch below — which logs
  // "demo seed failed; the login banner will keep advertising it" on every single
  // page view of a perfectly healthy deployment. Noisy in a way that actively
  // misdirects: the message tells the operator to go look at the banner.
  const auth = code('../src/lib/auth.ts');
  const at = auth.indexOf('export async function seedDemoUserIfNeeded');
  assert.notEqual(at, -1, 'seedDemoUserIfNeeded was renamed or removed; this test needs revisiting');
  const seed = auth.slice(at);

  assert.match(
    seed,
    /const existing = await db\.query\.users\.findFirst/,
    'the seed no longer looks before it writes; re-inserting on every visit is back'
  );
  assert.match(seed, /if \(!existing\) \{/, 'the seed must skip an account that is already there');
});
