// Component FILE create/rename/delete must behave IDENTICALLY for the built-in
// library and for a user's local project — same helper, same guards, only the
// root directory differs. The table below runs the same assertions against both
// roots so a future change cannot fix one runtime and forget the other.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, findRouteHandler, makeJsonRequest, makeCapturedResponse, type MockServer } from './mockServer';
import { resolveInRoot, ComponentFileError } from '../componentFiles';

let base: string;
let root: string;
let userDir: string;
let builtInLib: string;
let server: MockServer;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'sq-compfiles-'));
  root = path.join(base, 'app');
  userDir = path.join(base, 'their-site');
  builtInLib = path.join(base, 'preview-template', 'src', 'components', 'library');
  await mkdir(builtInLib, { recursive: true });
  await mkdir(root, { recursive: true });
  await mkdir(path.join(userDir, 'src', 'components'), { recursive: true });
  server = configureMockServer(root);
});

afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function post(route: string, body: unknown) {
  const handler = findRouteHandler(server, route);
  const captured = makeCapturedResponse();
  await handler(makeJsonRequest('POST', body, route), captured.res, () => {});
  await captured.done;
  return captured;
}

/**
 * The two runtimes, expressed as data. `file(name)` is where the .astro lives
 * on disk; `scanned(name)` is the path the panel/manifest uses.
 */
const RUNTIMES = [
  {
    label: 'built-in library (WC)',
    dir: () => builtInLib,
    file: (n: string) => path.join(builtInLib, `${n}.astro`),
    scanned: (n: string) => `library/${n}.astro`,
    rename: (n: string, newName: string) => ['/__sq/rename-component', { componentPath: `library/${n}.astro`, newName }] as const,
    remove: (n: string) => ['/__sq/delete-component', { componentPath: `library/${n}.astro` }] as const,
  },
  {
    label: 'local project',
    dir: () => path.join(userDir, 'src', 'components'),
    file: (n: string) => path.join(userDir, 'src', 'components', `${n}.astro`),
    scanned: (n: string) => `src/components/${n}.astro`,
    rename: (n: string, newName: string) => ['/__sq/local/component-rename', { path: userDir, componentPath: `src/components/${n}.astro`, newName }] as const,
    remove: (n: string) => ['/__sq/local/component-delete', { path: userDir, componentPath: `src/components/${n}.astro` }] as const,
  },
] as const;

for (const rt of RUNTIMES) {
  describe(`component files — ${rt.label}`, () => {
    it('renames the file on disk and reports the new scanned path', async () => {
      await writeFile(rt.file('Old'), '<div>x</div>', 'utf-8');
      const [route, body] = rt.rename('Old', 'New');
      const res = await post(route, body);
      expect(res.status() ?? 200).toBe(200);
      expect(existsSync(rt.file('Old'))).toBe(false);
      expect(await readFile(rt.file('New'), 'utf-8')).toBe('<div>x</div>');
      // the caller needs this to repoint the folder manifest
      expect((res.json() as { path: string }).path.replace(/\\/g, '/')).toBe(rt.scanned('New'));
    });

    it('refuses a rename that would clobber an existing component', async () => {
      await writeFile(rt.file('A'), 'a', 'utf-8');
      await writeFile(rt.file('B'), 'b', 'utf-8');
      const [route, body] = rt.rename('A', 'B');
      const res = await post(route, body);
      expect(res.status()).toBe(409);
      expect(await readFile(rt.file('B'), 'utf-8')).toBe('b'); // untouched
    });

    it('404s renaming a component that does not exist', async () => {
      const [route, body] = rt.rename('Ghost', 'X');
      expect((await post(route, body)).status()).toBe(404);
    });

    it('deletes the file and returns its bytes for undo', async () => {
      await writeFile(rt.file('Doomed'), '<p>bye</p>', 'utf-8');
      const [route, body] = rt.remove('Doomed');
      const res = await post(route, body);
      expect(res.status() ?? 200).toBe(200);
      expect(existsSync(rt.file('Doomed'))).toBe(false);
      expect((res.json() as { content: string }).content).toBe('<p>bye</p>');
    });
  });
}

describe('local component create', () => {
  it('writes a new .astro into the project and reports its path', async () => {
    const res = await post('/__sq/local/component-create', {
      path: userDir, name: 'Fresh', astroContent: '---\n---\n<section />\n',
    });
    expect(res.status() ?? 200).toBe(200);
    expect(await readFile(path.join(userDir, 'src', 'components', 'Fresh.astro'), 'utf-8'))
      .toBe('---\n---\n<section />\n');
  });

  it('refuses an unknown project folder', async () => {
    const res = await post('/__sq/local/component-create', {
      path: path.join(base, 'nope'), name: 'X', astroContent: 'x',
    });
    expect(res.status()).toBe(400);
  });
});

describe('resolveInRoot guard', () => {
  it('refuses a path escaping the component root', () => {
    expect(() => resolveInRoot('/a/b', '../../../etc/passwd')).toThrow(ComponentFileError);
  });

  it('allows a nested path inside the root', () => {
    expect(resolveInRoot('/a/b', 'sub/Thing.astro')).toBe(path.resolve('/a/b/sub/Thing.astro'));
  });
});

describe('the two runtimes are wired to the same guard', () => {
  it('refuses an escaping componentPath in a local project too', async () => {
    const res = await post('/__sq/local/component-delete', {
      path: userDir, componentPath: '../../../../etc/passwd',
    });
    expect(res.status()).toBe(400);
  });
});
