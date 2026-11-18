import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import toast, { Toaster } from 'react-hot-toast';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { insertLocalComponent, materializeLibraryComponent } from '@/components/Editor/localComponentInsert';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import type { ThemeComponentTemplate } from '@/components/ComponentPickerModal';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { flushDurableSourceWrites } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';

const page = 'src/pages/index.astro';
const componentFile = 'src/components/Hero.astro';
const template = { id: 'hero', name: 'Hero', html: '<section>Hero</section>' } as ThemeComponentTemplate;
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
let release: () => void;
let writes: number;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }));
  await db.delete(); await db.open(); toast.remove();
  projectId = `browser_component_projection_${crypto.randomUUID()}`; setActiveSaveProjectId(projectId);
  const gate = new Promise<void>(resolve => { release = resolve; }); writes = 0;
  runtime = projectFsRuntime(projectId, { [page]: '<main></main>\n' }, {
    beforeCommand: async () => { writes++; await gate; }, loseAcknowledgement: () => writes === 1,
  });
  render(<Toaster />);
});
afterEach(async () => {
  release(); await flushDurableSourceWrites(projectId).catch(() => {});
  cleanup(); toast.remove(); runtime.close(); setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const insert = (component: ThemeComponentTemplate | ScannedComponent) => insertLocalComponent({
  component, selection: null, scannedElements: [], pageFile: page, localProjectPath: `wc://${projectId}`,
});
const copy = (component = template) => materializeLibraryComponent(component, `wc://${projectId}`);

it.each(['repeated template insertion', 'repeated copy', 'copy then user-project insertion'] as const)('%s sees accepted component files while ACK is indefinitely blocked', async scenario => {
  let outcomes: Array<{ ok: boolean }> = [];
  await act(async () => {
    if (scenario === 'repeated template insertion') outcomes = [await insert(template), await insert(template)];
    else if (scenario === 'repeated copy') outcomes = [await copy(), await copy()];
    else {
      const copied = await copy(); outcomes.push(copied);
      outcomes.push(await insert({ ...template, path: componentFile, source: 'user-project', category: '', props: [], slots: [], dependencies: [] }));
    }
  });
  expect(outcomes.map(outcome => outcome.ok)).toEqual([true, true]);
  expect(screen.queryByRole('status')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 0 });
  expect(runtime.read(page)).toBe('<main></main>\n');
  release(); await act(async () => { await flushDurableSourceWrites(projectId); });
  const expectedCount = scenario === 'repeated template insertion' ? 2 : scenario === 'repeated copy' ? 0 : 1;
  const source = runtime.read(page);
  expect((source.match(/<Hero\s*\/>/g) ?? []).length).toBe(expectedCount);
  expect((source.match(/import Hero from/g) ?? []).length).toBe(expectedCount ? 1 : 0);
  expect(runtime.read(componentFile)).toBe('<section>Hero</section>\n');
  const completedWrites = writes;
  runtime.restart(); db.close(); await db.open(); await flushDurableSourceWrites(projectId);
  expect(runtime.read(page)).toBe(source); expect(runtime.read(componentFile)).toBe('<section>Hero</section>\n');
  expect(writes).toBe(completedWrites); expect(await db.durableEdits.count()).toBe(2);
});

it('reads accepted relative component dependencies while copying and inserting before ACK', async () => {
  const child = { id: 'child', name: 'Child', html: '<span>Child</span>' } as ThemeComponentTemplate;
  const parentSource = "---\nimport Child from './Child.astro';\n---\n<section><Child /></section>";
  const parent = { ...template, html: parentSource };
  let inserted: { ok: boolean } | undefined;
  await act(async () => {
    expect((await copy(child)).ok).toBe(true); expect((await copy(parent)).ok).toBe(true);
    inserted = await insert({ ...parent, path: componentFile, source: 'user-project', category: '', props: [], slots: [], dependencies: [] });
  });
  expect(inserted?.ok).toBe(true); expect(screen.queryByRole('status')).toBeNull();
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 0 });
  release(); await act(async () => { await flushDurableSourceWrites(projectId); });
  expect(runtime.read(componentFile)).toBe(parentSource + '\n');
  expect(runtime.read('src/components/Child.astro')).toBe('<span>Child</span>\n');
  expect(runtime.read(page)).toContain('<Hero />');
  runtime.restart(); db.close(); await db.open(); await flushDurableSourceWrites(projectId);
  expect(runtime.read(componentFile)).toBe(parentSource + '\n'); expect(writes).toBe(3);
});

it('keeps component preparation visibility failures internal without a prepare-insert toast', async () => {
  let result: { ok: boolean } | undefined;
  await act(async () => {
    result = await insert({ ...template, source: 'user-project', path: 'src/components/Missing.astro', category: '', props: [], slots: [], dependencies: [] });
  });
  expect(result?.ok).toBe(false); expect(await db.durableEdits.count()).toBe(0);
  expect(screen.queryByRole('status')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
});
