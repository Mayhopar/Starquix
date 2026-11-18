// @vitest-environment node
/**
 * Seamless canvas Task 4.3 finding: Astro's dev error page answers with
 * writeHead(500, { Content-Length }) — headers on the wire before end(). The
 * arming middleware then grew the body, and the client truncated it to the
 * stale length: a 75-byte slice of OUR <style> instead of the error page.
 * A body whose headers are already sent must pass through untouched.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { sqSourcePlugin } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

type Mw = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
let server: Server | null = null;
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(r => server!.close(() => r())); server = null; } });

async function serveThroughArming(final: (res: ServerResponse) => void): Promise<{ status: number; body: string }> {
  const unrouted: Mw[] = [];
  const plugin = sqSourcePlugin({ bridgeJsPath: '/nonexistent/bridge.js' }) as { configureServer: (s: unknown) => void };
  plugin.configureServer({
    middlewares: { use: (a: unknown, b?: unknown) => { if (typeof a === 'function') unrouted.push(a as Mw); else void b; } },
    ws: { on: () => {}, send: () => {} }, watcher: { on: () => {} }, config: { root: tmpdir() },
  });
  const arm = unrouted[unrouted.length - 1];
  server = createServer((req, res) => arm(req, res, () => final(res)));
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/`, { headers: { Accept: 'text/html' } });
  return { status: r.status, body: await r.text() };
}

describe('HTML arming', () => {
  it('arms an ordinary page (headers not yet sent)', async () => {
    const r = await serveThroughArming(res => { res.setHeader('content-type', 'text/html'); res.setHeader('content-length', '30'); res.end('<html><head></head></html>xxxx'); });
    expect(r.body).toContain('__SQ_LOCAL_MODE__');
    expect(r.body.endsWith('</html>xxxx')).toBe(true);
  });

  it('arms a chunked page written after writeHead (how Astro serves every page)', async () => {
    const r = await serveThroughArming(res => { res.setHeader('content-type', 'text/html'); res.writeHead(200); res.write('<html><head></head>'); res.end('<body>x</body></html>'); });
    expect(r.body).toContain('__SQ_LOCAL_MODE__');
    expect(r.body).toContain('/scripts/bridge.js');
    expect(r.body.endsWith('<body>x</body></html>')).toBe(true);
  });

  it('passes an already-headed response (Astro error page) through whole', async () => {
    const page = '<!doctype html><title>Error</title><p>Unexpected "{" at src/pages/index.astro:6:5</p>';
    const r = await serveThroughArming(res => {
      res.setHeader('Content-Type', 'text/html'); res.setHeader('Content-Length', Buffer.byteLength(page));
      res.writeHead(500); res.end(page);
    });
    expect(r.status).toBe(500);
    expect(r.body).toBe(page);
  });
});
