import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// Two things the kit shipped without, both of which only show up in a browser:
// every page rendered the landing page's SEO title, and the favicon in public/
// was never linked — Next only auto-detects app/icon.*, so the browser fell
// back to /favicon.ico and 404'd on every single page load.
//
// The titles are checked as source rather than over HTTP because `npm test`
// runs no server. What is asserted is what the server would render: a template
// in the root layout, a title per route, and the landing page deliberately left
// without one so it keeps the full marketing string.

const root = fileURLToPath(new URL('..', import.meta.url));
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

const rootLayout = src('src/app/layout.tsx');
const authLayout = src('src/app/(auth)/layout.tsx');
const loginPage = src('src/app/(auth)/login/page.tsx');
const dashboardPage = src('src/app/dashboard/page.tsx');
const landingPage = src('src/app/page.tsx');

/** The title string a route ends up rendering. */
const titleOf = (source: string): string | null =>
  source.match(/title:\s*\{[^}]*default:\s*'([^']+)'/)?.[1] ??
  source.match(/export const metadata: Metadata = \{ title: '([^']+)' \}/)?.[1] ??
  null;

test('the favicon the layout names is a file that exists', () => {
  // Next emits whatever path is named here verbatim, so a renamed or moved
  // public/ file turns straight back into the 404 this replaces.
  const icon = rootLayout.match(/icons:\s*\{\s*icon:\s*'([^']+)'/)?.[1];
  assert.ok(icon, 'the root layout must declare an icon');
  assert.ok(existsSync(join(root, 'public', icon)), `public${icon} is referenced but missing`);
});

test('every route has its own title', () => {
  const titles = [
    ['dashboard', titleOf(dashboardPage)],
    ['login', titleOf(loginPage)],
    ['register', titleOf(authLayout)],
  ] as const;

  for (const [route, title] of titles) {
    assert.ok(title, `${route} has no title`);
  }
  // The bug: one shared string, so four tabs, four bookmarks and four search
  // results all read as the landing page.
  assert.equal(new Set(titles.map(([, t]) => t)).size, titles.length, 'two routes share a title');
});

test('the landing page keeps the full marketing title', () => {
  // `template` does not apply to the segment that defines it, so the landing
  // page — which sits beside the root layout, not under it — takes `default`.
  // Give it its own export and it becomes "Some Title · LiteSaaS" instead.
  assert.doesNotMatch(landingPage, /export const metadata/);
  assert.match(rootLayout, /default:\s*'LiteSaaS - Zero-Cost/);
});

test('both layouts use the same title template', () => {
  // A layout that sets `title` as a plain string takes over from its parent's
  // template and its children lose it too — which is how /login rendered as a
  // bare "Sign in" while /register still got " · LiteSaaS". The template has to
  // be repeated in every layout, so it has to be repeated correctly.
  const rootTemplate = rootLayout.match(/template:\s*'([^']+)'/)?.[1];
  const authTemplate = authLayout.match(/template:\s*'([^']+)'/)?.[1];
  assert.ok(rootTemplate, 'the root layout needs a template for sub-pages to compose');
  assert.equal(authTemplate, rootTemplate, 'the two templates have drifted');
});