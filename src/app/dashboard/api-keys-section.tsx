import { Key, Code2, ShieldCheck, Terminal } from 'lucide-react';
import type { ApiKey } from '@/db/schema';
import CreateApiKeyForm from './create-api-key-form';
import DeleteApiKeyButton from './delete-api-key-button';
import { deleteApiKeyAction } from '@/app/actions/api-keys';
import { formatDate } from '@/lib/utils';
import LocalDate from './local-date';

export default function ApiKeysSection({ apiKeys }: { apiKeys: ApiKey[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#121217]">
      <details className="group/apikeys">
        <summary className="cursor-pointer list-none px-6 py-4 flex items-center justify-between text-xs font-semibold text-zinc-300 hover:text-white transition-colors [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-2.5">
            <Key className="h-4 w-4 text-emerald-400" />
            <span>Developer REST API &amp; Keys</span>
            <span className="text-[10px] font-mono text-zinc-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
              {apiKeys.length} {apiKeys.length === 1 ? 'active key' : 'active keys'}
            </span>
          </div>
          <span className="text-zinc-500 group-open/apikeys:rotate-180 transition-transform">
            ▼
          </span>
        </summary>

        <div className="px-6 pb-6 pt-2 space-y-6 border-t border-white/5">
          <div className="space-y-1">
            <p className="text-xs text-zinc-400 leading-relaxed">
              Generate secret API keys to programmatically manage your projects via the REST API.
              All requests are scoped to your account and rate-limited to 60 requests/minute.
            </p>
          </div>

          {/* Key creation form */}
          <div className="p-4 rounded-xl border border-white/5 bg-zinc-950/50">
            <h3 className="text-xs font-semibold text-white mb-3 flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Generate New API Key
            </h3>
            <CreateApiKeyForm />
          </div>

          {/* Active keys list */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-zinc-300">Active API Keys</h3>

            {apiKeys.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-zinc-500">
                No API keys created yet. Generate one above to access the REST API.
              </div>
            ) : (
              <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-zinc-950/40 overflow-hidden">
                {apiKeys.map((k) => (
                  <div
                    key={k.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white">{k.name}</span>
                        <code className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          {k.keyPrefix}
                        </code>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                        <span className="bg-zinc-800/80 text-zinc-300 px-2 py-0.5 rounded text-[10px] font-mono">
                          {k.scopes}
                        </span>
                        <span>•</span>
                        <span>
                          Created:{' '}
                          <LocalDate
                            iso={k.createdAt.toISOString()}
                            serverText={formatDate(k.createdAt)}
                          />
                        </span>
                        <span>•</span>
                        <span>
                          Last used:{' '}
                          {k.lastUsedAt ? (
                            <LocalDate
                              iso={k.lastUsedAt.toISOString()}
                              serverText={formatDate(k.lastUsedAt)}
                            />
                          ) : (
                            'Never'
                          )}
                        </span>
                      </div>
                    </div>

                    <form action={deleteApiKeyAction.bind(null, k.id)}>
                      <DeleteApiKeyButton keyName={k.name} />
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* REST API quickstart guide */}
          <div className="rounded-xl border border-white/5 bg-[#0d0d10] p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <Terminal className="h-3.5 w-3.5 text-emerald-400" />
              <span>cURL Quickstart</span>
            </div>
            <pre className="font-mono text-[11px] text-zinc-300 overflow-x-auto p-3 rounded-lg bg-zinc-950 border border-white/5 leading-relaxed">
              <code>
                <span className="text-zinc-500"># 1. List projects</span>{'\n'}
                curl -H <span className="text-emerald-300">&quot;Authorization: Bearer lsk_live_...&quot;</span>{'\n'}     https://your-domain.com/api/v1/projects{'\n\n'}
                <span className="text-zinc-500"># 2. Create a project</span>{'\n'}
                curl -X POST -H <span className="text-emerald-300">&quot;Authorization: Bearer lsk_live_...&quot;</span>{'\n'}     -H <span className="text-emerald-300">&quot;Content-Type: application/json&quot;</span>{'\n'}     -d <span className="text-emerald-300">&apos;&#123;&quot;name&quot;: &quot;My API Project&quot;, &quot;description&quot;: &quot;Created via REST API&quot;&#125;&apos;</span>{'\n'}     https://your-domain.com/api/v1/projects
              </code>
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}
