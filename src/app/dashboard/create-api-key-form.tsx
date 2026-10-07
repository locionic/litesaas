'use client';

import { useActionState, useState } from 'react';
import { createApiKeyAction, type ApiKeyState } from '@/app/actions/api-keys';
import { Key, Copy, Check, AlertCircle, ShieldAlert } from 'lucide-react';

export default function CreateApiKeyForm() {
  const [state, formAction, isPending] = useActionState<ApiKeyState | null, FormData>(
    createApiKeyAction,
    null
  );
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {state?.createdKey && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-emerald-300">
                API Key Generated: {state.createdKey.name}
              </h4>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Copy this key now. For security, it will{' '}
                <strong className="text-white">never be displayed again</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={state.createdKey.rawKey}
              autoComplete="off"
              className="w-full font-mono text-xs bg-zinc-950 border border-emerald-500/40 rounded-lg px-3 py-2 text-emerald-300 select-all focus:outline-none focus:outline-2 focus:outline-emerald-500"
            />
            <button
              type="button"
              onClick={() => handleCopy(state.createdKey!.rawKey)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 text-zinc-950 text-xs font-semibold hover:bg-emerald-400 transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 shrink-0"
              aria-label="Copy API key to clipboard"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <form action={formAction} className="space-y-3">
        {state?.error && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-400 flex items-center gap-2"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{state.error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 space-y-1">
            <label htmlFor="api-key-name" className="text-xs font-medium text-zinc-300">
              Key Name
            </label>
            <input
              id="api-key-name"
              name="name"
              type="text"
              required
              autoComplete="off"
              placeholder="e.g. CLI Script, Zapier, CI/CD"
              className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:outline-2 focus:outline-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="api-key-scopes" className="text-xs font-medium text-zinc-300">
              Permissions
            </label>
            <select
              id="api-key-scopes"
              name="scopes"
              autoComplete="off"
              className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:outline-2 focus:outline-emerald-500"
            >
              <option value="projects:read,projects:write">Full Access (Read &amp; Write)</option>
              <option value="projects:read">Read Only (projects:read)</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-zinc-800 border border-white/10 hover:border-emerald-500/30 text-zinc-200 hover:text-white text-xs font-semibold hover:bg-zinc-700 transition-all focus:outline-none focus:outline-2 focus:outline-emerald-500 disabled:opacity-50"
        >
          <Key className="h-3.5 w-3.5 text-emerald-400" />
          <span>{isPending ? 'Generating...' : 'Create Secret Key'}</span>
        </button>
      </form>
    </div>
  );
}
