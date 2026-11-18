/**
 * Owner 2026-11-12 ("grid behaviour is very buggy"), proven live in the desktop
 * app: cards of a list that lives INSIDE a component, dragged on the page that
 * places it, moved on the canvas — and the page the site served still had them
 * in their old cells. A panel edit on such a card is written to the page as a
 * per-placement prop (`<Cards liClass="…" />`); the canvas grid commands
 * skipped that step, so the placement lived in the session only until some
 * later panel edit happened to flush it.
 */
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { acceptEditorCommands } from '@/store/commandGesture';
import type { EditorCommand } from '@/store/types';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';

const CARD = 'src/components/Cards.astro';
const KEY = `${CARD}:3:1~s4db83f82b016cfb0`;
const TARGET = { hops: [], element: { file: CARD, line: 3, column: 1 }, tagName: 'li', kind: 'class' };
const h = vi.hoisted(() => ({ planned: [] as Array<{ key?: string; value: string | null }>, stamped: [] as string[] }));
vi.mock('@/services/durableEdits/propOverrideCommands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/durableEdits/propOverrideCommands')>()),
  // The page places <Cards />: an edit on its card is an instance override.
  capturePropOverride: (key: string) => (key === KEY ? TARGET : null),
  preparePropOverrides: async (_projectId: string, _revision: number, items: Array<{ key?: string; value: string | null }>) => { h.planned.push(...items); return null; },
  stampMasterFileValue: (_doc: unknown, key: string) => { h.stamped.push(key); },
}));

let doc: Y.Doc;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  await db.delete(); await db.open();
  const projectId = `grid-prop-${crypto.randomUUID()}`;
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  runtime = projectFsRuntime(projectId, { [CARD]: "<ul>\n<li class='p-5 lg:col-span-3'></li>\n</ul>\n" });
  h.planned.length = 0; h.stamped.length = 0;
});
afterEach(() => { runtime.close(); doc.destroy(); resetClassWriteBaselines(); });

it.each([
  ['GRID_PLACE_ELEMENT', 'lg:col-start-4 lg:col-span-3', 'lg:row-start-2', 'p-5 lg:col-start-4 lg:col-span-3 lg:row-start-2'],
  ['SET_GRID_SPAN', 'lg:col-span-2', '', 'p-5 lg:col-span-2'],
] as const)('%s on a card inside a placed component is planned as a page prop', async (type, gridColumn, gridRow, classes) => {
  // Selecting the card registers it; the drag / resize comes later.
  const register: EditorCommand = { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: KEY, classes: 'p-5 lg:col-span-3', sourceLocation: { file: CARD, line: 3, column: 1 } };
  await acceptEditorCommands(doc, [register]);
  h.planned.length = 0; h.stamped.length = 0;
  await acceptEditorCommands(doc, [{ type, key: KEY, gridColumn, gridRow }]);
  expect(h.planned).toEqual([expect.objectContaining({ key: KEY, value: classes })]);
  expect(h.stamped).toEqual([KEY]); // the master's own classes are remembered for Reset / reopen
  expect(doc.getMap<Y.Map<unknown>>('sourceClasses').get(KEY)?.get('classes')).toBe(classes);
});
