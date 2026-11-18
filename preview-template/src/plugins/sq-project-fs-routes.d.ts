// Type surface for sq-project-fs-routes.js (the /__sq/local/* route table).
import type { IncomingMessage } from 'node:http';
import type { ViteDevServer } from 'vite';

export interface ChangeJournal {
  record(file: string, kind?: 'change' | 'unlink'): void;
  since(seq: number): { seq: number; entries: Array<{ seq: number; file: string; kind: 'change' | 'unlink' }> };
}
export function createChangeJournal(): ChangeJournal;
export interface ProjectFsRouteOptions {
  /** Files-truth write-through journal (shared with the plugin's performWrite). */
  journal?: ChangeJournal;
  /** Project root for a request ('' = unknown → the route answers 400). */
  resolveRoot(req: IncomingMessage, body?: unknown): string;
  /** Where OUR insertable component templates (Media.astro…) live. */
  sqComponentsDir: string;
  /** Served origin for public uploads (host: the spawned instance's url). */
  instanceUrl?(dir: string): string | null | undefined;
  notifyWs?(event: 'sq:components-changed' | 'sq:layouts-changed' | 'sq:pages-changed' | 'sq:content-changed'): void;
  readJsonBody?(req: IncomingMessage): Promise<unknown>;
  /** Project-relative files a route just wrote — told to Vite's watcher at once (sq-source-plugin announceWrites). */
  announce?(files: string[]): void;
}
export function readJsonBody(req: IncomingMessage): Promise<unknown>;
export function registerProjectFsRoutes(server: Pick<ViteDevServer, 'middlewares'>, opts: ProjectFsRouteOptions): void;
export function rootFromRequest(req: IncomingMessage, body?: unknown): string;
