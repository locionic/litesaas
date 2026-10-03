/**
 * CSV/JSON rendering of a caller's projects and account.
 *
 * Pure on purpose. The route that serves this imports `next/headers` and the
 * db and therefore cannot be imported under `node --test`; everything that can
 * go wrong in a spreadsheet lives here instead, where it is reachable by the
 * suite. The route is left as plumbing: scope, headers, nothing to get wrong.
 */

export type ExportRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The account half of the export.
 *
 * Every field is declared, and the user row's `passwordHash` is *not among
 * them*. That is the whole defence, and it is a type-level one: the caller has
 * to build this object, so there is no spread of the row it read and nothing to
 * forget to strip. `getCurrentUser` hands back `{ ...user }` with the hash
 * attached, so a `{ ...user }` here would export a scrypt hash into a file whose
 * entire purpose is to be emailed to somebody else — the one output in this
 * codebase that leaves the operator's machine by design.
 */
export type ExportAccount = {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
  plan: string;
  status: string;
  currentPeriodEnd: Date | null;
};

/**
 * Leading characters a spreadsheet reads as "this cell is a formula".
 *
 * A project name is user text and this file is meant to be opened in Excel, so
 * a name of `=cmd|'/c calc'!A0` executes the moment the export is double-clicked
 * — in whatever machine the file reaches. Every cell is quoted per RFC 4180,
 * but quoting does *not* help: a quoted formula is still a formula.
 *
 * The apostrophe is what Excel itself writes when you type one of these, and it
 * strips on read, so the round trip is lossless for the user. It is applied
 * before quoting rather than after so a value that is both dangerous and
 * comma-bearing (`=SUM(A1,A2)`) gets both treatments.
 *
 * The `\s*` is not decoration. Excel trims leading whitespace before deciding
 * whether a cell is a formula, so guarding only on the first character leaves
 * `   =1+1` live — and a guard that can be walked past by typing a space is
 * worse than no guard, because it reads as one.
 */
const FORMULA_LEAD = /^\s*[=+\-@]/;

/** RFC 4180: quote the field, and double any quote inside it. */
function cell(value: string): string {
  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * Six columns, fixed order, derived from the row rather than from a header row
 * of `Object.keys` — so a column cannot appear or vanish because a field was
 * added to the schema, and a re-import has a stable shape.
 *
 * `userId` is deliberately absent. It is the caller's own id and carries no
 * information they lack, and a CSV is read by a spreadsheet, not by a restore
 * script — the JSON export is the one for that, and it returns whole rows.
 */
export function toCsv(rows: ExportRow[]): string {
  const lines = [
    'id,name,description,status,created_at,updated_at',
    ...rows.map((row) =>
      [
        row.id,
        row.name,
        row.description ?? '',
        row.status,
        row.createdAt.toISOString(),
        row.updatedAt.toISOString(),
      ]
        .map(cell)
        .join(',')
    ),
  ];
  // Trailing newline: POSIX text files end in one, and without it the last row
  // runs into whatever gets appended to the file next.
  return `${lines.join('\n')}\n`;
}

/**
 * `litesaas-export-2026-03-01T090507Z.csv`.
 *
 * ISO 8601 with the colons stripped: they are illegal in a filename on Windows
 * and they break the `Content-Disposition` header this is interpolated into,
 * but the dashes and the `T` cost nothing and keep the stamps sorting
 * lexicographically, so a folder of exports reads in date order.
 *
 * No longer `litesaas-projects-`: the JSON payload now carries the account too,
 * and a file named for projects that also contains the account is the kind of
 * filename that gets forwarded without being opened.
 */
export function filename(ext: 'json' | 'csv', now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/:/g, '').replace(/\.\d+Z$/, 'Z');
  return `litesaas-export-${stamp}.${ext}`;
}

/**
 * The whole account, as one JSON document.
 *
 * An object rather than the bare array this returned before, because the point
 * of the file is that it is complete enough to leave with: a restore script
 * needs the subscription state alongside the projects, or a re-seeded instance
 * comes back as a Pro account with three projects and no record of why.
 *
 * Dates become ISO strings. `JSON.stringify` renders a `Date` through its own
 * `toJSON`, which is ISO — but `null` stays `null` and `undefined` would become
 * a key with no value, so the three that are nullable are converted here rather
 * than left to the serialiser.
 */
export function toJson(account: ExportAccount, projects: ExportRow[], now: Date = new Date()): string {
  return `${JSON.stringify(
    {
      exportedAt: now.toISOString(),
      account: {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
        plan: account.plan,
        status: account.status,
        currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      },
      // Whole rows, `userId` included: JSON is what a restore script reads, and
      // re-seeding another instance wants the owner's id back.
      projects,
    },
    null,
    2
  )}\n`;
}