import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// Two fixes that only an end-to-end harness can observe, pinned here so a
// regression fails `npm test` rather than waiting for someone to click through
// a browser. Both live in `'use server'` modules, which pull in next/headers and
// the database and so cannot be imported under `node --test` — the same reason
// tests/plans.test.ts and tests/demo.test.ts read source instead of calling in.
//
// 1. BILLING_PROVIDER=lemonsqueezy fell through to Stripe whenever the
//    LemonSqueezy half of the config was incomplete, charging customers through
//    a processor the operator had explicitly excluded. The template ships both
//    sets of variables, so both are usually present in .env.
// 2. createProjectAction threw on validation and on the plan cap while bound
//    straight to <form action={...}>. No boundary caught it, the page
//    re-rendered unchanged, and the user saw a button that did nothing.

const code = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const billing = code('../src/app/actions/billing.ts');
const projects = code('../src/app/actions/projects.ts');
const dashboard = code('../src/app/dashboard/page.tsx');
const projectForm = code('../src/app/dashboard/project-form.tsx');
const deleteButton = code('../src/app/dashboard/delete-project-button.tsx');
const loginForm = code('../src/app/(auth)/login/login-form.tsx');
const registerPage = code('../src/app/(auth)/register/page.tsx');
const localDate = code('../src/app/dashboard/local-date.tsx');

test('the selected billing provider is final — no fallthrough to the other', () => {
  // The Stripe branch must be gated on the provider, not merely on there being
  // no checkout URL yet. That is the whole bug.
  assert.match(
    billing,
    /if \(BILLING_PROVIDER === 'stripe' && stripe && process\.env\.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID\)/
  );

  // An incomplete LemonSqueezy config reports itself instead of letting the
  // request continue to a provider the operator excluded.
  assert.match(
    billing,
    /BILLING_PROVIDER === 'lemonsqueezy'\) \{\s*if \(!isLemonSqueezyConfigured\(\)\) \{\s*redirect\('\/dashboard\?billing=unconfigured'\);/
  );
});

test('an unusable checkout is never treated as a successful one', () => {
  // LemonSqueezy answers 200 with no URL for an archived variant or an
  // inactive store. A null there used to mean "carry on" — into Stripe.
  assert.match(billing, /if \(!checkoutUrl\) \{\s*redirect\('\/dashboard\?billing=error'\);/);
});

test('the checkout decision is a single provider variable, read once', () => {
  // Two independent reads of process.env.BILLING_PROVIDER could disagree if one
  // were written with a different fallback.
  const reads = billing.match(/process\.env\.BILLING_PROVIDER/g) ?? [];
  assert.equal(reads.length, 1, 'BILLING_PROVIDER must be decided in exactly one place');
});

test('checkout is refused rather than redirecting a paying customer to localhost', () => {
  // The origin comes from NEXT_PUBLIC_APP_URL, which .env.example and
  // docker-compose.yml both ship as localhost and which the README's deploy
  // section never tells the operator to change. Stripe redirects to success_url
  // *after* the charge clears, so the default means money taken and the
  // customer dropped on their own machine.
  const guard = billing.search(
    /NODE_ENV === 'production'[\s\S]{0,150}?localhost[\s\S]{0,150}?redirect\('\/dashboard\?billing=appurl'\)/
  );
  assert.notEqual(guard, -1, 'a production checkout must refuse a localhost success_url');

  // Before the session is created, not after — by then the customer is already
  // being handed a checkout page carrying a localhost return address.
  assert.ok(guard < billing.indexOf('checkout.sessions.create'));

  // Refusing is only useful if the operator can see why. Without a banner the
  // upgrade button simply stops working.
  assert.match(dashboard, /params\.billing === 'appurl'/);
  assert.match(dashboard, /NEXT_PUBLIC_APP_URL/);
});

test('createProjectAction returns state instead of throwing', () => {
  // useActionState needs (prevState, formData) -> state. A single-argument
  // action cannot be wired to it at all, so this is a real signature check and
  // not just a formatting assertion.
  assert.match(
    projects,
    /export async function createProjectAction\(\s*_prev: ProjectState \| null,\s*formData: FormData\s*\): Promise<ProjectState>/
  );
  assert.match(projects, /export type ProjectState = \{ error\?: string \}/);
});

test('no error thrown inside the create path escapes the action', () => {
  // The checks legitimately throw; the wrapper is what turns them into state.
  // If the try/catch were dropped, a rejected submit would go silent again.
  const body = projects.slice(projects.indexOf('export async function createProjectAction'));
  const wrapper = body.slice(0, body.indexOf('async function create('));
  assert.match(wrapper, /catch \(err\)/, 'createProjectAction must catch and convert');
  assert.doesNotMatch(wrapper, /throw new Error/, 'the wrapper must not throw');
});

test('the project form renders the error it is handed', () => {
  assert.match(projectForm, /useActionState\(createProjectAction, null\)/);
  assert.match(projectForm, /\{state\?\.error &&/);
});

test('every action error is announced, not just coloured red', () => {
  // Each of these banners is the only feedback a user gets when an action
  // refuses: "An account with this email already exists", "Too many failed
  // sign-in attempts". Without role="alert" it is a colour change on a div,
  // which a screen reader never announces — the form looks stuck.
  const forms = {
    'login-form.tsx': loginForm,
    'register/page.tsx': registerPage,
    'project-form.tsx': projectForm,
  };
  for (const [name, source] of Object.entries(forms)) {
    assert.match(source, /\{state\?\.error &&/, `${name} never renders its error`);
    const banner = source.slice(source.indexOf('{state?.error &&'));
    // Scoped to the banner so role="alert" anywhere else in the file would not
    // pass for one that only happens to sit in the same component.
    assert.match(
      banner.slice(0, 400),
      /role="alert"/,
      `${name} renders its error without announcing it`
    );
  }
});

test('deleting a project asks first', () => {
  // Irreversible, and the button is otherwise identical to the Archive control
  // beside it. Without this the operator gets no second chance.
  assert.match(deleteButton, /window\.confirm\(/);
  // Declining has to actually stop the submit, not just show a dialog.
  assert.match(deleteButton, /e\.preventDefault\(\)/);
  // Naming the project is what makes the dialog useful rather than a reflex OK.
  assert.match(deleteButton, /\$\{name\}/);
});

test("the project date is shown in the viewer's timezone without breaking hydration", () => {
  // A bare formatDate() call formats on the server — always UTC in the bundled
  // image — and React keeps a server component's text through hydration rather
  // than re-deriving it, so a project created at 02:00 on Tuesday Tokyo time
  // read as Monday and nothing ever warned about it. The row has to go through
  // the client component instead.
  assert.match(
    dashboard,
    /<LocalDate iso=\{p\.createdAt\.toISOString\(\)\} serverText=\{formatDate\(p\.createdAt\)\} \/>/
  );
  assert.doesNotMatch(dashboard, /<span[^>]*>\s*\{formatDate\(p\.createdAt\)\}/);

  // `useState(serverText)` is the whole trick. A lazy initialiser would run in
  // the browser during hydration and put a second, different string in the DOM
  // — trading an invisible wrong date for a real hydration mismatch.
  assert.match(localDate, /useState\(serverText\)/);
  assert.doesNotMatch(localDate, /useState\(\(\) =>/);
  // The effect corrects the text; it must not be faked away by telling React
  // not to care, which would hide a genuine mismatch on every page.
  assert.doesNotMatch(localDate, /suppressHydrationWarning/);

  // The instant stays machine-readable in the attribute regardless of the
  // visible string, and text content is the only thing that ever changes.
  assert.match(localDate, /<time dateTime=\{iso\}>\{text\}<\/time>/);
});
