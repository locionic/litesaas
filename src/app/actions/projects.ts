'use server';

import { getCurrentUser } from '@/lib/auth';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

export async function createProjectAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const name = (formData.get('name') as string)?.trim();
  const description = (formData.get('description') as string)?.trim() || null;

  if (!name) {
    throw new Error('Project name is required');
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
