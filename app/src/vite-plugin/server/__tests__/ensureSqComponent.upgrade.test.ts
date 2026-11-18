/**
 * task-206 D1 upgrade path: `ensure-sq-component` never overwrites a user's
 * copy — EXCEPT when the copy predates the CSS-var knob surface (missing the
 * `sq-media-v2` marker). Then it is a stale SYSTEM file: back it up to
 * `.bak` and refresh from the current template, reporting `upgraded: true`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configureMockServer,
  findRouteHandler,
  makeJsonRequest,
  makeCapturedResponse,
} from './mockServer';

const CURRENT_TEMPLATE = readFileSync(
  join(__dirname, '../../../../..', 'preview-template/src/components/Media.astro'),
  'utf8',
);
const STACK_TEMPLATE = readFileSync(
  join(__dirname, '../../../../..', 'preview-template/src/components/Stack.astro'),
  'utf8',
);
const OLD_COPY = '---\nconst { items = [null] } = Astro.props;\n---\n<div class="sq-media" />\n';

let base: string;
let appRoot: string;
let userDir: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sq-ensure-'));
  // The handler resolves the template at <pluginRoot>/../preview-template/…
  appRoot = join(base, 'app');
  mkdirSync(appRoot, { recursive: true });
  mkdirSync(join(base, 'preview-template/src/components'), { recursive: true });
  writeFileSync(join(base, 'preview-template/src/components/Media.astro'), CURRENT_TEMPLATE);
  writeFileSync(join(base, 'preview-template/src/components/Stack.astro'), STACK_TEMPLATE);
  userDir = join(base, 'user-project');
  mkdirSync(join(userDir, 'src/components/sq'), { recursive: true });
  writeFileSync(join(userDir, 'package.json'), JSON.stringify({ dependencies: { '@astrojs/mdx': '^3' } }));
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

async function callEnsure(name = 'Media') {
  const server = configureMockServer(appRoot);
  const handler = findRouteHandler(server, '/__sq/local/ensure-sq-component');
  const captured = makeCapturedResponse();
  await handler(makeJsonRequest('POST', { path: userDir, name }), captured.res, () => {});
  await captured.done;
  return captured;
}

describe('ensure-sq-component stale-copy upgrade', () => {
  it('old file (no sq-media-v2 marker) → upgraded + .bak written', async () => {
    const target = join(userDir, 'src/components/sq/Media.astro');
    writeFileSync(target, OLD_COPY);

    const r = await callEnsure();
    expect(r.status()).toBe(200);
    expect((r.json() as { upgraded?: boolean }).upgraded).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(CURRENT_TEMPLATE);
    expect(readFileSync(`${target}.bak`, 'utf8')).toBe(OLD_COPY);
  });

  it('current file → untouched, no .bak', async () => {
    const target = join(userDir, 'src/components/sq/Media.astro');
    writeFileSync(target, CURRENT_TEMPLATE);

    const r = await callEnsure();
    expect(r.status()).toBe(200);
    const body = r.json() as { created: boolean; upgraded?: boolean };
    expect(body.created).toBe(false);
    expect(body.upgraded).toBeUndefined();
    expect(readFileSync(target, 'utf8')).toBe(CURRENT_TEMPLATE);
    expect(existsSync(`${target}.bak`)).toBe(false);
  });

  it('missing file → created (unchanged behavior)', async () => {
    const r = await callEnsure();
    expect((r.json() as { created: boolean }).created).toBe(true);
  });
});

/**
 * task-207 Task 10/D12: the `/` menu lists every component under sq/, so
 * ensure-sq-component is now called with PROMOTED names too. There is no
 * template to copy and the file already exists — it must short-circuit, not
 * 400 on the allowlist (which guards the copy path only) or 500 on a template
 * that was never meant to exist for it.
 */
describe('ensure-sq-component and promoted components', () => {
  const PROMOTED = '---\nconst { role } = Astro.props;\n---\n<p>{role}</p>\n';

  it('an existing promoted component short-circuits, bytes untouched', async () => {
    const target = join(userDir, 'src/components/sq/Credit.astro');
    writeFileSync(target, PROMOTED);

    const r = await callEnsure('Credit');
    expect(r.status()).toBe(200);
    expect(r.json()).toMatchObject({
      file: 'src/components/sq/Credit.astro', created: false, promoted: true,
    });
    expect(readFileSync(target, 'utf8'), 'never rewritten by us (D6)').toBe(PROMOTED);
    expect(existsSync(`${target}.bak`), 'no .bak for a promoted component').toBe(false);
  });

  it('a name that is neither ours nor already promoted is still refused', async () => {
    const r = await callEnsure('Nope');
    expect(r.status()).toBe(400);
    expect((r.json() as { error: string }).error).toMatch(/not an insertable component/);
  });

  it('a traversing name never reaches a path join', async () => {
    for (const name of ['../../etc/passwd', 'a/b', '.', '']) {
      const r = await callEnsure(name);
      expect(r.status(), name).toBe(400);
      expect((r.json() as { error: string }).error, name).toMatch(/invalid component name/);
    }
  });

  it('ours still reports promoted:false so the caller can tell them apart', async () => {
    writeFileSync(join(userDir, 'src/components/sq/Media.astro'), CURRENT_TEMPLATE);
    expect((await callEnsure('Media')).json()).toMatchObject({ created: false, promoted: false });
  });

  it('Stack missing → created from the template', async () => {
    const r = await callEnsure('Stack');
    expect(r.status()).toBe(200);
    expect((r.json() as { created: boolean }).created).toBe(true);
    expect(readFileSync(join(userDir, 'src/components/sq/Stack.astro'), 'utf8')).toBe(STACK_TEMPLATE);
    // the utilities companion Stack imports exists (empty) and is reported
    expect(readFileSync(join(userDir, 'src/components/sq/sq-utilities.css'), 'utf8')).toBe('');
    expect((r.json() as { extra?: string[] }).extra).toEqual(['src/components/sq/sq-utilities.css']);
  });

  it('an existing sq-utilities.css (normalized site) is never overwritten', async () => {
    writeFileSync(join(userDir, 'src/components/sq/sq-utilities.css'), '@tailwind utilities;\n');
    await callEnsure('Stack');
    expect(readFileSync(join(userDir, 'src/components/sq/sq-utilities.css'), 'utf8')).toBe('@tailwind utilities;\n');
  });

  it('Stack stale copy (no sq-stack-v5) → .bak + upgraded', async () => {
    const target = join(userDir, 'src/components/sq/Stack.astro');
    writeFileSync(target, OLD_COPY);
    const r = await callEnsure('Stack');
    expect((r.json() as { upgraded?: boolean }).upgraded).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(STACK_TEMPLATE);
    expect(readFileSync(`${target}.bak`, 'utf8')).toBe(OLD_COPY);
  });
});
