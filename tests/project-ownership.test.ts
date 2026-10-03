import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// Every assertion in this repo about the project actions was about *what* they
// do — validate the name, enforce the cap, return `{ error }` instead of
// throwing. Nothing was about *whose* rows they touch. The suite contained no
// occurrence of `deleteProjectAction` at all, so the authorization on the only
// destructive surface in the app was entirely unpinned:
//
//   1. Owner scoping on delete and archive. Both take a caller-supplied projectId
//      and both must match it against the session's user id in the same WHERE.
//      Drop the userId and any signed-in user deletes or archives any project in
//      the database — and the dashboard hands out real ids, so the id is not a
//      secret, merely unguessable.
//   2. The session gate. Every action starts from getCurrentUser. Without the
//      check there is no `user.id` to scope by, and the first editor to make the
//      query work without one has removed the authorization and added an outage
//      in the same commit.
//   3. The flip is computed in SQL. Reading the row and writing the inverse is a
//      lost update: two concurrent requests both read 'active', both write
//      'archived', and an even number of them nets to archived regardless of
//      what the user asked for. The natural refactor of this function — pull the
//      status out, branch on it in JS — reintroduces that silently.
//   4. The cap counts the caller's own ACTIVE projects. Both filters earn their
//      place. Drop userId and every user on the install shares one quota of
//      three; drop status and archiving stops freeing a slot, which is precisely
//      what the error message tells the user to do ("Archive one to make room").
//   5. The dashboard's one read is scoped the same way, and the metrics strip is
//      computed from that array rather than from a second query. The actions
//      above are the ones that mutate, so scoping was checked there and the page
//      that lists everything was left to be reviewed by eye — it happens to be
//      correct, and nothing would have said so if it stopped being.
//
// Source assertions, because the module imports next/cache and the db and so
// cannot be imported under `node --test` — the same reason server-action-contracts
// .test.ts reads source instead of calling in. Comments are stripped first, so a
// prose mention of a filter cannot satisfy an assertion about it.

const src = readFileSync(
  fileURLToPath(new URL('../src/app/actions/projects.ts', import.meta.url)),
  'utf8'
);

const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const dashboard = readFileSync(
  fileURLToPath(new URL('../src/app/dashboard/page.tsx', import.meta.url)),
  'utf8'
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const editForm = readFileSync(
  fileURLToPath(new URL('../src/app/dashboard/edit-project-form.tsx', import.meta.url)),
  'utf8'
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const exportRoute = readFileSync(
  fileURLToPath(new URL('../src/app/api/projects/export/route.ts', import.meta.url)),
  'utf8'
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * One function's body, up to whichever declaration follows it.
 *
 * The "whichever" is load-bearing: `create` is a private helper sitting between
 * `createProjectAction` and `deleteProjectAction`, so matching only on `export `
 * would run the create body three declarations long and let an assertion about
 * the wrong function pass.
 */
const body = (name: string): string => {
  const from = code.indexOf(`function ${name}(`);
  assert.notEqual(from, -1, `${name} is gone; this test needs revisiting`);
  const rest = code.slice(from);
  const next = rest.slice(1).search(/\n(?:export |async function |function |type )/);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

test('every project action refuses a caller with no session', () => {
  for (const name of [
    'createProjectAction',
    'deleteProjectAction',
    'toggleProjectStatusAction',
    'updateProjectAction',
  ]) {
    const fn = body(name);
    const user = fn.indexOf('const user = await getCurrentUser();');
    assert.notEqual(user, -1, `${name} no longer reads the session`);
    assert.match(fn, /if \(!user\)/, `${name} does not refuse an unauthenticated caller`);
    assert.ok(
      user < fn.search(/if \(!user\)/),
      `${name} must resolve the session before deciding anything about it`
    );
  }
});

test('a destructive action is scoped to the caller, not just to the id', () => {
  for (const name of ['deleteProjectAction', 'toggleProjectStatusAction', 'updateProjectAction']) {
    const fn = body(name);
    assert.match(fn, /eq\(projects\.id, projectId\)/, `${name} must match the project it was given`);
    assert.match(
      fn,
      /eq\(projects\.userId, user\.id\)/,
      `${name} matches only on id — any signed-in user can ${
        name === 'deleteProjectAction' ? 'delete' : name === 'updateProjectAction' ? 'rename' : 'archive'
      } any project`
    );
  }
});

test('every write that takes a form validates before it writes', () => {
  // The create path once had no `validateProject` call at all, and fourteen
  // assertions about the validator still passed, because none of them was the
  // call site. So this says it per write, over a list, rather than per action
  // somebody remembers to add: a new form-backed action that skips the check is
  // a failure here, not something the next reader has to notice.
  //
  // Measured on the edit path: replacing `validateProject({ name, description })`
  // with `null` left this file green until this test existed.
  const WRITES: Array<[string, string]> = [
    ['create', 'db.insert'],
    ['updateProjectAction', '.update(projects)'],
  ];

  for (const [name, write] of WRITES) {
    const fn = body(name);
    const check = fn.indexOf('validateProject(');
    assert.notEqual(check, -1, `${name} takes a form and never validates it`);
    assert.ok(
      check < fn.indexOf(write),
      `${name} writes before it validates — an unbounded row is already a row`
    );

    // …and the verdict has to be one the user is shown, or a valid-looking form
    // and a rejected save disagree about what happened.
    assert.match(
      fn,
      /if \(invalid\) \{\s*throw new UserError\(invalid\);/,
      `${name} does not stop the write on an invalid verdict`
    );
  }
});

test('the dashboard offers the edit, and only where a project is', () => {
  // Deleting the affordance entirely — the `<details>`, the form, both of them —
  // leaves every assertion in this file green, because every other one here is
  // about the action and its authorization, and an action nothing renders is
  // still correct. Stated as a presence so the whole path can be cut in one edit.
  assert.match(dashboard, /import EditProjectForm from '\.\/edit-project-form'/, 'the edit form is not imported');
  assert.match(
    dashboard,
    /<EditProjectForm projectId=\{p\.id\} name=\{p\.name\} description=\{p\.description\} \/>/,
    'the row does not render the edit form with the row it is editing'
  );

  // The disclosure is native, so the keyboard and the screen reader get it for
  // free — but only while it is a `<summary>` inside a `<details>`. Replaced by
  // a button plus `useState` (or, worse, a button with no handler), the row
  // renders identically on screen and the form becomes unreachable by keyboard.
  assert.match(dashboard, /<details className="group\/edit">[\s\S]*?<summary/, 'the edit form is not behind a native disclosure');
  assert.match(dashboard, /<\/summary>\s*<EditProjectForm/, 'the summary does not wrap the form it opens');

  // Seeded from the row. `defaultValue` with no value is an empty create form
  // sitting inside an edit, and saving it overwrites the name with nothing.
  const form = editForm;
  assert.match(form, /defaultValue=\{name\}/, 'the name input is not seeded from the row');
  assert.match(form, /defaultValue=\{description \?\? ''\}/, 'the description input is not seeded from the row');
});

test('a row of edit labels points at its own inputs, not the first row\'s', () => {
  // The two ids are `name-<id>` and `description-<id>`. Drop the id from either
  // and every row on the page renders the same duplicate DOM id: the visible
  // label in row 7 activates row 1's input, so editing any project but the first
  // one types into the wrong form and the ids stop being unique document-wide —
  // which is also what breaks `aria-labelledby` and any test that targets them.
  const fors = [...editForm.matchAll(/htmlFor=\{`([^`]+)`\}/g)].map((m) => m[1]);
  assert.ok(fors.length >= 2, `expected a label per field, found ${fors.length}`);

  for (const template of fors) {
    assert.match(
      template,
      /\$\{projectId\}/,
      `the label \`${template}\` is the same string on every row, so every label activates the first row's input`
    );
    // …and the matching element has to carry the *same* template. A label with
    // no element behind it is not a harmless extra attribute: assistive tech
    // reads the label as that field's accessible name, so the field announces
    // as nothing.
    assert.ok(
      editForm.includes(`id={\`${template}\`}`),
      `no element carries id={\`${template}\`} for the label that points at it`
    );
  }

  assert.deepEqual(
    fors,
    ['name-${projectId}', 'description-${projectId}'],
    'the two fields must have their own ids; a shared one sends both labels to the same input'
  );
});

test('the edit action writes a named set of columns, never the form body', () => {
  // The one place a `.set()` could be a merge of user input. A server action is
  // a plain POST, so anyone can add `status=active` to an archived project's
  // edit form and silently un-archive it, or send `userId=` and try to move the
  // row onto an account they control — the second is a takeover of the project
  // itself, since the ownership column is what every scope above filters on.
  //
  // Both ride in on the same request that legitimately carries `name`, so there
  // is no signature to reject them; the only thing that rejects them is this
  // line naming the columns instead of spreading what arrived.
  const set = body('updateProjectAction').match(/\.set\(\{([^}]*)\}\)/);
  assert.ok(set, 'updateProjectAction no longer writes a named column set');

  for (const column of ['name', 'description', 'updatedAt']) {
    assert.match(set[1], new RegExp(`\\b${column}\\b`), `${column} is no longer written`);
  }

  // The negative, which is the entire claim: an attacker-chosen `status` or
  // `userId` reaching the write. `description` legitimately reads to null on an
  // empty submit, so the check is that it comes from formText and nothing else
  // does.
  assert.doesNotMatch(
    set[1],
    /\.\.\./,
    'the update spreads something — the form body spreads attacker-chosen columns into the row'
  );
  assert.doesNotMatch(set[1], /\b(status|userId)\b/, 'an edit must not reach status or ownership');
  assert.match(
    body('updateProjectAction'),
    /description = formText\(formData, 'description'\) \|\| null/,
    'description must be read through formText, which drops a File part'
  );
});

test('only the messages written for the user reach the form', () => {
  // `catch (err) { return { error: err.message } }` was every fault in the create
  // path rendered in the UI — and `err.message` for a driver fault is SQLite's
  // own text: a constraint name, a column list, or on SQLITE_CANTOPEN the
  // absolute path of the database file on the operator's disk. The throw sites
  // below are the ones meant to be read; everything else collapses to one line.
  //
  // Scoped to the two functions a catch arm actually wraps. `deleteProjectAction`
  // and `toggleProjectStatusAction` also `throw new Error('Unauthorized')`, and
  // that is not the same defect: nothing catches them, so nothing displays them,
  // and they reach the error boundary instead. Restyling those as `UserError`
  // would claim a gate that is not on their path.
  const GATED = ['create', 'updateProjectAction'];
  const thrown = GATED.flatMap((name) =>
    [...body(name).matchAll(/throw new (UserError|Error)\(/g)].map((m) => [name, m[1]] as const)
  );

  // Each gated function throws at least once, or the arm below is gating nothing
  // and a regression that deletes the throws passes every assertion here.
  for (const name of GATED) {
    assert.ok(
      thrown.some(([from]) => from === name),
      `${name} has no deliberate throw left for its catch arm to name`
    );
  }
  for (const [name, kind] of thrown) {
    assert.equal(
      kind,
      'UserError',
      `${name} throws a plain Error, which the catch arm can no longer show — the form reads "try again" about something it could have named`
    );
  }

  // …and the arms are per action, not shared: a catch that forgot the test would
  // surface everything again. Asserted on the catch body itself rather than on
  // the file, because one arm passing says nothing about the other.
  for (const name of ['createProjectAction', 'updateProjectAction']) {
    const fn = body(name);
    const arm = fn.match(/catch \(err\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(arm, `${name} no longer catches`);
    assert.match(
      arm[0],
      /err instanceof UserError\s*\?[\s\S]*?err\.message/,
      `${name} does not gate on the error class before showing a message`
    );
    assert.match(
      arm[0],
      /:\s*'(?:Could not [^']*\.)'/,
      `${name} has no generic line for a fault it cannot name`
    );
  }
});

test('the archive toggle is computed in SQL, not by reading the row first', () => {
  const toggle = body('toggleProjectStatusAction');

  assert.match(
    toggle,
    /sql`case when \$\{projects\.status\} = 'archived' then 'active' else 'archived' end`/,
    'the flip must happen inside the UPDATE, so each statement is self-consistent'
  );

  // The negative is the one that holds. Reading the status first and branching
  // in JS is the obvious "let me make this readable" edit, and it reopens the
  // lost update: two requests both read 'active' and an even number of them
  // nets to archived no matter what the user asked for.
  assert.doesNotMatch(
    toggle,
    /findFirst|\.select\(/,
    'a read before the write reintroduces the lost update'
  );
});

test("the free-tier cap counts only the caller's own active projects", () => {
  // Stated as one WHERE because both clauses are load-bearing and they were
  // added together: the userId filter stops the install sharing one quota of
  // three, the status filter is what makes the error message's advice — archive
  // one to make room — actually work.
  assert.match(
    body('create'),
    /\.where\(and\(eq\(projects\.userId, user\.id\), eq\(projects\.status, 'active'\)\)\)/,
    "the cap must count this caller's active projects and nobody else's"
  );
});

test('the dashboard lists this caller\'s projects, and counts only those', () => {
  // The read half. Every assertion above is about a query that mutates; this is
  // the one query that hands a user the whole set, and it was the only unscoped
  // surface nobody had checked.
  const guard = dashboard.indexOf('if (!user)');
  const query = dashboard.indexOf('db.query.projects.findMany');
  assert.notEqual(query, -1, 'the dashboard no longer reads projects here; revisit this test');
  assert.notEqual(guard, -1, 'the dashboard no longer refuses a caller with no session');
  assert.ok(guard < query, 'the session must be resolved before the list is scoped by it');

  const call = dashboard.slice(query, dashboard.indexOf('});', query));
  assert.match(
    call,
    /where: eq\(projects\.userId, user\.id\)/,
    'the project list must be scoped to the session, not to the whole table'
  );

  // Exactly one read, because the strip is derived from this array. Two
  // `findMany` calls is the shape a "let me just fetch the totals directly"
  // change takes, and the second one is the one nobody re-reads — so the counts
  // would come from an unscoped query while the list beside them stayed scoped,
  // and the page would report the install's total next to the caller's rows.
  assert.equal(
    dashboard.split('db.query.projects.findMany').length - 1,
    1,
    'the dashboard has a second project read; the metrics strip must derive from the list'
  );

  // Both counts come from that array, in memory. Not a second database round
  // trip, and not something that could be scoped differently.
  assert.match(dashboard, /userProjects\.filter\(\(p\) => p\.status === 'active'\)\.length/);
  assert.match(dashboard, /userProjects\.length - activeCount/);
});
test('the cap refuses the attempt that reaches the limit, not the one after it', () => {
  // `>=` is the comparison, and it is the only thing standing between the pricing
  // table's "Up to 3 active projects" and the implementation. `>` admits one more,
  // so every free account settles at four — permanently, not just under the
  // concurrent-create race the comment beside it already concedes.
  //
  // This is the server half. The dashboard button got the same off-by-one fixed
  // and the two are not independent: the button is an affordance and this is the
  // check, so a fix that touched only the button would have made the page honest
  // and the enforcement worse. The comparison is lifted and run at its boundaries
  // rather than matched as text, so a rewrite that spells the same boundary
  // differently still has to satisfy it.
  // The operator is captured as its own token so it can be evaluated, rather than
  // matched as text — `\S+` and not a character class, which would have to exclude
  // `>` and so could never capture the `>=` that is actually there.
  const m = body('create').match(/if \(Number\(active\) (\S+) projectLimitFor\(/);
  assert.ok(m, 'the cap comparison is gone; this test needs revisiting');
  const atCap = new Function('active', 'limit', `return Number(active) ${m[1]} limit`) as (
    a: number,
    l: number
  ) => boolean;

  assert.equal(atCap(3, 3), true, 'the third project fills the free tier; the fourth must be refused');
  assert.equal(atCap(2, 3), false, 'and the third must still be allowed');
  assert.equal(atCap(4, 3), true, 'and it stays refused above the cap');
  assert.equal(atCap(0, Infinity), false, 'Pro is unbounded');
});

test('every action that changes a row refreshes the page that lists them', () => {
  // `create` returns `{}`, which the form reads as success, and the other two
  // return void. So the server has committed the change and told the user it
  // worked, and the only thing that makes the dashboard show it is
  // `revalidatePath`. The page is dynamic (`ƒ`), which rules out the *build*
  // cache but not the *client* router cache: a route already visited this
  // session is served from memory for 30s without the server running again. So
  // without the call, a deleted project stays on screen with a delete button that
  // now deletes nothing, an archive toggles nothing visible at all, and a created
  // project does not appear.
  //
  // All three, and counted. An assertion over one function passes with the other
  // two calls deleted, which is the shape two of the three mutations that escaped
  // the sweep actually took — one per action, and one from `delete` alone.
  const MUTATIONS: Array<[string, string]> = [
    ['create', 'insert(projects).values({'],
    ['deleteProjectAction', 'db.delete(projects)'],
    ['toggleProjectStatusAction', 'update(projects)'],
    ['updateProjectAction', '.set({ name, description, updatedAt: new Date() })'],
  ];

  for (const [name, write] of MUTATIONS) {
    const fn = body(name);
    assert.ok(fn.includes(write), `${name} no longer writes through "${write}"; revisit this test`);

    const refresh = fn.indexOf("revalidatePath('/dashboard')");
    assert.notEqual(refresh, -1, `${name} commits its change and tells no page to re-read it`);
    assert.ok(refresh > fn.indexOf(write), `${name} refreshes before it writes`);
  }

  // Non-vacuity. Four writes, four refreshes: a fifth action — or the same four
  // with one call hoisted into a helper — moves this count, and a count that no
  // longer tracks the writes is no longer checking anything.
  assert.equal(
    code.split("revalidatePath('/dashboard')").length - 1,
    MUTATIONS.length,
    'the number of dashboard refreshes no longer matches the number of actions that change a row'
  );

  // …and they name the route that exists. There is no `/dashboard/*` route in
  // this app, so a trailing slash or a stray `/` purges nothing at all, and a
  // set-based check says so where a count alone would not.
  assert.deepEqual(
    [...new Set([...code.matchAll(/revalidatePath\('([^']*)'\)/g)].map((m) => m[1]))],
    ['/dashboard'],
    'the dashboard is the only page these actions change, and it is named exactly'
  );
});

test('create validates the form before it writes, and writes what the form sent', () => {
  const create = body('create');

  // The enforcement, not a suggestion — the source says so itself: "The form's
  // `required` is a client-side suggestion only; this is the enforcement, and it
  // is also what bounds a single row."
  //
  // Measured: `const invalid = validateProject({ name, description })` →
  // `const invalid = null` left this file green. validate.test.ts exercises that
  // function in fourteen places and every one of them passed, because none of
  // them is the call site — fourteen assertions about a validator the create
  // path never reached. The POST goes straight to this action, so with the call
  // gone an empty name is a real row, and so is a name of a million characters:
  // SQLite has no length cap on the column, so "bounds a single row" was true
  // only because this line existed.
  assert.match(create, /validateProject\(\{/, 'the submitted form is never validated server-side');
  assert.match(
    create,
    /if \(invalid\) \{\s*throw new UserError\(invalid\);/,
    'the verdict does not stop the insert, or is not one the form is allowed to show'
  );
  assert.ok(
    create.indexOf('validateProject') < create.indexOf('db.insert'),
    'validation must run before the row is written, not after'
  );

  // …and what it validated is what it persists. Measured: dropping the
  // `formText(formData, 'description')` read also left this file green — while
  // page.tsx:293 kept rendering `{p.description}` and the dashboard form kept
  // offering the field with a label and a maxLength. The user types a
  // description, it is validated, and it is discarded.
  assert.match(
    create,
    /formText\(formData, 'description'\)/,
    'the description field is never read from the form'
  );
  assert.match(
    create,
    /\.values\(\{[\s\S]*?\bdescription,/,
    'the description is read and then dropped on the way to the row'
  );
});

test('a new project is created active', () => {
  // The insert's own status, which the cap depends on: `create` counts rows
  // WHERE status = 'active', so a project born archived does not consume a slot,
  // does not appear in the dashboard's active count, and does not appear at all
  // in the list the cap is measured against. It looks like the cap is working —
  // the user can create forever, and the error never fires.
  assert.match(
    body('create'),
    /insert\(projects\)\.values\(\{[\s\S]*?status: 'active'/,
    'a project created archived is invisible to the cap and to the dashboard'
  );
});

test('project ids are unguessable', () => {
  // 12 bytes of CSPRNG. Not an authorisation boundary — every read and write is
  // owner-scoped — but the id is what a script iterates over, so a short one
  // makes enumeration cheap enough to bother with, and `prj_` + 6 hex characters
  // is a 24-bit space.
  const m = body('create').match(/crypto\.randomBytes\((\d+)\)/);
  assert.ok(m, 'the project id no longer comes from a CSPRNG; this test needs revisiting');
  assert.ok(Number(m[1]) >= 12, `project ids are only ${m[1]} bytes wide`);
});

// ---------------------------------------------------------------------------
// Phase 2: the export route and the two dashboard affordances.
// ---------------------------------------------------------------------------

test('the export hands over the caller\'s rows and nobody else\'s', () => {
  // A read of the whole set, in a URL. The dashboard's own read was scoped
  // above; this is the second surface that returns every row a user owns, and it
  // is the one a stranger would rather have — a file they can keep.
  assert.match(
    exportRoute,
    /where: eq\(projects\.userId, user\.id\)/,
    'the export must be scoped to the session in the query'
  );
  assert.match(
    exportRoute,
    /const user = await getCurrentUser\(\);/,
    'the export resolves no session, so there is nothing to scope by'
  );

  // Scoped *and* refused. A route that queries correctly but falls through to
  // an empty export for a signed-out caller is a smaller problem, but the one
  // here is worse: `user.id` off a null is a 500 on every request from a
  // logged-out tab, which is most of the tabs a browser has.
  assert.match(exportRoute, /if \(!user\) \{[\s\S]*?401/);

  // Exactly one read, scoped. Two `findMany` calls is the shape an "and the
  // totals too" edit takes, and the second one is the unscoped one.
  assert.equal(
    exportRoute.split('db.query.projects.findMany').length - 1,
    1,
    'the export reads projects more than once'
  );
  const call = exportRoute.slice(
    exportRoute.indexOf('findMany'),
    exportRoute.indexOf('});', exportRoute.indexOf('findMany'))
  );
  assert.match(call, /eq\(projects\.userId, user\.id\)/);
});

test('the export downloads a file rather than rendering one', () => {
  // `attachment` or the browser shows the JSON as a page: an array of the
  // caller's own rows, at a URL on their own origin, rendering as HTML. That is
  // a convincing phishing surface and it costs one header to close.
  assert.match(exportRoute, /content-disposition/);
  assert.match(exportRoute, /attachment/);
  assert.match(exportRoute, /filename=/);

  // Private data in a shared cache is the same leak with a longer fuse: the
  // next person through the proxy gets a cached copy of someone's projects.
  assert.match(exportRoute, /cache-control/);
  assert.match(exportRoute, /no-store/);
});

test('the usage meter reads the numbers the create button reads', () => {
  // One source of truth. The meter and the disabled button both describe the
  // same cap; if they can disagree, the user gets a full green bar beside a
  // button that refuses, or an amber bar that is not actually at the limit.
  //
  // Both must come from `activeCount`/`projectLimit` — the counts computed from
  // the UNFILTERED list. Measuring the filtered one is the silent version of
  // this bug: search for a project that is not active, and the meter reads
  // empty while the server is still refusing the fourth create.
  assert.match(
    dashboard,
    /activeCount \/ projectLimit\)\s*\*\s*100/,
    'the meter does not measure activeCount against projectLimit'
  );
  assert.match(dashboard, /const atProjectLimit = activeCount >= projectLimit;/);
  assert.doesNotMatch(
    dashboard,
    /visibleProjects[\s\S]{0,80}projectLimit/,
    'the meter is measuring the filtered list'
  );

  // And it is hidden when there is no cap, rather than drawn full.
  assert.match(
    dashboard,
    /user\.subscriptionPlan !== 'pro' && \([\s\S]{0,400}?Plan usage/,
    'the meter is not hidden on Pro'
  );
});

test('nothing on the dashboard offers a Pro user something Pro does not need', () => {
  // The meter has no cap to show and the upgrade button has nothing to sell, so
  // both hide at Pro. Measured: dropping either conditional left the suite
  // green.
  //
  // The upgrade button's half is UX, not security — `upgradeToProAction` now
  // refuses a Pro caller server-side (billing-redirect.test.ts). This is here
  // so nobody is offered a purchase that the server is about to reject, which
  // is a worse experience than a button that was never there.
  // The two blocks close at different indentation — the upgrade form is nested
// one level deeper in the header than the meter is — so the terminator is
// matched loosely. The window is generous because it has to span the longest of
// the two cards; a lazy `{0,400}?` silently matches nothing here, which is why
// the count assertion below exists rather than an assumed match.
const hidden = [...dashboard.matchAll(/\{user\.subscriptionPlan !== 'pro' && \(([\s\S]{0,1500}?)\n\s*\)\}/g)]
    .map((m) => m[1]);
  assert.ok(hidden.length >= 2, `expected the meter and the upgrade form to hide at Pro, found ${hidden.length}`);
  assert.ok(
    hidden.some((block) => block.includes('upgradeToProAction')),
    'the upgrade button is still offered to a Pro account'
  );
  assert.ok(
    hidden.some((block) => block.includes('Plan usage')),
    'the usage meter is still drawn on a Pro account'
  );
});

test('the filter narrows the list and never the counts', () => {
  const counted = dashboard.match(/const activeCount = ([^;]+);/)?.[1];
  const listed = dashboard.match(/\{visibleProjects\.map\(/);
  assert.ok(listed, 'the list no longer renders the filtered rows');

  // The dangerous direction. Counting the filtered rows would light the create
  // button back up mid-search — `atProjectLimit` is derived from activeCount,
  // and `createProjectAction` would refuse the click anyway, so the user gets
  // the "button that did nothing" the error banner in project-form.tsx exists to
  // stop. `validate.test.ts` and `project-ownership.test.ts` already pin the
  // unfiltered form of this expression; this asserts the counts are not computed
  // from `visibleProjects` a second time somewhere new.
  assert.ok(counted && !counted.includes('visibleProjects'), `activeCount reads ${counted}`);
  assert.match(dashboard, /const visibleProjects = needle/);

  // One read still. The filter is in memory precisely so this stays true.
  assert.equal(dashboard.split('db.query.projects.findMany').length - 1, 1);
});

/**
 * The status derivation, lifted out of the page and run.
 *
 * `page.tsx` is a server component that reads the database and pulls
 * next/navigation, so it cannot be imported here — the same reason every other
 * assertion in this file reads source. This one can do better than a regex,
 * because the derivation is a pure expression over `params`: the same trick
 * `billing-redirect.test.ts` uses on `redirectIfLocalOrigin`. The claim being
 * checked is about what an unrecognised value *does*, which a text match cannot
 * tell you — a ternary that ended in `''` instead of `'all'` reads identically.
 */
const statusOf = (params: unknown): string => {
  const at = dashboard.indexOf('const status =');
  assert.notEqual(at, -1, 'the status derivation is gone; this test needs revisiting');
  const expr = dashboard.slice(at).match(/const status =([\s\S]*?);/);
  assert.ok(expr, 'the status derivation no longer fits on one statement');
  // Parenthesised, because the lifted expression starts on its own line and a
  // bare `return` there is an automatic semicolon insertion: the function
  // returns `undefined` for every input and every assertion below is a
  // comparison of undefined against a string. It fails loudly, which is the one
  // saving grace — but it fails for the wrong reason.
  return new Function('params', `return (${expr[1]});`)(params);
};

test('an unrecognised status falls back to the full list, not to nothing', () => {
  // `?status=` is attacker-chosen exactly as `?q=` is, and it arrives as
  // `string | string[] | undefined`. Every value that is not one of the two
  // statuses has to read as 'all': narrowing to an empty list instead would
  // make a hand-edited URL — or one tab's stale href after a rename — render
  // "you have no projects" for an account with nine of them.
  for (const value of ['active', 'archived']) {
    assert.equal(statusOf({ status: value }), value, `${value} must be honoured`);
  }

  for (const value of ['all', '', 'ACTIVE', 'Archived', 'nonsense', 'active ', 0, 1, true]) {
    assert.equal(statusOf({ status: value }), 'all', `${JSON.stringify(value)} must not narrow the list`);
  }

  // Absent entirely — the ordinary case, and the one the page has to keep
  // behaving exactly as it did before this parameter existed.
  assert.equal(statusOf({}), 'all');
  assert.equal(statusOf({ q: 'alpha' }), 'all');

  // Repeated params arrive as an array. `['archived'] === 'archived'` is false,
  // so this reads as 'all' — which is the answer, and is worth pinning because
  // a `params.status?.includes(...)` rewrite would silently do something else.
  assert.equal(statusOf({ status: ['archived'] }), 'all');
  assert.equal(statusOf({ status: 'archived', q: 'x' }), 'archived');
});

test('the two filters compose: switching one keeps the other', () => {
  // `filterHref` lifted the same way. The claim is about the URL it produces,
  // and a regex over the body says nothing about whether `q` survives a status
  // switch — a version that rebuilt the query from `next` alone looks correct.
  const at = dashboard.indexOf('const filterHref =');
  assert.notEqual(at, -1, 'filterHref is gone; this test needs revisiting');
  const expr = dashboard.slice(at).match(/const filterHref =[\s\S]*?=> \{([\s\S]*?)\n\s{2}\};/);
  assert.ok(expr, 'filterHref no longer has the shape this lifts');
  const href = new Function('needle', 'q', 'next', `return (function (needle, q, next) {${expr[1]}})(needle, q, next);`) as (
    needle: string,
    q: string,
    next: string
  ) => string;

  // The search survives a tab change, in both directions.
  assert.equal(href('alpha', 'alpha', 'active'), '/dashboard?q=alpha&status=active');
  assert.equal(href('alpha', 'alpha', 'all'), '/dashboard?q=alpha', 'clearing status must keep the search');
  assert.equal(href('', '', 'archived'), '/dashboard?status=archived');
  assert.equal(href('', '', 'all'), '/dashboard', 'no filters at all is the bare page, not a query string');

  // And 'all' is *omitted* rather than sent. `?status=all` would be a second
  // spelling of the same view with two different URLs, so a bookmark and a link
  // would disagree while looking identical.
  assert.doesNotMatch(href('alpha', 'alpha', 'all'), /status=/);

  // The other half is the form. A GET form replaces the entire query string
  // with its own fields, so a search submitted while a status is active drops
  // it — there is a hidden input carrying it, and dropping that input is the
  // regression this cannot see from the href alone.
  assert.match(
    dashboard,
    /\{status !== 'all' && <input type="hidden" name="status" value=\{status\} \/>\}/,
    'typing in the search box resets the status filter, and the tab is the only thing that can set it again'
  );

  // The empty state's own escape clears BOTH, and says so. `filterHref('all')`
  // here would leave a search in place under a link reading "Clear the filter".
  const emptyState = dashboard.slice(dashboard.indexOf('Clear the filter') - 900);
  assert.match(emptyState, /href="\/dashboard"/, 'the clear link must reset both filters, not one');
});

test('the status tabs are navigation, and the current one says so', () => {
  // Counts come from the unfiltered array. A tab that changes size depending on
  // where you came from is a tab you stop trusting, and these three are the
  // same numbers the heading already prints.
  const tabs = dashboard.slice(
    dashboard.indexOf('const statusTabs ='),
    dashboard.indexOf('];', dashboard.indexOf('const statusTabs ='))
  );
  assert.ok(tabs.length > 0, 'the status tab list is gone');
  assert.doesNotMatch(tabs, /statusMatched|visibleProjects/, 'a tab count is computed from the filtered rows');
  for (const source of ['userProjects.length', 'activeCount', 'archivedCount']) {
    assert.ok(tabs.includes(source), `the ${source} tab count is not on the tab strip`);
  }

  // Links, not a button or a stateful control: `filterHref` is in the href, so
  // middle-click, cmd-click and "open in new tab" all work and the URL is
  // shareable. A `useState` tab strip has none of that and needs client JS.
  const strip = dashboard.slice(dashboard.indexOf('{statusTabs.map('));
  assert.match(strip.slice(0, 400), /href=\{filterHref\(tab\.key\)\}/, 'a tab is not a link carrying the other filter');
  assert.doesNotMatch(strip.slice(0, 400), /onClick|useState/, 'the tab strip is interactive without JS');

  // The current tab is marked, or the control reads as a row of unselected
  // options with no indication of where you are — including to a screen reader.
  assert.match(
    strip.slice(0, 400),
    /aria-current=\{status === tab\.key \? 'page' : undefined\}/,
    'the active tab is not marked'
  );
});

test('an empty list names which filter emptied it', () => {
  // "Nothing matches “q”." is the wrong sentence when the search was empty and
  // the user clicked Archived. It reads as a broken search box for a filter they
  // never used.
  const state = dashboard.slice(dashboard.indexOf(': visibleProjects.length === 0 ?'));
  assert.ok(state.includes('Clear the filter'), 'the filtering empty state is gone');

  const message = state.slice(0, state.indexOf('Clear the filter'));
  assert.match(message, /Nothing matches/, 'a search miss no longer says what missed');
  assert.match(
    message,
    /status === 'archived'\s*\?\s*'No archived projects\.\'\s*:\s*'No active projects\.'/,
    'an empty archive and an empty active list must not say the same thing'
  );
  // …and the search wording has to admit that a status may also be in play, or
  // "Nothing matches “alpha”." is a lie on the Archived tab.
  assert.match(message, /in \$\{status\} projects\./);

  // Still distinct from the blocking empty state: an account with zero projects
  // must be told to create one, not to clear a filter it does not have.
  const blocked = dashboard.slice(
    dashboard.indexOf('userProjects.length === 0 ?'),
    dashboard.indexOf(': visibleProjects.length === 0 ?')
  );
  assert.ok(blocked.includes('No projects created yet.'), 'the first-run empty state changed');
  assert.doesNotMatch(blocked, /Clear the filter/, 'the first-run state offers a filter to clear');
});

test('the filter is a GET form, not a client component', () => {
  // No `'use client'` in the page, no hydrated state, no search library. If a
  // future change makes this a client component it will need its own test — but
  // the point here is that the cheapest version is the one that shipped, and
  // this says so out loud.
  assert.doesNotMatch(dashboard, /^\s*'use client'/m);
  assert.match(dashboard, /<form method="get" action="\/dashboard"/);
  assert.match(dashboard, /name="q"/);
  assert.match(dashboard, /type="search"/);

  // Labelled, not placeholder-only: a placeholder vanishes the moment the box
  // has content, and this one is repopulated from the URL on every keystroke
  // turn. `defaultValue` keeps it server-rendered, which is what keeps the page
  // a server component.
  assert.match(dashboard, /aria-label="Filter projects/);
  assert.match(dashboard, /defaultValue=\{q\}/);
});
