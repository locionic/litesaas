'use server';

import crypto from 'crypto';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { formText, UserError, MAX_NAME } from '@/lib/validate';
import { generateApiKey } from '@/lib/api-keys';

export type ApiKeyState = {
  error?: string;
  createdKey?: {
    rawKey: string;
    keyPrefix: string;
    name: string;
  };
};

/**
 * Creates a new API key for the authenticated user.
 * Returns the raw secret key ONCE in state so the user can copy it.
 */
export async function createApiKeyAction(
  _prev: ApiKeyState | null,
  formData: FormData
): Promise<ApiKeyState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: 'Your session expired. Sign in again to create an API key.' };
  }

  try {
    const name = formText(formData, 'name');
    if (!name) {
      throw new UserError('API key name is required.');
    }
    if (name.length > MAX_NAME) {
      throw new UserError(`Name must be ${MAX_NAME} characters or fewer.`);
    }

    const rawScopes = formText(formData, 'scopes');
    const scopes = rawScopes || 'projects:read,projects:write';

    const { rawKey, keyPrefix, keyHash } = generateApiKey();
    const keyId = `key_${crypto.randomBytes(12).toString('hex')}`;

    await db.insert(apiKeys).values({
      id: keyId,
      userId: user.id,
      name,
      keyPrefix,
      keyHash,
      scopes,
    });

    revalidatePath('/dashboard');

    return {
      createdKey: {
        rawKey,
        keyPrefix,
        name,
      },
    };
  } catch (err) {
    return {
      error:
        err instanceof UserError
          ? err.message
          : 'Could not create API key. Try again.',
    };
  }
}

/**
 * Revokes / deletes an API key owned by the authenticated user.
 */
export async function deleteApiKeyAction(keyId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  await db.delete(apiKeys).where(
    and(
      eq(apiKeys.id, keyId),
      eq(apiKeys.userId, user.id)
    )
  );

  revalidatePath('/dashboard');
}
