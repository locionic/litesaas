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
const auth = code('../src/app/actions/auth.ts');
const validate = code('../src/lib/validate.ts');
const dashboard = code('../src/app/dashboard/page.tsx');
const projectForm = code('../src/app/dashboard/project-form.tsx');
const editForm = code('../src/app/dashboard/edit-project-form.tsx');
const deleteButton = code('../src/app/dashboard/delete-project-button.tsx');
const loginForm = code('../src/app/(auth)/login/login-form.tsx');
const registerPage = code('../src/app/(auth)/register/page.tsx');
const localDate = code('../src/app/dashboard/local-date.tsx');

test('no server action reads a form field itself', () => {
  // A server action is a plain POST endpoint, so any field can arrive as a File
  // part. `formData.get(x) as string` then `.trim()` is a TypeError — proven in
  // tests/validate.test.ts against a real File — which 500s an unauthenticated
  // request on a form that reads perfectly normally in the source.
  //
  // Stated as "no action calls formData.get at all" rather than per call site,
  // because the per-site version only pins the two that exist today and says
  // nothing about the next action someone adds. One reader, in one place.
  const readers = [
    ['billing.ts', billing],
    ['projects.ts', projects],
    ['auth.ts', auth],
  ]
    .filter(([, src]) => src.includes('formData.get('))
    .map(([name]) => name);

  assert.deepEqual(
    readers,
    [],
    `read form fields through formText() from src/lib/validate.ts: ${readers.join(', ')}`
  );

  // And the helper is the only reader, so it cannot be quietly bypassed.
  assert.equal(
    (validate.match(/formData\.get\(/g) || []).length,
    1,
    'src/lib/validate.ts should hold exactly one formData.get, inside formText'
  );
  for (const [name, src] of [
    ['auth.ts', auth],
    ['projects.ts', projects],
  ] as const) {
    assert.match(src, /import \{[^}]*\bformText\b[^}]*\} from '@\/lib\/validate'/, `${name} must import formText`);
  }
});

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
  // inactive store; Stripe types CheckoutSession.url as `string | null`. A null
  // on the first used to mean "carry on" into Stripe; on the second it fell out
  // of the block entirely, into the fall-through that blames the price id the
  // operator has already set — or, on a dev build, grants Pro for free.
  //
  // Stated per arm rather than "somewhere in the file": one copy of the guard
  // satisfies a file-wide match while the other provider stays bare.
  const arm = (from: string, to: string): string => {
    const start = billing.indexOf(from);
    const end = start >= 0 ? billing.indexOf(to, start + 1) : -1;
    assert.ok(start >= 0 && end > start, `could not locate the arm starting ${JSON.stringify(from)}`);
    return billing.slice(start, end);
  };

  const guard = /if \(!checkoutUrl\) \{\s*redirect\('\/dashboard\?billing=error'\);/;

  for (const [name, from, to, assigned] of [
    ['lemonSqueezy', "if (BILLING_PROVIDER === 'lemonsqueezy') {", "if (BILLING_PROVIDER === 'stripe'", 'checkoutUrl = await createCheckout('],
    ['stripe', "if (BILLING_PROVIDER === 'stripe'", 'if (checkoutUrl) {', 'checkoutUrl = session.url'],
  ] as const) {
    const slice = arm(from, to);
    const at = slice.search(guard);
    assert.notEqual(at, -1, `a ${name} checkout with no URL must not be treated as a successful one`);

    // Position, not just presence. A guard written *above* the assignment tests
    // a value that is still null and so fires on every checkout, successful ones
    // included — which looks like this test passing and behaves like the bug.
    assert.ok(at > slice.indexOf(assigned), `the ${name} guard must follow ${assigned}, not precede it`);
  }
});

test('the LemonSqueezy checkout is stamped with a minted nonce, not the user id', () => {
  // The link between this file and the webhook route. The route resolves the
  // row by `lemon_nonce`, so passing `userId: user.id` here would leave every
  // real event unmatched: a paid customer who never gets Pro, and a webhook
  // reporting success the whole way.
  assert.match(
    billing,
    /createCheckout\(\{\s*nonce: await checkoutNonce\(user\.id\)/,
    'the checkout must carry the nonce from checkoutNonce()'
  );
  assert.doesNotMatch(
    billing,
    /createCheckout\(\{[^}]*userId/,
    'the user id must not reach createCheckout — it is attacker-chosen on a public endpoint'
  );
});

test('the nonce is minted once and reused, not rotated per attempt', () => {
  // Rotating per attempt is tidier and is a money bug: two clicks in a row
  // would leave the first checkout carrying a nonce no longer on the row, so
  // that customer pays and the webhook matches nothing. It also has to outlive
  // the checkout, because a refund arrives days later.
  const fn = billing.slice(
    billing.indexOf('async function checkoutNonce'),
    billing.indexOf('export async function upgradeToProAction')
  );
  assert.ok(fn.length > 0, 'checkoutNonce is gone; this test needs revisiting');

  // The read comes first, and the existing value is returned rather than
  // replaced — an UPDATE that matched no rows would return a nonce that was
  // never stored, and every event would resolve to no subscription.
  assert.match(fn, /if \(row\?\.lemonNonce\) return row\.lemonNonce;/);
  assert.ok(
    fn.indexOf('findFirst') < fn.indexOf('.update(subscriptions)'),
    'the row must be read before the write, not assumed'
  );
  assert.match(fn, /crypto\.randomBytes\(32\)\.toString\('hex'\)/);
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
  // section never tells the operator to change. Both providers return the
  // customer there *after* the charge clears — Stripe via success_url,
  // LemonSqueezy via product_options.redirect_url — so the default means money
  // taken and the customer dropped on their own machine.
  const guard = billing.search(
    /NODE_ENV === 'production'[\s\S]{0,400}?localhost[\s\S]{0,400}?redirect\('\/dashboard\?billing=appurl'\)/
  );
  assert.notEqual(guard, -1, 'a production checkout must refuse a localhost return address');

  // The rule lives in one helper, but a helper nobody calls satisfies the
  // search above on its own — so assert the CALL, per arm, not the definition.
  // This is the half that goes missing: LemonSqueezy got a redirect_url before
  // it got the guard, and checking for Stripe is not the same as applying the
  // rule to LemonSqueezy.
  const arm = (from: string, to: string): string => {
    const start = billing.indexOf(from);
    const end = start >= 0 ? billing.indexOf(to, start + 1) : -1;
    assert.ok(start >= 0 && end > start, `could not locate the arm starting ${JSON.stringify(from)}`);
    return billing.slice(start, end);
  };

  for (const [name, from, to, handOff] of [
    ['lemonSqueezy', "if (BILLING_PROVIDER === 'lemonsqueezy') {", "if (BILLING_PROVIDER === 'stripe'", 'redirectUrl: successUrl'],
    ['stripe', "if (BILLING_PROVIDER === 'stripe'", 'if (checkoutUrl) {', 'checkout.sessions.create'],
  ] as const) {
    const slice = arm(from, to);
    const at = slice.indexOf('redirectIfLocalOrigin();');
    assert.notEqual(at, -1, `the ${name} arm must apply the localhost guard`);

    // Before the provider is handed a return address, not after. By the time
    // the session exists the customer is already being pointed at localhost.
    const at2 = slice.indexOf(handOff);
    assert.notEqual(at2, -1, `could not locate the ${name} hand-off`);
    assert.ok(at < at2, `the ${name} guard must run before the provider is given the origin`);
  }

  // Refusing is only useful if the operator can see why. Without a banner the
  // upgrade button simply stops working.
  assert.match(dashboard, /params\.billing === 'appurl'/);
  assert.match(dashboard, /NEXT_PUBLIC_APP_URL/);
  // The banner can now be reached from either provider, so it must not send a
  // LemonSqueezy operator looking at Stripe.
  const appurl = dashboard.slice(
    dashboard.indexOf("params.billing === 'appurl'"),
    dashboard.indexOf('</div>', dashboard.indexOf("params.billing === 'appurl'"))
  );
  assert.doesNotMatch(appurl, /Stripe/);
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

test('every form submits through the state wrapper, not the action directly', () => {
  // The other half of the test above, and the half that was missing for two of
  // the three forms. `useActionState` being called and `{state?.error &&`
  // being rendered are two independent presences; nothing said the form was
  // wired to the wrapper. Wire it to the raw action instead —
  //
  //   <form action={formAction}>   ->   <form action={loginAction}>
  //
  // and both assertions still pass, while the behaviour is gone: a plain form
  // action's return value goes nowhere, `state` stays null forever, and a wrong
  // password produces no message, no navigation, and no error anywhere. On the
  // login form that is the app's front door going silent, and it is exactly the
  // failure createProjectAction had before it was given a state signature.
  //
  // `the project form renders the error it is handed` pinned this for
  // project-form.tsx alone; login and register had only the role="alert" map.
  const forms = {
    'login-form.tsx': { source: loginForm, action: 'loginAction' },
    'register/page.tsx': { source: registerPage, action: 'registerAction' },
    'project-form.tsx': { source: projectForm, action: 'createProjectAction' },
    'edit-project-form.tsx': { source: editForm, action: 'updateProjectAction' },
  };

  for (const [name, { source, action }] of Object.entries(forms)) {
    // The second binding of the destructure is the submit function; the first is
    // the state. Captured rather than hardcoded, so renaming it is a rename and
    // not a failure.
    //
    // The optional type arguments and the optional `.bind(...)` are there
    // because the edit form has to be both — it is the one action whose id comes
    // from the row rather than from the form, so it binds, and binding erases the
    // arity that the explicit parameters make unambiguous. Both groups are
    // optional, so every form that does neither still matches the old shape.
    const destructure = source.match(
      new RegExp(
        `const\\s*\\[\\s*state\\s*,\\s*(\\w+)[^\\]]*\\]\\s*=\\s*useActionState(?:<[^>]*>)?\\(\\s*${action}\\s*(?:\\.bind\\([^)]*\\))?\\s*,\\s*null\\s*\\)`
      )
    );
    assert.ok(
      destructure,
      `${name} no longer calls useActionState(${action}, null), so it cannot show an action error`
    );

    const submit = destructure[1] ?? 'formAction';
    assert.match(
      source,
      new RegExp(`<form[^>]*action=\\{${submit}\\}`),
      `${name} must post to the wrapper's submit function, or its state never updates`
    );

    // The negative, which is what the two independent presences let through:
    // the action itself must not be handed to the form.
    assert.doesNotMatch(
      source,
      new RegExp(`<form[^>]*action=\\{${action}\\}`),
      `${name} submits to the raw action, so its return value is discarded and every error is silent`
    );
  }
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
    'edit-project-form.tsx': editForm,
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
  // Naming the project is what makes the dialog useful rather than a reflex OK.
  assert.match(deleteButton, /\$\{name\}/);

  // The relationship, not the three presences. Checking that `confirm`, and
  // `preventDefault`, and the name each appear somewhere proves nothing about
  // which of them decides the other — only this does. Inverting the condition to
  // `if (window.confirm(...)) {` keeps all three greppable and inverts the
  // control: confirming deletes nothing and cancelling destroys the row. Proven
  // green at 159/159 before this assertion existed.
  //
  // Matched as one regex because that is the whole claim: the branch that calls
  // preventDefault must be the branch guarded by the confirm. A handler that
  // cancelled the default unconditionally and then asked anyway has no such
  // branch and so fails here — the delete would silently never happen.
  //
  // The condition is captured with `.+?` rather than `[^)]*` because the confirm
  // call brings its own parentheses: a character class that cannot cross `)`
  // stops inside the call and never reaches the brace.
  const guard = deleteButton.match(/if \((.+?)\) \{[^}]*e\.preventDefault\(\)/);
  assert.ok(guard, 'nothing stops the submit when the confirmation is declined');

  // Declining has to stop it, so the branch that stops it is the *false* one.
  assert.match(
    guard[1],
    /^\s*!\s*window\.confirm\(/,
    'preventDefault must sit in the declined branch, not the confirmed one'
  );
});

test('the delete button submits its form, and announces itself', () => {
  // Two attributes that read as decoration and are not. Both escaped the test
  // above, which checks the confirmation and the name but not the two things
  // that make the control work and be reachable.
  //
  // `type="submit"` is the whole mechanism. This button carries no handler —
  // `onClick` exists only to *veto* — so the form it sits in is what performs
  // the delete. `type="button"` is a perfectly reasonable-looking edit for
  // "buttons shouldn't submit", and its effect is that the only destructive
  // control in the app silently does nothing. No error, no failed test: the
  // request is never made, so nothing can observe that it was supposed to be.
  assert.match(
    deleteButton,
    /type="submit"/,
    'the delete button no longer submits its form, so deleting a project does nothing at all'
  );
  // …and it must not become one of the other two. `type="button"` and a bare
  // `<button>` are the same no-op wearing different clothes.
  assert.doesNotMatch(
    deleteButton,
    /type="button"|type="reset"|<button(?![^>]*type=)/,
    'the delete button must submit, not reset or default to an inert button'
  );

  // The control holds an <svg> and no text, so this label is its entire
  // accessible name — there is nothing else for a screen reader to read. It has
  // to name the project too: the dashboard is a list of N rows and this button
  // appears once per row, so a generic name announces "Delete project, button"
  // N times with nothing to tell the rows apart. The `name` prop was already
  // here for the confirm dialog, so the string costs nothing.
  assert.match(
    deleteButton,
    /aria-label=\{`Delete \$\{name\}`\}/,
    'the delete button needs an accessible name that says which project it deletes'
  );

  // And `title`, which a mouse user reads instead. The two must not drift: the
  // tooltip and the announcement are the same label reached two ways, and one
  // of them being generic re-creates the ambiguity for half the users.
  assert.match(deleteButton, /title=\{`Delete \$\{name\}`\}/);
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

test('registration writes the account and its subscription together', () => {
  // Same defect as the demo seed, with a worse ending. registerAction inserted
  // the user row inside a try/catch and the subscriptions row *after* it, so any
  // fault in between threw a 500 at a visitor whose account was already
  // committed — one that existed, so retrying said "that email already exists",
  // but had no subscriptions row at all. From there the dev mock upgrade's
  // `UPDATE ... WHERE user_id = ?` matched zero rows and silently did nothing on
  // every retry, forever: a button that reported success and changed nothing.
  const at = auth.indexOf('export async function registerAction');
  assert.notEqual(at, -1, 'registerAction was renamed or removed; this test needs revisiting');
  const reg = auth.slice(at, auth.indexOf('export async function logoutAction'));

  assert.match(
    reg,
    /await db\.transaction\(async \(tx\) =>/,
    'the account and its free-tier subscription must commit together or not at all'
  );
  assert.match(reg, /tx\.insert\(users\)/);
  assert.match(reg, /tx\.insert\(subscriptions\)/);

  // The sharp half, as in tests/demo.test.ts: `db` is the pool, `tx` is the
  // transaction handle. An insert written as `db.insert(...)` inside the callback
  // compiles, reads identically, and issues on a connection outside the
  // transaction — so the rollback covers one insert and not the other, which is
  // the exact regression the wrapper exists to prevent.
  assert.doesNotMatch(
    reg,
    /\bdb\.insert\(/,
    'an insert issued on db bypasses the transaction handle and is not covered by the rollback'
  );

  // And the UNIQUE race handling must still fire. The violation has to surface
  // *out* of the transaction for the catch to see it, so the catch cannot move
  // inside the callback — that would be an uncatchable throw, and the friendly
  // "an account with this email already exists" message would become a 500.
  // Ordered rather than pattern-matched: the transaction opens, the catch clause
  // opens after it (so the rollback happens first), and the handler lives inside
  // that clause. A catch clause is `catch (err) {` — no arrow function — so the
  // three indices are the only honest way to say this.
  const txn = reg.indexOf('db.transaction(');
  const catchAt = reg.indexOf('catch (err) {');
  const handler = reg.indexOf('SQLITE_CONSTRAINT_UNIQUE');
  assert.ok(txn > 0, 'registerAction must open the transaction');
  assert.ok(catchAt > txn, 'the catch must wrap the transaction, not sit inside the callback');
  assert.ok(handler > catchAt, 'the UNIQUE handler must live inside that catch clause');
});

test('a new account is created on the free plan', () => {
  // The one place a plan is ever chosen without money changing hands, and the
  // only place one is chosen at all — every other write is a webhook reacting to
  // a payment. The plan on this row is what `getCurrentUser` reads back, so it is
  // not a default something later corrects: the account is on Pro.
  //
  // Nothing caught it. plans.test.ts pins what the pricing table *says* and what
  // `projectLimitFor` does with a plan it is handed; the dashboard test pins that
  // the cap refuses the right attempt. All of that is downstream of this line.
  // Flip it to 'pro' and every signup in the world gets unlimited projects for
  // $0, on a pricing page quoting "Up to 3 active projects" for Free.
  const reg = auth.slice(auth.indexOf('export async function registerAction'));
  const insert = reg.slice(reg.indexOf('insert(subscriptions)'));
  assert.ok(insert, 'registerAction no longer writes a subscription row; revisit this test');

  assert.match(insert, /plan: 'free'/, 'a new account is not created on the free plan');
  assert.doesNotMatch(insert, /plan: 'pro'/, 'a new account is created on Pro without a payment');
});

test('the account row stores a hash, never the submitted password', () => {
  // The one property the users table depends on, and the widest hole found in
  // this file. Every other password test in the repo exercises hashPassword and
  // verifyPassword *directly*; nothing stands between them and the row, so this
  // call is load-bearing and nothing was watching it.
  //
  // `const passwordHash = password` compiles, type-checks — it is still a string,
  // `passwordHash` is still a string, the insert is unchanged — and writes the
  // plaintext into the users row. No test goes red: validate.test.ts tests the
  // validator, password.test.ts tests the two KDF functions, and nothing signs an
  // account up and then reads the row back. The database file is
  // Litestream-replicated, so that row is the entire password store of every
  // account on the instance, in the clear.
  //
  // The sibling of this is already pinned — session-auth.test.ts asserts the
  // session id is a CSPRNG value — which is what makes the gap conspicuous: the
  // generated id got a test and the generated hash did not.
  const at = auth.indexOf('export async function registerAction');
  assert.notEqual(at, -1, 'registerAction was renamed or removed; this test needs revisiting');
  const reg = auth.slice(at, auth.indexOf('export async function logoutAction'));

  assert.match(
    reg,
    /const passwordHash = hashPassword\(password\)/,
    'the account row must be written from hashPassword(password), not from the submitted password'
  );

  // And the row has to actually use it — otherwise the line above is satisfied by
  // a hash computed and thrown away while the insert still writes the plaintext.
  const insert = reg.slice(reg.indexOf('insert(users)'));
  assert.ok(insert, 'registerAction no longer inserts a user row; revisit this test');
  assert.match(insert, /passwordHash,/, 'the user row is no longer written from the computed hash');
  assert.doesNotMatch(
    insert,
    /passwordHash: password\b/,
    'the user row is written straight from the submitted password'
  );
});

test('registerAction validates the submission, because the form cannot', () => {
  // A server action is a plain POST. The register form's type="email" and
  // minLength={MIN_PASSWORD} are browser suggestions — form-input-hints.test.ts
  // checks that the markup carries them, which is exactly the problem: a test
  // passing on the client is a test passing about a promise the server never made.
  //
  // Delete the validateRegistration call and the action writes whatever arrived:
  // a 200,000-character name into the users row, replicated to S3 by Litestream,
  // once per request, from an unauthenticated POST that looks perfectly ordinary.
  // The comment above the call says as much — "without these checks a single
  // request can write a 200KB name straight into the row" — describing a defect
  // that was fixed at some point and never pinned.
  const at = auth.indexOf('export async function registerAction');
  assert.notEqual(at, -1, 'registerAction was renamed or removed; this test needs revisiting');
  const reg = auth.slice(at, auth.indexOf('export async function logoutAction'));

  const call = reg.indexOf('validateRegistration(');
  const insert = reg.indexOf('insert(users)');
  assert.notEqual(call, -1, 'registerAction no longer validates its input');
  assert.ok(call < insert, 'the account is written before the submission is validated');

  // And the verdict has to reach the form rather than the logs: validateProject
  // and validateRegistration both return a user-facing string, and dropping the
  // return turns a rejected signup into an unhandled throw and a 500.
  assert.match(
    reg,
    /const invalid = validateRegistration\(\{[^}]*\}\);\s*if \(invalid\) \{\s*return \{ error: invalid \};\s*\}/,
    'the validation result is no longer returned to the form'
  );
});

/** One action's body, from its declaration to its closing brace in column 0. */
const action = (name: string): string => {
  const from = auth.indexOf(name);
  assert.notEqual(from, -1, `${name} is gone; this test needs revisiting`);
  const end = auth.indexOf('\n}\n', from);
  assert.ok(end > from, `${name} has no closing brace in column 0; this helper needs revisiting`);
  return auth.slice(from, end);
};

test('a finished sign-in or sign-up ends with a session and a redirect', () => {
  // Both halves are load-bearing and neither was pinned. Drop `createSession` from
  // registerAction and the visitor gets "An account with this email already
  // exists" on every retry: the row is committed, but the one write that would
  // have signed them in is gone. Drop the redirect instead and the action resolves
  // successfully with nothing to show for it, because `redirect()` is what carries
  // the visitor out of the form — there is no success state on the page to fall
  // back to.
  //
  // The order matters as much as the presence: the cookie is written by
  // createSession, so redirecting first lands /dashboard with no session, which
  // reads as a signed-out visitor rather than as a bug.
  for (const name of ['export async function loginAction(', 'export async function registerAction(']) {
    const body = action(name);
    const session = body.indexOf('createSession(');
    const nav = body.indexOf("redirect('/dashboard')");

    assert.notEqual(session, -1, `${name} creates no session, so the visitor stays signed out`);
    assert.notEqual(nav, -1, `${name} never redirects, so the form just re-renders on success`);
    assert.ok(session < nav, `${name} redirects before creating the session`);
  }
});

test('a signup fault the handler does not recognise is a 500, not a message from the driver', () => {
  // The catch exists for exactly one error — the UNIQUE violation from two
  // simultaneous signups — and everything else has to keep going up as a 500.
  // Returning instead hands the raw driver error to a visitor as form feedback:
  // "SQLITE_BUSY: database is locked", a read-only mount, or a NOT NULL violation
  // from a column added since, none of which the person filling in the form can
  // act on and all of which describe the database to a stranger.
  const reg = action('export async function registerAction');
  const handler = reg.indexOf('SQLITE_CONSTRAINT_UNIQUE');
  assert.notEqual(handler, -1, 'the UNIQUE arm is gone; this test needs revisiting');

  assert.match(
    reg.slice(handler),
    /throw err;/,
    'an unrecognised database fault is turned into a user-facing message built from the driver error'
  );
});

test('sign-up and sign-in normalize an address the same way', () => {
  // Two actions, one address, and nothing between them. The UNIQUE index is on
  // the raw `users.email` column and sign-in looks up `eq(users.email, email)`,
  // so normalization is the *only* thing making one address one account — and it
  // has to be the same transformation on both sides, or an account can be created
  // in a form it can never be signed into.
  //
  // Asserted per-action rather than as an equality between the two, because the
  // lines are currently character-identical: comparing them passes just as
  // happily if both are switched to `toUpperCase()`, and says nothing about
  // whether either normalizes at all. Each is lifted from the action it belongs
  // to, so one shared line cannot satisfy both.
  const emailIn = (name: string) => {
    const body = auth.slice(auth.indexOf(`export async function ${name}`));
    return body.match(/const email = ([^;]+);/)?.[1];
  };

  for (const action of ['loginAction', 'registerAction']) {
    const read = emailIn(action);
    assert.ok(read, `${action} no longer reads an email off the form; revisit this test`);
    assert.match(
      read,
      /\.toLowerCase\(\)/,
      `${action} stops lowercasing the address — a user who types it in any other case cannot sign in`
    );
  }
});

test('user ids are unguessable, on the same terms as project ids', () => {
  // project-ownership.test.ts makes this argument for `prj_`; `usr_` is the
  // stronger of the pair, being the tenant key every scoped query filters on.
  // Same caveat, same reason: it is not an authorisation boundary on its own —
  // every read and write is owner-scoped — but it is the value a script iterates
  // over, and `usr_` + 6 hex characters is a 24-bit space to walk.
  const m = auth.match(/const userId = `usr_\$\{crypto\.randomBytes\((\d+)\)/);
  assert.ok(m, 'the user id no longer comes from a CSPRNG; this test needs revisiting');
  assert.ok(Number(m[1]) >= 12, `user ids are only ${m[1]} bytes wide`);
});
