'use server';

import { getCurrentUser } from '@/lib/auth';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';
import { validateProject, formText, UserError } from '@/lib/validate';
import { projectLimitFor, FREE_PROJECT_LIMIT } from '@/lib/stripe';

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
    // Only the messages `create` wrote on purpose. Everything else reaching here
    // came out of the driver — a busy database, a closed file, a schema the
    // migration never applied — and its text is SQLite's: constraint names,
    // column lists, and on SQLITE_CANTOPEN the absolute path of the database
    // file. That is a description of the operator's disk, rendered in the form
    // for anyone who can make an insert fail.
    return {
      error:
        err instanceof UserError
          ? err.message
          : 'Could not create the project. Try again.',
    };
  }
}

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

async function create(user: User, formData: FormData): Promise<ProjectState> {
  const name = formText(formData, 'name');
  const description = formText(formData, 'description') || null;

  // The form's `required` is a client-side suggestion only; this is the
  // enforcement, and it is also what bounds a single row.
  const invalid = validateProject({ name, description });
  if (invalid) {
    throw new UserError(invalid);
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
    throw new UserError(
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

/**
 * Rename a project, or change its description.
 *
 * `projectId` comes first so `updateProjectAction.bind(null, id)` is the
 * `(prevState, formData) => state` shape `useActionState` needs — the same trick
 * `toggleProjectStatusAction` uses, and the reason this is not a second
 * action-shaped wrapper.
 *
 * The form posts to whatever URL it is on, so a rename made while the dashboard
 * filter is open keeps `?q=` across the round trip. That cuts both ways and
 * knowingly: rename a project out of the current search and its row leaves the
 * list, which is the filter doing its job rather than a lost save.
 */
export async function updateProjectAction(
  projectId: string,
  _prev: ProjectState | null,
  formData: FormData
): Promise<ProjectState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: 'Your session expired. Sign in again to make this change.' };
  }

  try {
    const name = formText(formData, 'name');
    const description = formText(formData, 'description') || null;

    // The same enforcement as create, reached the same way: the input's
    // `required` and `maxLength` are browser suggestions on a plain POST.
    const invalid = validateProject({ name, description });
    if (invalid) {
      throw new UserError(invalid);
    }

    await db
      .update(projects)
      // A fixed list of columns, not the form body spread into the update. A
      // server action is a plain POST, so anyone can add `status=active` to an
      // archived project's form and un-archive it, or send `userId=` and try to
      // move the row to an account they control. Naming the columns here is what
      // makes those two requests inert — the form decides the *values* of two
      // fields, and this line decides that they are the only two it decides.
      .set({ name, description, updatedAt: new Date() })
      // Owner scope in the WHERE clause, like every other write here — the
      // trust boundary, not a filter applied afterwards. Without it this is the
      // first action in the app that edits a row on an id alone.
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));

    revalidatePath('/dashboard');
    return {};
  } catch (err) {
    return {
      error:
        err instanceof UserError
          ? err.message
          : 'Could not save your changes. Try again.',
    };
  }
}
