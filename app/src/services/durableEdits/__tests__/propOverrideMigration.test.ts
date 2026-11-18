/**
 * Overrides made before files carried them live only in the editor store —
 * export/deploy would drop them. After a scan they are written into files
 * (utils/propOverrides.ts), once, and a Push/Reset that removed the entry wins.
 */
import { it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

const files: Record<string, string> = {};
const accepted: { file: string; afterSource: string }[][] = [];
vi.mock('@/services/pendingProjectMutations', async (orig) => ({ ...(await orig<object>()), getActiveSaveProjectId: () => 'browser_p' }));
vi.mock('@/utils/localWriteScope', async (orig) => ({ ...(await orig<object>()), captureLocalWriteOrigin: () => ({ armed: true, pageFile: 'src/pages/index.astro' }) }));
vi.mock('../projectedSource', () => ({
  readProjectedSourceState: async (_p: string, f: string) => files[f] ?? null,
  withProjectedSource: async (_p: string, _r: number, run: () => Promise<unknown>) => run(),
}));
vi.mock('../acceptance', () => ({ inspectAcceptedProject: async (_p: string, read: (r: number) => Promise<unknown>) => read(1) }));
vi.mock('../fileAcceptance', () => ({
  acceptFileChanges: async (_f: string, plan: () => Promise<{ file: string; afterSource: string }[]>) => {
    const changes = await plan(); accepted.push(changes); for (const c of changes) files[c.file] = c.afterSource; return {};
  },
  finishAcceptedFiles: async () => ({}),
}));

import { migrateEditorOverrides } from '../propOverrideCommands';
import { noteScan } from '@/utils/propOverrides';
import { applyCommand } from '@/store/commands';

const CARD = 'src/components/Card.astro';
const KEY = `${CARD}:1:1~s1`;
const loc = (file: string, line: number, column: number) => ({ file, line, column });

beforeEach(() => {
  files[CARD] = '<h2 class="text-xl">Card title</h2>\n';
  files['src/pages/index.astro'] = '<Card />\n';
  accepted.length = 0;
  noteScan([{ key: KEY, parentKey: null, tagName: 'h2', sourceLocation: loc(CARD, 1, 1), usageLocation: loc('src/pages/index.astro', 1, 1) }]);
});

it('writes an editor-only class override into files once', async () => {
  const doc = new Y.Doc();
  applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: KEY, classes: 'text-xl', sourceLocation: loc(CARD, 1, 1) });
  applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY, classes: 'text-xl italic' });
  await migrateEditorOverrides(doc, new Set([KEY]));
  expect(files['src/pages/index.astro']).toBe('<Card h2Class="text-xl italic" />\n');
  expect(files[CARD]).toBe('<h2 class={Astro.props.h2Class ?? "text-xl"}>Card title</h2>\n');
  await migrateEditorOverrides(doc, new Set([KEY]));
  expect(accepted).toHaveLength(1);
});

it('a key not on this page, or already in files, writes nothing', async () => {
  const doc = new Y.Doc();
  applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: KEY, classes: 'text-xl', sourceLocation: loc(CARD, 1, 1) });
  applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY, classes: 'text-xl underline' });
  await migrateEditorOverrides(doc, new Set(['other']));
  expect(accepted).toHaveLength(0);
  files[CARD] = '<h2 class={Astro.props.h2Class ?? "text-xl"}>Card title</h2>\n';
  files['src/pages/index.astro'] = '<Card h2Class="text-xl underline" />\n';
  await migrateEditorOverrides(doc, new Set([KEY]));
  expect(accepted).toHaveLength(0);
});

it('a value migrated in an earlier session is never written again — a restored file stays restored (owner 2026-10-11)', async () => {
  const doc = new Y.Doc();
  applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: KEY, classes: 'text-xl', sourceLocation: loc(CARD, 1, 1) });
  applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY, classes: 'text-xl bg-red-500' });
  await migrateEditorOverrides(doc, new Set([KEY]));
  expect(accepted).toHaveLength(1);
  // The user restores the files (Versions → Restore / an older copy); the editor cache still holds the old edit.
  files[CARD] = '<h2 class="text-xl">Card title</h2>\n';
  files['src/pages/index.astro'] = '<Card />\n';
  vi.resetModules(); // a new session: the in-memory "written" set is gone
  (await import('@/utils/propOverrides')).noteScan([{ key: KEY, parentKey: null, tagName: 'h2', sourceLocation: loc(CARD, 1, 1), usageLocation: loc('src/pages/index.astro', 1, 1) }]);
  const fresh = await import('../propOverrideCommands');
  await fresh.migrateEditorOverrides(doc, new Set([KEY]));
  expect(accepted).toHaveLength(1);
  expect(files['src/pages/index.astro']).toBe('<Card />\n');
});
