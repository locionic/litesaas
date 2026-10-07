import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { projects, subscriptions } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { extractApiKeyFromHeaders, verifyApiKey } from '@/lib/api-keys';
import { MAX_NAME, MAX_DESCRIPTION } from '@/lib/validate';
import { projectLimitFor, FREE_PROJECT_LIMIT } from '@/lib/stripe';

/**
 * GET /api/v1/projects/[id]
 * Retrieve a specific project by id.
 * Required Scope: projects:read
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
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

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, auth.user.id)),
  });

  if (!project) {
    return NextResponse.json(
      { ok: false, error: 'Project not found.' },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, data: project });
}

/**
 * PATCH /api/v1/projects/[id]
 * Update project name, description, or status.
 * Required Scope: projects:write
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
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

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, auth.user.id)),
  });

  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Project not found.' },
      { status: 404 }
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

  const updates: Partial<{
    name: string;
    description: string | null;
    status: 'active' | 'archived';
    updatedAt: Date;
  }> = {};

  if (body?.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { ok: false, error: 'Project name cannot be empty.' },
        { status: 400 }
      );
    }
    if (name.length > MAX_NAME) {
      return NextResponse.json(
        { ok: false, error: `Name must be ${MAX_NAME} characters or fewer.` },
        { status: 400 }
      );
    }
    updates.name = name;
  }

  if (body?.description !== undefined) {
    const description =
      typeof body.description === 'string' ? body.description.trim() || null : null;
    if (description && description.length > MAX_DESCRIPTION) {
      return NextResponse.json(
        { ok: false, error: `Description must be ${MAX_DESCRIPTION} characters or fewer.` },
        { status: 400 }
      );
    }
    updates.description = description;
  }

  if (body?.status !== undefined) {
    const status = body.status === 'archived' ? 'archived' : body.status === 'active' ? 'active' : null;
    if (!status) {
      return NextResponse.json(
        { ok: false, error: "Status must be either 'active' or 'archived'." },
        { status: 400 }
      );
    }

    // If restoring an archived project to active, check plan limits
    if (existing.status === 'archived' && status === 'active') {
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
            error: `The free plan includes ${FREE_PROJECT_LIMIT} active projects. Upgrade to Pro to activate more.`,
          },
          { status: 403 }
        );
      }
    }

    updates.status = status;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: 'No valid fields provided to update.' },
      { status: 400 }
    );
  }

  updates.updatedAt = new Date();

  await db
    .update(projects)
    .set(updates)
    .where(and(eq(projects.id, id), eq(projects.userId, auth.user.id)));

  const updated = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, auth.user.id)),
  });

  return NextResponse.json({ ok: true, data: updated });
}

/**
 * DELETE /api/v1/projects/[id]
 * Delete project by id.
 * Required Scope: projects:write
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
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

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, auth.user.id)),
  });

  if (!existing) {
    return NextResponse.json(
      { ok: false, error: 'Project not found.' },
      { status: 404 }
    );
  }

  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, auth.user.id)));

  return NextResponse.json({
    ok: true,
    message: 'Project deleted successfully.',
  });
}
