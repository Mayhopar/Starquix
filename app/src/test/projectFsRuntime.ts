import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setLocalTransport, resetLocalTransportForTests } from '@/utils/sqLocalBase';
import { registerProjectFsRoutes, createChangeJournal } from '../../../preview-template/src/plugins/sq-project-fs-routes.js';

/** Real route table and temporary disk, without a socket or an instance. */
export function projectFsRuntime(projectId: string, initial: Record<string, string>, options: {
  beforeCommand?: () => Promise<void>; loseAcknowledgement?: () => boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sq-page-acceptance-'));
  for (const [file, source] of Object.entries(initial)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  let journal = createChangeJournal();
  type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  const routes = new Map<string, Handler>();
  const bind = () => {
    routes.clear();
    registerProjectFsRoutes({ middlewares: { use: (route: string, handler: Handler) => routes.set(route, handler) } } as never,
      { resolveRoot: () => root, sqComponentsDir: '', journal });
  };
  bind();
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async (url, init) => {
    const handler = routes.get(url.split('?')[0]);
    if (!handler) return new Response('missing route', { status: 404 });
    const command = url.split('?')[0] === '/__sq/local/source-command';
    if (command) await options.beforeCommand?.();
    const response = await new Promise<Response>((resolve, reject) => {
      const req = Readable.from(init?.body ? [init.body] : []) as IncomingMessage;
      Object.assign(req, { method: init?.method ?? 'GET', url, headers: {} });
      const headers: Record<string, string> = {};
      const res = { statusCode: 200,
        setHeader(key: string, value: string) { headers[key] = value; },
        writeHead(status: number, incoming: Record<string, string>) { this.statusCode = status; Object.assign(headers, incoming); },
        end(body?: string | Uint8Array) { resolve(new Response(typeof body === 'string' || body === undefined ? body : new Uint8Array(body), { status: this.statusCode, headers })); },
      };
      handler(req, res as unknown as ServerResponse, () => reject(new Error('No runtime handler')));
    });
    if (command && options.loseAcknowledgement?.()) throw new Error('ACK lost after the runtime write');
    return response;
  } });
  return { root, get journal() { return journal; }, read: (file: string) => readFileSync(join(root, file), 'utf8'),
    restart() { journal = createChangeJournal(); bind(); },
    close() { resetLocalTransportForTests(); rmSync(root, { recursive: true, force: true }); } };
}
