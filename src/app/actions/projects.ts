'use server';

import { getCurrentUser } from '@/lib/auth';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';
import { validateProject } from '@/lib/validate';
import { projectLimitFor, FREE_PROJECT_LIMIT } from '@/lib/stripe';

/**
 * Read a text field. A server action accepts multipart/form-data, so a client
 * can send any field as a File part — `formData.get('name') as string` would be
 * a lie and `File.prototype.trim` does not exist, which 500s the action. A
 * non-string part is simply absent as far as this form is concerned.
 */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export type ProjectState = { error?: string };

/**
 * Returns `{ error }` rather than throwing. A thrown error in a server action
 * bound straight to `<form action={...}>` reaches no error boundary: the page
 * re-renders unchanged and the user sees a button that did nothing. Validation
 * failures and the plan cap are ordinary outcomes, not crashes, so they are
 * returned as state and rendered by the form.
 */
export async function createProjectAction(
  _prev: ProjectState | null,
  formData: FormData
): Promise<ProjectState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: 'Your session expired. Sign in again to create a project.' };
  }

  try {
    return await create(user, formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create the project. Try again.' };
  }
}

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

async function create(user: User, formData: FormData): Promise<ProjectState> {
  const name = text(formData, 'name');
  const description = text(formData, 'description') || null;

  // The form's `required` is a client-side suggestion only; this is the
  // enforcement, and it is also what bounds a single row.
  const invalid = validateProject({ name, description });
  if (invalid) {
    throw new Error(invalid);
  }

  // The pricing table promises Free "Up to 3 active projects" and Pro
  // "Unlimited". Counting in SQL rather than loading the rows keeps this to a
  // single scan, and the CREATE lands after the count, so two concurrent
  // creates can exceed the cap by one — the alternative is a transaction per
  // signup-shaped action, which SQLite serialises against every other writer.
  const [{ active }] = await db
    .select({ active: sql<number>`count(*)` })
    .from(projects)
    .where(and(eq(projects.userId, user.id), eq(projects.status, 'active')));

  if (Number(active) >= projectLimitFor(user.subscriptionPlan)) {
    throw new Error(
      `The free plan includes ${FREE_PROJECT_LIMIT} active projects. Archive one to make room, or upgrade to Pro.`
    );
  }

  const projectId = `prj_${crypto.randomBytes(12).toString('hex')}`;

  await db.insert(projects).values({
    id: projectId,
    userId: user.id,
    name,
    description,
    status: 'active',
  });

  revalidatePath('/dashboard');
  return {};
}

export async function deleteProjectAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  await db.delete(projects).where(
    and(
      eq(projects.id, projectId),
      eq(projects.userId, user.id)
    )
  );

  revalidatePath('/dashboard');
}

/**
 * Flip a project between 'active' and 'archived'. Scoped to the caller, so one
 * user can never archive another's project.
 *
 * The flip happens inside the UPDATE rather than in JS. Reading the row first
 * and then writing the inverse is a lost update: two rapid clicks (or a script)
 * both read 'active', both write 'archived', and an even number of concurrent
 * requests nets to archived no matter what the user asked for. Letting SQLite
 * compute it makes each statement self-consistent, and it also makes the
 * existence check unnecessary — the WHERE clause is already owner-scoped.
 */
export async function toggleProjectStatusAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  await db
    .update(projects)
    .set({
      status: sql`case when ${projects.status} = 'archived' then 'active' else 'archived' end`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.userId, user.id)
      )
    );

  revalidatePath('/dashboard');
}
