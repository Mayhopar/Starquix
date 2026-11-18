/**
 * Mock ViteDevServer + req/res helpers for exercising sqSourcePlugin's
 * configureServer endpoints without a real Vite server.
 */
import { vi } from 'vitest';
import { Readable } from 'stream';
import type { ServerResponse, IncomingMessage } from 'http';
import { sqSourcePlugin } from '../../index';
import * as path from 'node:path';
import { registerProjectFsRoutes, rootFromRequest, readJsonBody } from '../../../../../preview-template/src/plugins/sq-project-fs-routes.js';

export interface MockServer {
  middlewares: { use: ReturnType<typeof vi.fn> };
  ws: { on: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
  watcher: { add: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
}

export function makeMockServer(): MockServer {
  return {
    middlewares: { use: vi.fn() },
    ws: { on: vi.fn(), send: vi.fn() },
    watcher: { add: vi.fn(), on: vi.fn() },
  };
}

/**
 * Instantiate the plugin against a (temp-dir) project root and run
 * configureServer with a mock server. Returns the mock for handler recovery.
 * The startup snapshot-reconciliation IIFE is inert for roots without a
 * sibling preview-template/ (maxSourceMtimeMs → null → not stale).
 */
export function configureMockServer(projectRoot: string): MockServer {
  const plugin = sqSourcePlugin({ root: projectRoot });
  (plugin.configResolved as unknown as (config: { root: string; command: string }) => void)(
    { root: projectRoot, command: 'serve' },
  );
  const server = makeMockServer();
  (plugin.configureServer as unknown as (s: MockServer) => void)(server);
  // The /__sq/local/* route table is served INSIDE a files-truth instance, not
  // by the app host (the host-folder disk was removed 2026-09-10). Tests still
  // exercise the table against a temp dir, so mount it here exactly as the
  // in-instance plugin does: root from the request, ws notifications on the
  // mock server.
  // Its param is typed from preview-template's own vite (a newer major than the app's): take the type from it.
  registerProjectFsRoutes(server as unknown as Parameters<typeof registerProjectFsRoutes>[0], {
    resolveRoot: rootFromRequest,
    readJsonBody,
    notifyWs: (event) => { (server.ws.send as unknown as (m: unknown) => void)({ type: 'custom', event, data: {} }); },
    sqComponentsDir: path.join(projectRoot, '..', 'preview-template', 'src', 'components'),
    instanceUrl: () => null,
  });
  return server;
}

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void> | void;

/** Find the Nth middleware registered for a route (order matters for duplicates). */
export function findRouteHandler(server: MockServer, route: string, nth = 0): Middleware {
  const calls = server.middlewares.use.mock.calls.filter(c => c[0] === route);
  if (!calls[nth]) throw new Error(`No middleware #${nth} registered for ${route}`);
  return calls[nth][1] as Middleware;
}

/** Find a WS handler by event name. */
export function findWsHandler(server: MockServer, event: string): (data: unknown) => Promise<void> | void {
  const call = server.ws.on.mock.calls.find(c => c[0] === event);
  if (!call) throw new Error(`No ws handler registered for ${event}`);
  return call[1] as (data: unknown) => Promise<void> | void;
}

export function makeJsonRequest(method: string, body?: unknown, url = '/'): IncomingMessage {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as unknown as IncomingMessage;
  req.method = method;
  req.url = url;
  return req;
}

export interface CapturedResponse {
  res: ServerResponse;
  status: () => number | undefined;
  body: () => string;
  json: () => unknown;
  /** Resolves when res.end() is called. */
  done: Promise<void>;
}

export function makeCapturedResponse(): CapturedResponse {
  let statusCode: number | undefined;
  let payload = '';
  let resolveDone: () => void;
  const done = new Promise<void>(resolve => { resolveDone = resolve; });
  const res = {
    setHeader: vi.fn(),
    writeHead: vi.fn((code: number) => { statusCode = code; }),
    set statusCode(code: number) { statusCode = code; },
    get statusCode() { return statusCode ?? 200; },
    end: vi.fn((chunk?: string) => {
      if (chunk) payload += chunk;
      resolveDone();
    }),
  } as unknown as ServerResponse;
  return {
    res,
    status: () => statusCode,
    body: () => payload,
    json: () => JSON.parse(payload),
    done,
  };
}
