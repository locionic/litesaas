import { getCurrentUser } from '@/lib/auth';
import { db } from '@/db';
import { projects, subscriptions } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import { toCsv, toJson, filename } from '@/lib/export';

/**
 * `GET /api/projects/export?format=json|csv` — the caller's projects as a file.
 *
 * A read, so no CSRF token: there is no state to change, and a forged GET
 * produces a file the attacker learns nothing from. Everything that can go
 * wrong here is the ownership scope, so that is the one thing done in SQL —
 * `eq(projects.userId, user.id)` in the WHERE, not a filter applied to rows
 * already loaded. Every other read of this table is scoped the same way.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const rows = await db.query.projects.findMany({
    where: eq(projects.userId, user.id),
    orderBy: [asc(projects.createdAt)],
  });

  // The subscription row, for the export to carry the caller's plan and status.
  // Read here rather than taken off `user.subscriptionPlan` because that is the
  // *plan* only — an export that omits `past_due` alongside `active` describes a
  // billing state the account is in and the file says nothing about.
  //
  // A row is missing only if the account was created before signup wrote one, so
  // the `??` is a default and not a swallow: `getCurrentUser` reads the same row
  // the same way.
  const sub =
    (await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, user.id) })) ?? null;

  // Anything other than an explicit `csv` is JSON. A file download is opened by
  // the browser, not by a parser, so a format this route does not recognise has
  // to come back as something readable rather than as an error page.
  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';

  const body =
    format === 'csv'
      ? toCsv(rows)
      : toJson(
          {
            // Field by field, never `...user`. `getCurrentUser` returns the whole
            // row and `user` still carries `passwordHash`; a spread here puts a
            // scrypt hash in a file whose stated purpose is to be sent to
            // somebody else. `ExportAccount` does not declare that key, so this
            // cannot be assembled by accident.
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            plan: sub?.plan ?? 'free',
            status: sub?.status ?? 'active',
            currentPeriodEnd: sub?.currentPeriodEnd ?? null,
          },
          rows
        );

  return new Response(body, {
    headers: {
      'content-type': `${format === 'csv' ? 'text/csv' : 'application/json'}; charset=utf-8`,
      // `attachment` so the browser saves it instead of rendering the JSON as a
      // page — an array of the caller's rows displayed inline is a convincing
      // phishing surface at a URL on your own origin.
      'content-disposition': `attachment; filename="${filename(format)}"`,
      // Project names and descriptions are the caller's own text; a shared cache
      // must never hand them to the next person through.
      'cache-control': 'private, no-store',
    },
  });
}
