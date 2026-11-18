/** P0a M1 (instant-edit): an accepted class edit must not trigger the layout-library / folder-manifest
 * re-read (a second acceptance-lane job + a layout-plan POST per accepted revision). */
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { isLayoutNeutral } from '../layoutNeutral';
import { acceptProjectEdit } from '../acceptance';
import { getDurableEditStatus, subscribeDurableEditStatus } from '../status';
import type { DurableFileChange, MaterializationCommand } from '../types';

const change = (file: string, before: string | null = 'a', after: string | null = 'b'): DurableFileChange => ({ file, beforeSource: before, afterSource: after });
const classWrite = (file: string, prepared?: DurableFileChange[]): MaterializationCommand => ({ kind: 'class-write',
  payload: { sourceLocation: { file, line: 1, column: 1 }, newClasses: 'w-1', baseClasses: null, origin: null, preparedFiles: prepared } });
const fileBatch = (...files: DurableFileChange[]): MaterializationCommand => ({ kind: 'file-batch', payload: { files } });

describe('isLayoutNeutral', () => {
  it.each([
    ['no commands (a document-only edit)', [], true],
    ['a class write on a page', [classWrite('src/pages/index.astro')], true],
    ['a class write with prepared bytes on a page', [classWrite('src/pages/index.astro', [change('src/pages/index.astro')])], true],
    ['an in-place file batch of a page and a component (prop plumbing)', [fileBatch(change('src/pages/index.astro'), change('src/components/Photo.astro'))], true],
    ['a class write INSIDE a layout file', [classWrite('src/layouts/Base.astro')], false],
    ['a class write whose prepared bytes touch a layout', [classWrite('src/pages/a.astro', [change('src/layouts/Base.astro')])], false],
    ['a file batch that touches a layout', [fileBatch(change('src/pages/index.astro'), change('src/layouts/Base.astro'))], false],
    ['a file batch that touches the folder manifest', [fileBatch(change('.starquix/folders.json'))], false],
    ['a file batch that creates a file', [fileBatch(change('src/components/New.astro', null, 'x'))], false],
    ['a file batch that deletes a file', [fileBatch(change('src/components/Old.astro', 'x', null))], false],
    ['./src/layouts spelling', [fileBatch(change('./src/layouts/Base.astro'))], false],
    ['a layout append', [{ kind: 'layout-append', payload: { pageFile: 'src/pages/index.astro', markup: '<X />' } } as MaterializationCommand], false],
    ['a folder manifest write', [{ kind: 'folder-manifest', payload: { localPath: null, manifest: { version: 1, folders: [] } as never, preparedFiles: [] } } as MaterializationCommand], false],
    ['a source batch (text/structure can touch any file)', [{ kind: 'source-batch', payload: { payloads: [], skipped: [] } } as MaterializationCommand], false],
    ['a class write mixed with a non-file kind', [classWrite('src/pages/index.astro'), { kind: 'asset-write', payload: { assetId: 'a', name: 'a.png', mimeType: 'image/png', bytes: new Uint8Array(), projectFilePath: null } } as MaterializationCommand], false],
  ] as const)('%s', (_name, commands, expected) => {
    expect(isLayoutNeutral(commands as MaterializationCommand[])).toBe(expected);
  });
});

describe('accepted status', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  const accept = async (operationId: string, commands: MaterializationCommand[]) => {
    const doc = new Y.Doc(); let accepted: ReturnType<typeof getDurableEditStatus> | undefined;
    const stop = subscribeDurableEditStatus(() => { const s = getDurableEditStatus('neutral-project'); if (s.phase === 'accepted' && s.operationId === operationId) accepted = s; });
    await acceptProjectEdit(doc, { projectId: 'neutral-project', operationId, commands, mutate: staged => { staged.getMap('m').set(operationId, 1); } });
    stop(); doc.destroy();
    return accepted;
  };
  it('is published on the accepted status of a class edit', async () => {
    expect((await accept('class-1', [classWrite('src/pages/index.astro', [change('src/pages/index.astro')])]))?.layoutNeutral).toBe(true);
  });
  it('is false when the edit can change a layout', async () => {
    expect((await accept('layout-1', [fileBatch(change('src/layouts/Base.astro'))]))?.layoutNeutral).toBe(false);
  });
});
