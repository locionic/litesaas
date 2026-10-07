import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/db';
import { projects, subscriptions } from '@/db/schema';
import { eq, and, desc, sql, like, or } from 'drizzle-orm';
import { extractApiKeyFromHeaders, verifyApiKey } from '@/lib/api-keys';
import { validateProject, MAX_NAME, MAX_DESCRIPTION } from '@/lib/validate';
import { projectLimitFor, FREE_PROJECT_LIMIT } from '@/lib/stripe';

/**
 * GET /api/v1/projects
 * List user's projects with filtering, search, and pagination.
 * Required Scope: projects:read
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const apiKey = extractApiKeyFromHeaders(request.headers);
  const auth = await verifyApiKey(apiKey, 'projects:read');

  if (!auth.valid) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      {
        status: auth.status,
        headers: auth.retryAfter ? { 'Retry-After': String(auth.retryAfter) } : undefined,
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');
  const q = searchParams.get('q')?.trim() || '';

  const pageLimit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  // Status filter: 'all' | 'active' | 'archived'
  const statusFilter =
    statusParam === 'active' ? 'active' : statusParam === 'archived' ? 'archived' : 'all';

  // Build conditions
  const conditions = [eq(projects.userId, auth.user.id)];

  if (statusFilter !== 'all') {
    conditions.push(eq(projects.status, statusFilter));
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(like(projects.name, pattern), like(projects.description, pattern))!
    );
  }

  const whereClause = and(...conditions);

  // Count total matching
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(projects)
    .where(whereClause);

  // Fetch paginated projects
  const items = await db.query.projects.findMany({
    where: whereClause,
    orderBy: [desc(projects.createdAt)],
    limit: pageLimit,
    offset,
  });

  return NextResponse.json({
    ok: true,
    data: items,
    pagination: {
      total: Number(total),
      limit: pageLimit,
      offset,
    },
  });
}

/**
 * POST /api/v1/projects
 * Create a new project for the authenticated user.
 * Required Scope: projects:write
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = extractApiKeyFromHeaders(request.headers);
  const auth = await verifyApiKey(apiKey, 'projects:write');

  if (!auth.valid) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      {
        status: auth.status,
        headers: auth.retryAfter ? { 'Retry-After': String(auth.retryAfter) } : undefined,
      }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON payload.' },
      { status: 400 }
    );
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description =
    typeof body?.description === 'string' ? body.description.trim() || null : null;
  const status = body?.status === 'archived' ? 'archived' : 'active';

  const invalid = validateProject({ name, description });
  if (invalid) {
    return NextResponse.json({ ok: false, error: invalid }, { status: 400 });
  }

  // Check plan limits for active projects
  if (status === 'active') {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, auth.user.id),
    });
    const plan = sub?.plan || 'free';

    const [{ active }] = await db
      .select({ active: sql<number>`count(*)` })
      .from(projects)
      .where(and(eq(projects.userId, auth.user.id), eq(projects.status, 'active')));

    if (Number(active) >= projectLimitFor(plan)) {
      return NextResponse.json(
        {
          ok: false,
          error: `The free plan includes ${FREE_PROJECT_LIMIT} active projects. Archive one to make room, or upgrade to Pro.`,
        },
        { status: 403 }
      );
    }
  }

  const projectId = `prj_${crypto.randomBytes(12).toString('hex')}`;
  const now = new Date();

  await db.insert(projects).values({
    id: projectId,
    userId: auth.user.id,
    name,
    description,
    status,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
