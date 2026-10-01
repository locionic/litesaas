import type { Metadata } from 'next';

/**
 * The title for the whole auth group.
 *
 * register/page.tsx is `'use client'`, and a client component cannot export
 * `metadata` — so this is the one place a title can come from for the pages
 * that have no server component of their own. A page that does have one
 * overrides it, which is why /login says "Sign in" rather than the title below.
 *
 * The template is repeated deliberately. A layout that sets `title` as a plain
 * string takes over from its parent's template, and its children lose it too —
 * with `title: 'Sign in'` here /login rendered as bare "Sign in" while
 * /register still got " · LiteSaaS" from the root layout. Keep this in step
 * with the one in src/app/layout.tsx.
 *
 * If you add a third page to this group, give it a server wrapper like
 * login/page.tsx has and set its own title, or it inherits this one.
 */
export const metadata: Metadata = {
  title: { default: 'Create account', template: '%s · LiteSaaS' },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}