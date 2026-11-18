/**
 * The /__sq/local/* transport contract the desktop driver installs over its
 * IPC sender.
 */
import type { LocalTransport } from '@/utils/sqLocalBase';
import { syncChangedFiles } from './filesTruthSync';

/** An explicit receipt endpoint proof, never inferred from HTTP status. */
export class LocalMutationNoWriteError extends Error {
  constructor(public readonly response: Response, message: string) { super(message); }
}
/** The /__sq/local/* transport contract over any sender: a refused write
 *  throws (typed when the instance proved no-write), a landed write pulls the
 *  journal into the mirror. Used by the desktop IPC transport. */
export function makeTransport(projectPath: string | undefined, send: (p: string, init?: RequestInit) => Promise<Response>): LocalTransport {
  return {
    projectPath,
    fetch(p, init) {
      const method = (init?.method ?? 'GET').toUpperCase();
      const mutation = method !== 'GET' && method !== 'HEAD';
      const request = (async () => {
        const r = await send(p, init);
        if (mutation) {
          if (!r.ok) {
            const detail = await r.clone().json().catch(() => ({})) as { error?: string };
            const message = `Writing project files failed (HTTP ${r.status})${detail.error ? `: ${detail.error}` : ''}`;
            if (r.headers.get('x-sq-mutation-outcome') === 'no-write') throw new LocalMutationNoWriteError(r, message);
            throw new Error(message);
          }
          // The write landed in the instance; the mirror pull keeps its own
          // cursor and retries itself (filesTruthSync), so the caller is done.
          // Drafts (.sq/drafts, every 300 ms while typing) are never journaled.
          if (!p.startsWith('/__sq/local/draft')) await syncChangedFiles().catch(() => {});
        }
        return r;
      })();
      return request;
    },
  };
}
