// Adversarial-review regression tests for the materialize-on-insert flow:
//
// 17 (critical): materialize used to run its multi-roundtrip network work
//    BEFORE the shared structural-write guard was acquired — a foreign write
//    landing in that window shifted lines under the gesture-time scan, and the
//    Replace step's writeRemove(allowRootRemoval) spliced a stale span (silent
//    wrong-element deletion). The guard is now acquired FIRST and held through
//    materialize + insert + replace.
//  2: the same-name reuse substitution (user's file wins over the built-in
//    they clicked) was silent — the toast now says so.
//  3: materialize writes real .astro files into the user's repo — the toast
//    now names them (undo machinery has no file-delete op, so ⌘Z can't).
//  6: the dep guard only inspected RELATIVE imports — a bare npm specifier
//    (task-109 lucide-static class) copied silently and broke the user's dev
//    server. All specifiers are now checked; bare npm ones refuse honestly.
//  4: Replace pushes TWO undo records by design — the toast now names the
//    two-step ⌘Z contract instead of leaving "undo looks broken" unexplained.
//
// Files-truth migration (2026-09): the gesture is ONE durable file batch over
// the projected source (fdd2d12f) — no writer calls or /component-create POSTs
// to observe; the real route table runs over a temp disk (projectFsRuntime).
// Success toasts (and with them the finding-2/3 notes and the finding-4
// "two steps" note) were retired in 426889ee; replace is one atomic batch with
// ONE undo record since fdd2d12f. Those findings are pinned on the files and
// undo records that actually land.
import 'fake-indexeddb/auto'; // before any module that constructs the Dexie db
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScannedElement } from '@/context/SelectionContext';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import toast from 'react-hot-toast';
import { insertLocalComponent } from '../localComponentInsert';
import {
  tryAcquireStructuralWrite,
  releaseStructuralWrite,
} from '../localStructuralOps';
import { getLocalTransport, setLocalTransport } from '@/utils/sqLocalBase';
import { listUnmaterialized } from '@/services/durableEdits/store';
import { openDurableInsertProject, type DurableInsertProject } from './localInsertDurableHarness';

const PAGE = 'src/pages/index.astro';
const PAGE_SRC = `---
const title = 'Home';
---
<main>
  <section class="old"></section>
  <p>keep</p>
</main>
`;

const heroComponent = {
  name: 'hero',
  path: 'src/components/hero.astro',
  source: 'user-project' as const,
  html: '<section></section>',
  category: 'Other',
  props: [],
  slots: [],
  dependencies: [],
};

const builtInCTA = {
  ...heroComponent,
  name: 'CTA',
  path: 'library/CTA.astro',
  source: 'built-in' as const,
};

const el = (over: Partial<ScannedElement> = {}): ScannedElement => ({
  key: `${PAGE}:5:3`,
  tagName: 'section',
  classes: '',
  sourceLocation: { file: PAGE, line: 5, column: 3 },
  rect: { top: 0, left: 0, width: 10, height: 10 },
  parentKey: null,
  hasSourceTracking: true,
  ...over,
});

let project: DurableInsertProject;
const onDisk = async (file = PAGE) => { await project.flush(); return project.read(file); };
const exists = (file: string) => existsSync(join(project.runtime.root, file));
const acceptedBatches = async () => (await listUnmaterialized(project.projectId)).length;

// ── network observation: page fetches (raw built-in source) + every
// /__sq/local/* call through the real route table. ─────────────────────────
let fetchCalls: string[] = [];
let localCalls: string[] = [];
let librarySources: Record<string, string> = {};

function installFetchMock() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.startsWith('/__sq/component-html?')) {
      const libPath = new URL(url, 'http://localhost').searchParams.get('path') ?? '';
      const src = librarySources[libPath];
      return src === undefined
        ? new Response('not found', { status: 404 })
        : new Response(src, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response('unexpected', { status: 500 });
  }));
  const routes = getLocalTransport()!;
  setLocalTransport({ ...routes, fetch: (path, init) => { localCalls.push(path); return routes.fetch(path, init); } });
}

async function open(files: Record<string, string> = {}) {
  project = await openDurableInsertProject({ [PAGE]: PAGE_SRC, [heroComponent.path]: '<section></section>\n', ...files });
  installFetchMock();
}

beforeEach(async () => {
  vi.stubEnv('PROD', false);
  vi.clearAllMocks();
  fetchCalls = [];
  localCalls = [];
  librarySources = {};
  await open();
});

afterEach(async () => {
  await project.close();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('finding 17 — guard acquired BEFORE materialize (no unguarded roundtrip window)', () => {
  // Owner 2026-11-10: no refusal — the insert waits its turn, and still does
  // NO materialize network work before it (finding 17's window stays closed).
  it('a foreign in-flight structural write: the insert waits — no materialize network work before its turn', async () => {
    expect(tryAcquireStructuralWrite()).toBe(true); // foreign writer holds the ONE guard
    librarySources['library/CTA.astro'] = '---\n---\n<section class="cta"></section>\n';
    const pending = insertLocalComponent({
      component: builtInCTA, selection: null, scannedElements: [], pageFile: PAGE,
      localProjectPath: project.folder,
    });
    await new Promise((r) => setTimeout(r, 0));
    // THE regression pin: materialize has not started while the foreign write holds the guard.
    expect(fetchCalls).toHaveLength(0);
    expect(localCalls).toHaveLength(0);
    expect(await acceptedBatches()).toBe(0);
    releaseStructuralWrite();
    expect((await pending).ok).toBe(true);
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('Still saving'), expect.anything());
    await onDisk(); // the accepted batch materializes
    expect(exists('src/components/CTA.astro')).toBe(true);
  });

  it('the guard does NOT leak when materialize itself fails (released for the next gesture)', async () => {
    setLocalTransport({ ...getLocalTransport()!, fetch: async () => new Response('nope', { status: 500 }) });
    const r = await insertLocalComponent({
      component: builtInCTA, selection: null, scannedElements: [], pageFile: PAGE,
      localProjectPath: project.folder,
    });
    expect(r.ok).toBe(false);
    expect(tryAcquireStructuralWrite()).toBe(true); // free again — finally released it
    releaseStructuralWrite();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('finding 2 — same-name reuse', () => {
  it('collision reuse: the USER\'s file is used and never overwritten', async () => {
    await project.close();
    await open({ 'src/components/CTA.astro': '<div>mine</div>\n' });
    librarySources['library/CTA.astro'] = '---\n---\n<section class="cta"></section>\n';
    const r = await insertLocalComponent({
      component: builtInCTA, selection: null, scannedElements: [], pageFile: PAGE,
      localProjectPath: project.folder,
    });
    expect(r.ok).toBe(true);
    expect(await onDisk()).toContain("import CTA from '../components/CTA.astro';");
    expect(project.read('src/components/CTA.astro')).toBe('<div>mine</div>\n'); // still never overwrites
    expect(fetchCalls.some(url => url.startsWith('/__sq/component-html'))).toBe(false); // the built-in was never read
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('finding 3 — created files land in the project', () => {
  it('root only: CTA.astro copied into src/components/', async () => {
    librarySources['library/CTA.astro'] = '---\n---\n<section class="cta"></section>\n';
    const r = await insertLocalComponent({
      component: builtInCTA, selection: null, scannedElements: [], pageFile: PAGE,
      localProjectPath: project.folder,
    });
    expect(r.ok).toBe(true);
    await onDisk();
    expect(project.read('src/components/CTA.astro')).toBe(librarySources['library/CTA.astro']);
  });

  it('root + dep closure: the dependency lands too', async () => {
    librarySources['library/Header.astro'] =
      "---\nimport GlobalNav from './navigation/GlobalNav.astro';\n---\n<header><GlobalNav /></header>\n";
    librarySources['library/navigation/GlobalNav.astro'] = '---\n---\n<nav></nav>\n';
    const r = await insertLocalComponent({
      component: { ...builtInCTA, name: 'Header', path: 'library/Header.astro' },
      selection: null, scannedElements: [], pageFile: PAGE,
      localProjectPath: project.folder,
    });
    expect(r.ok).toBe(true);
    await onDisk();
    expect(exists('src/components/Header.astro')).toBe(true);
    expect(exists('src/components/GlobalNav.astro')).toBe(true);
  });

  it('theme template: the new file is named from the template', async () => {
    const r = await insertLocalComponent({
      component: {
        id: 't1', name: 'Fancy Hero', category: 'Hero', image: '',
        html: '<section class="fancy"></section>', themeId: 'th', componentPath: 'x',
      },
      selection: null, scannedElements: [], pageFile: PAGE,
      localProjectPath: project.folder,
    });
    expect(r.ok).toBe(true);
    await onDisk();
    expect(project.read('src/components/FancyHero.astro')).toBe('<section class="fancy"></section>\n');
  });

  it('user-project insert: no materialize note, nothing copied (regression pin)', async () => {
    const selection = el();
    const r = await insertLocalComponent({
      component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE,
    });
    expect(r.ok).toBe(true);
    await onDisk();
    const allToasts = [...(toast as unknown as ReturnType<typeof vi.fn>).mock.calls, ...(toast.success as ReturnType<typeof vi.fn>).mock.calls];
    expect(allToasts.flat().join(' ')).not.toMatch(/copied|using your existing/);
    expect(fetchCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('finding 6 — bare npm import specifiers refuse honestly (lucide-static class)', () => {
  it('a bare npm specifier in the built-in\'s frontmatter refuses, NOTHING written', async () => {
    librarySources['library/CTA.astro'] =
      "---\nimport { icon } from 'lucide-static';\n---\n<section>{icon}</section>\n";
    const r = await insertLocalComponent({
      component: builtInCTA, selection: null, scannedElements: [], pageFile: PAGE,
      localProjectPath: project.folder,
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining('lucide-static') });
    expect(r).toMatchObject({ reason: expect.stringContaining('install it in your project first') });
    expect(await acceptedBatches()).toBe(0);
    expect(await onDisk()).toBe(PAGE_SRC);
    expect(exists('src/components/CTA.astro')).toBe(false);
  });

  it('a bare npm specifier in a DEP\'s frontmatter refuses too', async () => {
    librarySources['library/Header.astro'] =
      "---\nimport GlobalNav from './navigation/GlobalNav.astro';\n---\n<header><GlobalNav /></header>\n";
    librarySources['library/navigation/GlobalNav.astro'] =
      "---\nimport { menu } from 'lucide-static';\n---\n<nav>{menu}</nav>\n";
    const r = await insertLocalComponent({
      component: { ...builtInCTA, name: 'Header', path: 'library/Header.astro' },
      selection: null, scannedElements: [], pageFile: PAGE,
      localProjectPath: project.folder,
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining('lucide-static') });
    expect(await acceptedBatches()).toBe(0);
    expect(exists('src/components/Header.astro')).toBe(false);
    expect(exists('src/components/GlobalNav.astro')).toBe(false);
  });

  it('astro built-ins (astro:*) are allowed — every Astro project resolves them', async () => {
    librarySources['library/CTA.astro'] =
      "---\nimport { Image } from 'astro:assets';\n---\n<section><Image /></section>\n";
    const r = await insertLocalComponent({
      component: builtInCTA, selection: null, scannedElements: [], pageFile: PAGE,
      localProjectPath: project.folder,
    });
    expect(r.ok).toBe(true);
    await onDisk();
    expect(project.read('src/components/CTA.astro')).toBe(librarySources['library/CTA.astro']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 4, files-truth form: the "(undo restores in two steps)" note existed
// because Replace pushed TWO records. Since fdd2d12f insert+remove are one
// accepted batch and ONE record, so a single ⌘Z restores both — no note needed.
describe('finding 4 — Replace undo is ONE step', () => {
  it('with an undo stack (pushUndo): ONE record covering insert + remove', async () => {
    const pushUndo = vi.fn();
    const selection = el();
    const r = await insertLocalComponent({
      component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE,
      replaceKey: selection.key, pushUndo,
    });
    expect(r.ok).toBe(true);
    expect(pushUndo).toHaveBeenCalledTimes(1);
    const { forward, inverse } = pushUndo.mock.calls[0][0].structuralOp;
    expect(forward.map((op: { kind: string }) => op.kind)).toEqual(['import', 'insert', 'remove']);
    expect(inverse.map((op: { kind: string }) => op.kind)).toEqual(['restore', 'restore-region', 'import']);
  });

  it('without pushUndo (nothing on any undo stack): the replace still lands', async () => {
    const selection = el();
    const r = await insertLocalComponent({
      component: heroComponent, selection, scannedElements: [selection], pageFile: PAGE,
      replaceKey: selection.key,
    });
    expect(r.ok).toBe(true);
    const page = await onDisk();
    expect(page).toContain('  <Hero />\n  <p>keep</p>');
    expect(page).not.toContain('class="old"');
  });
});
