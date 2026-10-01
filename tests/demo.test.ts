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
  assert.equal(isDemoEnabled({ NODE_ENV: 'development' }), true);
  assert.equal(isDemoEnabled({ NODE_ENV: 'test' }), true);
  assert.equal(isDemoEnabled({}), true);
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