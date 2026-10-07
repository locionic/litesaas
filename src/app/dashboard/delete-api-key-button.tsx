'use client';

import { Trash2 } from 'lucide-react';

export default function DeleteApiKeyButton({
  keyName,
}: {
  keyName: string;
}) {
  return (
    <button
      type="submit"
      className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors focus:outline-none focus:outline-2 focus:outline-red-500"
      title={`Revoke ${keyName}`}
      aria-label={`Revoke API key ${keyName}`}
      onClick={(e) => {
        if (
          !window.confirm(
            `Are you sure you want to revoke the API key "${keyName}"? Any external service using this key will immediately lose access.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
