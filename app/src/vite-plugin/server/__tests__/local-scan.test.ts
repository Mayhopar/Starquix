// task-136/137: scan-components / scan-layouts pointed at a local project's
// own folder (?source=local&path=) list THEIR files, not preview-template's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, findRouteHandler, makeJsonRequest, makeCapturedResponse, type MockServer } from './mockServer';

let base: string;
let userDir: string;
let server: MockServer;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'sq-local-scan-'));
  const root = path.join(base, 'app');
  userDir = path.join(base, 'their-site');
  await mkdir(root, { recursive: true });
  await mkdir(path.join(userDir, 'src', 'components', 'cards'), { recursive: true });
  await mkdir(path.join(userDir, 'src', 'layouts'), { recursive: true });
  await writeFile(
    path.join(userDir, 'src', 'components', 'Hero.astro'),
    '---\nconst { title } = Astro.props;\n---\n<section><h1>{title}</h1></section>',
  );
  await writeFile(path.join(userDir, 'src', 'components', 'cards', 'Card.astro'), '<div class="card"><slot /></div>');
  await writeFile(path.join(userDir, 'src', 'layouts', 'Base.astro'), '<html><body><slot /></body></html>');
  server = configureMockServer(root);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function get(route: string, query: string) {
  const handler = findRouteHandler(server, route);
  const captured = makeCapturedResponse();
  await handler(makeJsonRequest('GET', undefined, `${route}?${query}`), captured.res, () => {});
  await captured.done;
  return captured;
}

describe('scan-components?source=local', () => {
  it('lists the user folder src/components with real-file-relative paths', async () => {
    const r = await get('/__sq/scan-components', `source=local&path=${encodeURIComponent(userDir)}`);
    expect(r.status()).toBe(200);
    const comps = r.json() as Array<{ name: string; path: string; source: string; html: string }>;
    const byName = new Map(comps.map(c => [c.name, c]));
    expect(byName.get('Hero')?.path).toBe('src/components/Hero.astro');
    expect(byName.get('Hero')?.source).toBe('user-project');
    expect(byName.get('Hero')?.html).toContain('<section>');
    expect(byName.get('Hero')?.html).not.toContain('Astro.props');
    expect(byName.get('Card')?.path).toBe('src/components/cards/Card.astro');
  });

  it('400s on an unknown folder', async () => {
    const r = await get('/__sq/scan-components', 'source=local&path=/nope/nowhere');
    expect(r.status()).toBe(400);
  });
});

describe('scan-layouts?source=local', () => {
  it('lists the user folder src/layouts', async () => {
    const r = await get('/__sq/scan-layouts', `source=local&path=${encodeURIComponent(userDir)}`);
    expect(r.status()).toBe(200);
    const layouts = r.json() as Array<{ name: string; path: string }>;
    expect(layouts.map(l => l.name)).toEqual(['Base']);
    expect(layouts[0].path).toBe('Base.astro');
  });

  it('400s on an unknown folder', async () => {
    const r = await get('/__sq/scan-layouts', 'source=local&path=/nope/nowhere');
    expect(r.status()).toBe(400);
  });
});
