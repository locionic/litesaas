import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, toJson, filename, type ExportRow, type ExportAccount } from '../src/lib/export.ts';

// Run: npm test
//
// The only branchy logic in Phase 2, and it is branchy on purpose: every
// assertion here is a claim about what a *spreadsheet* does after this file
// leaves the app. Importing the real functions rather than reading the source is
// what makes them worth anything — a source regex cannot tell a quoted field
// from an unquoted one, and that is the entire difference below.
//
// The route that serves this is source-only, like every other route in the repo:
// it imports next/headers and the db and cannot be imported under `node --test`.

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  id: 'prj_abc123',
  name: 'Untitled',
  description: null,
  status: 'active',
  createdAt: new Date('2026-03-01T12:00:00.000Z'),
  updatedAt: new Date('2026-03-02T09:30:00.000Z'),
  ...over,
});

const account = (over: Partial<ExportAccount> = {}): ExportAccount => ({
  id: 'usr_abc123',
  email: 'ada@example.com',
  name: 'Ada',
  role: 'user',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
  plan: 'free',
  status: 'active',
  currentPeriodEnd: null,
  ...over,
});

/**
 * A minimal RFC 4180 reader — records, fields, and the doubled-quote escape.
 *
 * Test-only, and the reason the assertions below are worth making. Splitting
 * the output on `,` or `\n` cannot answer "did this survive as six columns",
 * because a comma *inside a quoted field* is not a separator — which is the
 * whole thing being tested. Asserting on the raw string would work but pins the
 * quoting style too, so a correct change to how a cell is written fails a test
 * about whether the cell survives.
 *
 * The `atStart` rule is the part that is easy to get wrong and was: a `"` opens
 * a field only as its **first** character. Treating every `"` as an opener
 * makes the reader repair malformed output instead of reporting it, which hides
 * the exact defect the guard-ordering test exists to find — `'"=SUM(A1,A2)"`,
 * with the escape written outside the quotes, parses cleanly under a lenient
 * reader and splits into seven columns under a real one.
 */
const records = (csv: string): string[][] => {
  const out: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c !== '"') {
        field += c;
      } else if (csv[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (c === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (c === ',') {
      record.push(field);
      field = '';
      atStart = true;
    } else if (c === '\n') {
      out.push([...record, field]);
      record = [];
      field = '';
      atStart = true;
    } else {
      field += c;
      atStart = false;
    }
  }
  if (field !== '' || record.length) out.push([...record, field]);
  return out;
};

/** One row as a reader sees it, with the header dropped. */
const cells = (rows: ExportRow[]) => records(toCsv(rows))[1];

test('the reader this file measures with is a real one', () => {
  // The reader above is a test helper, and a helper that is wrong makes every
  // assertion built on it vacuous rather than wrong. It was wrong once already:
  // treating any `"` as a field opener meant it silently repaired the
  // guard-ordering bug it existed to catch. Two checks so that cannot recur
  // quietly.
  assert.deepEqual(records('a,b\nc,d\n'), [
    ['a', 'b'],
    ['c', 'd'],
  ]);

  // A quote opens a field only as its first character. Written the other way,
  // `'"=SUM(A1,A2)"` parses as one tidy field; a spreadsheet splits it at the
  // comma into seven columns with the formula still live.
  assert.deepEqual(records(`"'=SUM(A1,A2)",b\n`), [[`'=SUM(A1,A2)`, 'b']]);
  assert.equal(records(`'"=SUM(A1,A2)",b\n`)[0].length, 3);

  // …and the doubled-quote escape is still honoured inside a quoted field.
  assert.deepEqual(records('"say ""hi""",b\n'), [['say "hi"', 'b']]);
});

test('the header names every column, and an empty export is still a valid file', () => {
  // A user who deletes everything and clicks Export gets a header and nothing
  // else. Zero bytes would fail to open; a header is what a spreadsheet expects
  // from an empty table, and what a re-import needs to create it.
  assert.equal(toCsv([]), 'id,name,description,status,created_at,updated_at\n');
  assert.equal(records(toCsv([row()]))[0].join(','), 'id,name,description,status,created_at,updated_at');
});

test('a row round-trips as the six columns it declares', () => {
  assert.deepEqual(cells([row({ name: 'Repurposer', description: 'Long video to shorts.' })]), [
    'prj_abc123',
    'Repurposer',
    'Long video to shorts.',
    'active',
    '2026-03-01T12:00:00.000Z',
    '2026-03-02T09:30:00.000Z',
  ]);
});

test('a null description is an empty cell, not the word null', () => {
  // `description ?? ''` rather than a template literal: `${null}` renders the
  // four characters "null" into a cell, where it sorts, filters and reads as
  // data the user typed — and description is null for every project created
  // without one, which is most of them.
  const [id, name, description] = cells([row({ description: null })]);
  assert.equal(description, '');
  assert.ok(!toCsv([row()]).includes('null'), 'the string "null" leaked into the export');
  assert.equal(id, 'prj_abc123');
  assert.equal(name, 'Untitled');
});

test('anything that would break the row shape survives as six columns', () => {
  // Each of these silently shifts every later column if written bare: Excel
  // splits on the comma, then on the newline, and the tail lands in the wrong
  // field with nothing in the file to say so.
  //
  // Written as `Partial` overrides rather than `[name, description]` pairs: a
  // pair with `null` for "leave this alone" overrides the spread with null
  // instead, and asserts that an empty cell comes back as null. Which it does
  // not, because there is no such thing as a null name — the column is NOT NULL.
  const HOSTILE: Partial<ExportRow>[] = [
    { name: 'Repurposer, v2' },
    { name: 'Say "hello"' },
    { name: 'Two\nlines' },
    { name: 'Carriage\rreturn' },
    { description: 'A description, with a comma' },
    { description: 'A "quoted" description' },
    { description: 'Line one\nline two' },
    { name: 'Both, at once"and\nmore', description: 'a,b"c\nd' },
  ];

  for (const over of HOSTILE) {
    const got = cells([row(over)]);
    assert.equal(
      got.length,
      6,
      `${JSON.stringify(over)} produced ${got.length} fields: ${JSON.stringify(got)}`
    );
    // And the value came back, not merely the right number of fields.
    assert.equal(got[1], FORMULA_LEAD.test(over.name ?? '') ? `'${over.name}` : over.name ?? 'Untitled');
    assert.equal(got[2], over.description ?? '');
  }
});

/** Mirrors the module's own rule, so the two have to agree about what is guarded. */
const FORMULA_LEAD = /^\s*[=+\-@]/;

test('a formula cannot execute when the file is opened', () => {
  // The reason this guard exists. A project name is user text and the file is
  // meant to be opened in a spreadsheet, so a name of `=cmd|'/c calc'!A0` runs
  // on open, in whatever machine the export reaches.
  //
  // RFC 4180 quoting does not save you here — a quoted cell beginning with `=`
  // is still a formula. The leading apostrophe is Excel's own escape and strips
  // on read, so the user gets their text back.
  //
  // The comma-bearing half is not decoration. Guarding *after* quoting is the
  // obvious refactor and it is wrong in a way nothing else here would notice:
  // it wraps the apostrophe OUTSIDE the quotes, so the cell opens with `'` and
  // a reader treats the rest as an unquoted field — which splits on the first
  // comma and both corrupts the row and leaves `=SUM(A1,A2)` live. Measured:
  // swapping the two lines in `cell()` left the suite green until this case
  // existed. `=1+1` alone cannot see it, because with no comma to quote, both
  // orderings emit byte-identical output.
  for (const name of [
    '=1+1',
    '+1+1',
    '-1+1',
    '@SUM(A1)',
    '=SUM(A1,A2)',
    '=HYPERLINK("http://evil.example","click"),also',
  ]) {
    const got = cells([row({ name })]);
    assert.equal(got.length, 6, `${name} did not survive as six fields: ${JSON.stringify(got)}`);
    assert.ok(got[1].startsWith("'"), `${name} is not guarded: ${got[1]}`);
    assert.equal(got[0], 'prj_abc123', 'the guard shifted the row');
  }
});

test('whitespace does not smuggle a formula past the guard', () => {
  // Excel trims leading whitespace before deciding a cell is a formula, so
  // guarding only the very first character leaves `   =1+1` live. A guard that
  // can be walked past by typing a space is worse than none, because it reads
  // as one.
  for (const pad of ['', ' ', '\t', '   ', ' \t ']) {
    const [, name] = cells([row({ name: `${pad}=1+1` })]);
    assert.ok(name.startsWith("'"), `a formula behind ${JSON.stringify(pad)} padding is live`);
  }
});

test('ordinary text is left exactly as the user typed it', () => {
  // The other half. A guard that prefixed everything would be correct and
  // useless — every export would carry a column of stray apostrophes.
  for (const name of ['Untitled', '2026 roadmap', 'café', 'a - b', 'x@y is an email', '50% done']) {
    const [, got] = cells([row({ name })]);
    assert.equal(got, name, `guarded a harmless value: ${name}`);
  }
});

test('a hostile row does not corrupt the row below it', () => {
  // Both guards meeting, on one row, which is where an ordering mistake in
  // either of them shows up.
  const [, first, second] = records(
    toCsv([
      row({ id: 'prj_1', name: '=cmd|calc', description: 'a,b"c\nd' }),
      row({ id: 'prj_2', name: 'Plain', description: null }),
    ])
  );

  assert.equal(first.length, 6, 'the hostile row did not survive as six fields');
  assert.deepEqual(second, [
    'prj_2',
    'Plain',
    '',
    'active',
    '2026-03-01T12:00:00.000Z',
    '2026-03-02T09:30:00.000Z',
  ]);
});

test('the file ends with a newline', () => {
  // POSIX text files do, and without one the final row runs into whatever gets
  // appended next — a second export concatenated, or an editor's cursor.
  assert.ok(toCsv([row()]).endsWith('\n'));
});

test('a filename sorts chronologically and is safe in a header', () => {
  // `:` is illegal in a filename on Windows and breaks the Content-Disposition
  // header it is interpolated into, so the ISO colons have to go.
  //
  // `litesaas-export-`, not `litesaas-projects-`: the JSON payload carries the
  // account as well as the projects now, and a file named for projects is the
  // kind of name a person forwards without opening.
  const name = filename('csv', new Date('2026-03-01T09:05:07.123Z'));
  assert.equal(name, 'litesaas-export-2026-03-01T090507Z.csv');
  assert.doesNotMatch(name, /[:\\<>"*?|]/, 'unsafe character in a download filename');
  assert.ok(filename('json').endsWith('.json'));

  // Sorts chronologically as text — which is the reason the dashes were kept
  // rather than stripped along with the colons.
  const earlier = filename('csv', new Date('2026-03-01T09:05:07.123Z'));
  const later = filename('csv', new Date('2026-11-30T23:59:59.999Z'));
  assert.ok(earlier < later, 'two exports of the same day do not sort by date');
});

test('the JSON export carries the account, and carries no credential', () => {
  const out = JSON.parse(
    toJson(
      account({ plan: 'pro', status: 'past_due' }),
      [row()],
      new Date('2026-03-01T09:05:07.123Z')
    )
  );

  assert.equal(out.exportedAt, '2026-03-01T09:05:07.123Z');
  assert.deepEqual(Object.keys(out).sort(), ['account', 'exportedAt', 'projects']);

  // The billing state, which is the half a restore script cannot reconstruct.
  // `past_due` is why this is the subscription row and not `user.plan` off the
  // session: an export that cannot distinguish active from past_due describes a
  // billing state the account is in and says nothing about.
  assert.equal(out.account.plan, 'pro');
  assert.equal(out.account.status, 'past_due');
  assert.equal(out.account.email, 'ada@example.com');
  assert.equal(out.account.id, 'usr_abc123');

  // Dates are strings, not `{}`. `JSON.stringify` renders a Date through its own
  // toJSON, so this holds by accident; `currentPeriodEnd` is the one that does
  // not, and it is nullable, so it is converted rather than left to the
  // serialiser.
  assert.equal(out.account.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(out.account.currentPeriodEnd, null);
  assert.equal(
    JSON.parse(toJson(account({ currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z') }), [])).account
      .currentPeriodEnd,
    '2026-04-01T00:00:00.000Z'
  );

  // The whole point of this file, and the reason `ExportAccount` declares its
  // fields instead of taking a row: `getCurrentUser` returns `{ ...user }` with
  // `passwordHash` attached, and this is the one output in the codebase that
  // exists to be sent to somebody else. A scrypt hash in a forwarded export is
  // a credential-cracking target with the user's name on it.
  assert.equal(
    'passwordHash' in out.account,
    false,
    'the password hash is in the export'
  );

  // Belt and braces: even if a future column is added to the type, the assertion
  // above is about the *output*, so it catches the key arriving by any route.
  assert.deepEqual(
    Object.keys(out.account).sort(),
    [
      'createdAt',
      'currentPeriodEnd',
      'email',
      'id',
      'name',
      'plan',
      'role',
      'status',
      'updatedAt',
    ],
    'the account payload gained or lost a field'
  );

  // Projects stay whole rows, hash-free, and the file still ends with a newline.
  assert.equal(out.projects.length, 1);
  assert.equal(out.projects[0].name, 'Untitled');
  assert.ok(toJson(account(), []).endsWith('\n'));
});

test('the CSV stays projects-only — an account row in a spreadsheet is noise', () => {
  // The split is deliberate rather than an omission: a CSV is read in a
  // spreadsheet, where one account row above the project rows becomes a second
  // header the reader has to know to skip. The JSON is the machine-readable
  // half; the CSV is the "open it in Excel" half.
  const csv = toCsv([row()]);
  assert.doesNotMatch(csv, /ada@example\.com/, 'the account leaks into the CSV');
  assert.equal(csv.split('\n')[0], 'id,name,description,status,created_at,updated_at');
});
