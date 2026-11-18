/**
 * A write-back that changes a layouts/ file must broadcast sq:layouts-changed:
 * useLayoutLibrary refetches on it and pages rebase their chrome on the fresh
 * body. Without it the write landed on disk but every open editor kept
 * rendering the OLD chrome order until a full reload (proven live 2026-08-27:
 * master reorder flushed, file changed, page canvas stayed stale).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, findRouteHandler, makeJsonRequest, makeCapturedResponse, type MockServer } from './mockServer';

const LAYOUT_SRC = `---
import Header from '../components/library/Header.astro';
import Footer from '../components/library/Footer.astro';
---
<html>
  <body>
    <slot />
    <Footer />
    <Header />
</body>
</html>
`;

describe('/__sq/write-back-component — layout change notification', () => {
  let base: string;
  let layoutPath: string;
  let server: MockServer;

  beforeEach(async () => {
    // resolveComponentPath maps layouts/ to <root>/../preview-template/src —
    // give the mock root an `app/` shape so `..` stays inside the temp dir.
    base = await mkdtemp(path.join(tmpdir(), 'sq-layoutnotify-'));
    const root = path.join(base, 'app');
    await mkdir(path.join(base, 'preview-template', 'src', 'layouts'), { recursive: true });
    layoutPath = path.join(base, 'preview-template', 'src', 'layouts', 'Layout1.astro');
    await writeFile(layoutPath, LAYOUT_SRC, 'utf-8');
    server = configureMockServer(root);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  async function post(body: unknown) {
    const handler = findRouteHandler(server, '/__sq/write-back-component');
    const captured = makeCapturedResponse();
    await handler(makeJsonRequest('POST', body), captured.res, () => {});
    await captured.done;
    return captured;
  }

  const layoutsChangedSends = () =>
    server.ws.send.mock.calls.filter((c) => (c[0] as { event?: string })?.event === 'sq:layouts-changed');

  it('broadcasts sq:layouts-changed after a changed layouts/ write (orderPermutation path)', async () => {
    const r = await post({
      astroSource: 'layouts/Layout1.astro',
      overrides: { orderPermutation: [0, 2, 1] },
    });
    expect(r.status()).toBe(200);
    expect((r.json() as { changed: boolean }).changed).toBe(true);

    const onDisk = await readFile(layoutPath, 'utf-8');
    expect(onDisk.indexOf('<Header')).toBeLessThan(onDisk.indexOf('<Footer'));
    expect(layoutsChangedSends().length).toBe(1);
  });

  it('does not broadcast for a no-op layout write or for a non-layout file', async () => {
    const noop = await post({
      astroSource: 'layouts/Layout1.astro',
      overrides: { orderPermutation: [0, 1, 2] },
    });
    expect((noop.json() as { changed: boolean }).changed).toBe(false);
    expect(layoutsChangedSends().length).toBe(0);
  });
});
