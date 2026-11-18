import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { editorFile, originOf } from '../src/editor.mjs';
it('serves build files, SPA routes and nothing outside the build', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-editor-'));
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'index.html'), '');
  await fs.writeFile(path.join(root, 'assets/a b.js'), '');
  await fs.writeFile(path.join(path.dirname(root), 'secret.txt'), '').catch(() => {});
  try {
    expect(await editorFile(root, '/')).toBe(path.join(root, 'index.html'));
    expect(await editorFile(root, '/assets/a%20b.js')).toBe(path.join(root, 'assets/a b.js'));
    expect(await editorFile(root, '/editor/browser_1')).toBe(path.join(root, 'index.html'));
    expect(await editorFile(root, '/assets/missing.js')).toBeNull();
    expect(await editorFile(root, '/assets')).toBe(path.join(root, 'index.html'));
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/%E0%A4%A', '/%00'])
      expect(String(await editorFile(root, p))).not.toMatch(/secret|\0/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it('compares custom-scheme origins by scheme and host', () => {
  expect(originOf('starquix://app/editor/x?y')).toBe('starquix://app');
  expect(originOf('starquix://evil/')).not.toBe('starquix://app');
  expect(originOf('data:text/html,x')).not.toBe('starquix://app');
  expect(originOf('http://127.0.0.1:3061/a')).toBe('http://127.0.0.1:3061');
});
// Security (audit 2026-10-18): the editor window holds window.sqDesktop, every
// project and the stored tokens; the packaged build ships a CSP backstop so an
// injected inline handler or javascript: URL never runs there.
it("serves every editor response with a script-src 'self' CSP (+ wasm: the editor runs the Astro compiler)", async () => {
  const { editorResponse } = await import('../src/editor.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-editor-csp-'));
  await fs.writeFile(path.join(root, 'index.html'), '<html></html>');
  try {
    const fetched = [];
    const fetchFile = async href => { fetched.push(href); return new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }); };
    const res = await editorResponse(root, 'starquix://app/editor/browser_1', fetchFile);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(res.headers.get('content-type')).toBe('text/html');
    expect(await res.text()).toBe('<html></html>');
    expect(fetched).toEqual([pathToFileURL(path.join(root, 'index.html')).href]);
    expect((await editorResponse(root, 'starquix://evil/', fetchFile)).status).toBe(404);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
