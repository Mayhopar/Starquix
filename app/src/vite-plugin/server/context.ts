/**
 * SqServerContext — the explicit dependency surface of the /__sq/* endpoint
 * modules extracted from vite-plugin/index.ts configureServer
 * (docs/archive/plans/2026-06-10-godfile-decomposition-design.md §4.2).
 *
 * Transport helpers (readJsonBody, sendWsResult, sendHttpResult, notifyWs)
 * live here — they only need the server. Helpers entangled with plugin state
 * (executeFileWrite, queueFileWrite, suppressHmrFor, resolveComponentPath,
 * resolveFilePath, formatError) stay defined in index.ts and are passed IN
 * via deps, so there is exactly one copy of each.
 */
import type { ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

export interface SqServerContext {
  server: ViteDevServer;
  projectRoot: string;
  // --- write pipeline (owned by index.ts, shared with handleHotUpdate) ---
  executeFileWrite(filePath: string, transform: (content: string) => Promise<string>): Promise<void>;
  queueFileWrite<T>(filePath: string, operation: () => Promise<T>): Promise<T>;
  suppressHmrFor(filePath: string): void;
  // --- transport helpers ---
  readJsonBody(req: IncomingMessage): Promise<unknown>;
  sendWsResult(event: string, requestId: string, success: boolean, error?: unknown): void;
  sendHttpResult(res: ServerResponse, success: boolean, error?: unknown): void;
  formatError(error: unknown): string;
  // --- path resolution ---
  resolveComponentPath(astroSource: string): string;
  resolveFilePath(file: string, root?: string): string;
  // --- cross-module notifications ---
  notifyWs(event: 'sq:components-changed' | 'sq:layouts-changed' | 'sq:pages-changed' | 'sq:content-changed'): void;
}

export interface SqServerContextDeps {
  projectRoot: string;
  executeFileWrite: SqServerContext['executeFileWrite'];
  queueFileWrite: SqServerContext['queueFileWrite'];
  suppressHmrFor: SqServerContext['suppressHmrFor'];
  formatError: SqServerContext['formatError'];
  resolveComponentPath: SqServerContext['resolveComponentPath'];
  resolveFilePath: SqServerContext['resolveFilePath'];
}

export function createSqServerContext(server: ViteDevServer, deps: SqServerContextDeps): SqServerContext {
  const { formatError } = deps;

  // Helper to read JSON body from request. Decode the bytes once: per-chunk
  // decoding turns a character split across chunks into U+FFFD.
  const readJsonBody = (req: IncomingMessage): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer | string) => { chunks.push(Buffer.from(chunk)); });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Invalid JSON body')); }
      });
      req.on('error', reject);
    });
  };

  function sendWsResult(event: string, requestId: string, success: boolean, error?: unknown): void {
    server.ws.send({
      type: 'custom',
      event,
      data: success
        ? { requestId, success: true }
        : { requestId, success: false, error: formatError(error) },
    });
  }

  function sendHttpResult(res: ServerResponse, success: boolean, error?: unknown): void {
    if (!success) res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(
      success ? { success: true } : { success: false, error: formatError(error) }
    ));
  }

  function notifyWs(event: 'sq:components-changed' | 'sq:layouts-changed' | 'sq:pages-changed' | 'sq:content-changed'): void {
    server.ws.send({ type: 'custom', event, data: {} });
  }

  return {
    server,
    ...deps,
    readJsonBody,
    sendWsResult,
    sendHttpResult,
    notifyWs,
  };
}
