// Packaged editor: the production build served on a privileged custom scheme —
// ONE stable origin across launches (IndexedDB lives there), no HTTP listener.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const EDITOR_ORIGIN = 'starquix://app';
/** Node's URL reports 'null' for every non-special scheme; compare scheme + host. */
export const originOf = url => { const u = new URL(url); return `${u.protocol}//${u.host}`; };
/** The editor main loads and trusts. Packaged: the custom scheme only (SQ_EDITOR_URL and the switch below are ignored).
 *  Unpackaged: SQ_EDITOR_URL (default the :3061 dev server) on a 127.0.0.1 loopback origin; SQ_DEV_EDITOR_LOCALHOST=1 (the runtime
 *  probe, desktop/probe) also accepts http://localhost:<port> = a different SITE than the 127.0.0.1 canvas, so the editor and the
 *  canvas get separate renderer processes like the packaged starquix://app. Unset = the strict 127.0.0.1 check, nothing else. */
export function resolveEditor({ isPackaged, env }) {
  const editorUrl = isPackaged ? `${EDITOR_ORIGIN}/` : env.SQ_EDITOR_URL ?? 'http://127.0.0.1:3061/';
  const editorOrigin = originOf(editorUrl);
  const loopback = env.SQ_DEV_EDITOR_LOCALHOST === '1' ? /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/ : /^http:\/\/127\.0\.0\.1:\d+$/;
  if (!isPackaged && !loopback.test(editorOrigin)) throw new Error('The dev editor must be a loopback editor');
  return { editorUrl, editorOrigin };
}
/** The file a request path names inside `root`; an extensionless miss is a SPA
 *  route (index.html); anything escaping `root` or unreadable is null. */
export async function editorFile(root, pathname) {
  let rel; try { rel = decodeURIComponent(pathname); } catch { return null; }
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  const stat = await fs.stat(file).catch(() => null);
  if (stat?.isFile()) return file;
  return path.extname(rel) ? null : path.join(root, 'index.html');
}
/** Backstop for an HTML-injection bug: script in the editor window reaches
 *  window.sqDesktop, every project and the stored tokens, so only the build's
 *  own scripts run there — never an inline handler, a javascript: URL or eval.
 *  'wasm-unsafe-eval': the editor runs the Astro compiler as WebAssembly
 *  (durableEdits/commandReceipts.ts). */
export const EDITOR_CSP = "script-src 'self' 'wasm-unsafe-eval'";
/** The packaged editor's answer to a starquix:// request. */
export async function editorResponse(root, url, fetchFile) {
  const { host, pathname } = new URL(url);
  const file = host === 'app' && await editorFile(root, pathname);
  if (!file) return new Response('Not found', { status: 404 });
  const res = await fetchFile(pathToFileURL(file).href);
  const headers = new Headers(res.headers);
  headers.set('Content-Security-Policy', EDITOR_CSP);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
