import { expect, it } from 'vitest';
import { desktopGuard } from '../src/http-guard.mjs';
it('requires the secret for private reads/writes and identifies this generation', () => {
  let middleware;
  desktopGuard({ token: 'secret', identity: { projectId: 'p', lease: 'l', generation: 2 } }).configureServer({
    middlewares: { use(fn) { middleware = fn; } },
    httpServer: { prependListener() {} },
  });
  const request = (url, headers = {}) => {
    let next = false; let body = '';
    const res = { statusCode: 200, setHeader() {}, end(v = '') { body = v; } };
    middleware({ url, headers: { host: '127.0.0.1:43210', ...headers } }, res, () => { next = true; });
    return { status: res.statusCode, body, next };
  };
  expect(request('/__sq/local/pages').status).toBe(403);
  expect(request('/__sq/local/source-command', { origin: 'https://foreign.test' }).status).toBe(403);
  expect(request('/__sq/local/pages', { 'x-sq-desktop-token': 'wrong' }).status).toBe(403);
  expect(request('/__sq/local/pages', { 'x-sq-desktop-token': 'secret' }).next).toBe(true);
  expect(JSON.parse(request('/__sq/desktop-health', { 'x-sq-desktop-token': 'secret' }).body)).toEqual({ projectId: 'p', lease: 'l', generation: 2 });
  expect(request('/').next).toBe(true);
});
it('refuses websocket upgrades from another origin', () => {
  let upgrade;
  desktopGuard({ token: 't', identity: {} }).configureServer({
    middlewares: { use() {} }, httpServer: { prependListener(_e, fn) { upgrade = fn; } },
  });
  const socket = () => { const s = { destroyed: false, destroy() { s.destroyed = true; } }; return s; };
  const foreign = socket(); upgrade({ headers: { host: '127.0.0.1:1', origin: 'https://evil.test' } }, foreign);
  const same = socket(); upgrade({ headers: { host: '127.0.0.1:1', origin: 'http://127.0.0.1:1' } }, same);
  expect([foreign.destroyed, same.destroyed]).toEqual([true, false]);
});
