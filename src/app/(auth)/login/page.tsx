import { isDemoEnabled } from '@/lib/demo';
import type { Metadata } from 'next';
import LoginForm from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Server wrapper so the demo banner is driven by the same predicate that
 * decides whether the account is seeded. The form itself is a client component;
 * a client component cannot read the environment, which is exactly how the
 * banner came to promise an account the server had refused to create.
 */
export default function LoginPage() {
  return <LoginForm demoEnabled={isDemoEnabled(process.env)} />;
}