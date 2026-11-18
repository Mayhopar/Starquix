/**
 * V2 writer probe: a scan that finds a file-backed override the editor store does not know (an instance prop on a page, an imported project)
 * SEEDS the editor entry with the scanned class (seedFileOverride). That is one of the live-doc writers the probe has to tell apart from the
 * durable-edit acceptance; the mark `v2:seed` names it. A mark never changes the seed.
 */
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { handleElementsScanned } from '../scanning';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { localOverridesForPlacement } from '@/store/localMasterOverrides';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';

type Hook = (what: string, data?: Record<string, unknown>) => void;
const g = globalThis as unknown as { __sqProbeMark?: Hook };
const CARD = 'src/components/Card.astro';
const PLACEMENT = 's4db83f82b016cfb0';
const KEY = `${CARD}:4:1~${PLACEMENT}`;
const MASTER = 'card px-4';
const OVERRIDE = 'card px-4 opacity-90';
const scan = (classes: string, masterClasses?: string) => ({ key: KEY, parentKey: null, tagName: 'div', classes, masterClasses, sourceLocation: { file: CARD, line: 4, column: 1 },
  rect: { top: 0, left: 0, width: 10, height: 10 } });
const ctxFor = (doc: Y.Doc) => makeFakeCtx({ refs: { iframe: makeFakeIframe().iframe }, env: { doc } });

afterEach(() => { delete g.__sqProbeMark; resetClassWriteBaselines(); _resetLocalPageSyncForTests(); });

it('marks the scan seeding a file-backed class override into the editor entry', () => {
  const marks: Array<[string, Record<string, unknown> | undefined]> = [];
  g.__sqProbeMark = (what, data) => { marks.push([what, data]); };
  const doc = new Y.Doc();
  handleElementsScanned(ctxFor(doc), { elements: [scan(OVERRIDE, MASTER)] });
  expect(marks.filter(([k]) => k === 'v2:seed')).toEqual([['v2:seed', { key: KEY.slice(-14), now: OVERRIDE, master: MASTER }]]);
  expect(localOverridesForPlacement(doc, CARD, PLACEMENT).map(e => e.value)).toEqual([OVERRIDE]);
});

it('a scan that seeds nothing marks nothing, and the seed is the same without the hook', () => {
  const marks: string[] = [];
  g.__sqProbeMark = what => { marks.push(what); };
  const clean = new Y.Doc();
  handleElementsScanned(ctxFor(clean), { elements: [scan('px-4 card', MASTER)] });
  expect(marks.filter(k => k === 'v2:seed')).toEqual([]);
  delete g.__sqProbeMark;
  const doc = new Y.Doc();
  handleElementsScanned(ctxFor(doc), { elements: [scan(OVERRIDE, MASTER)] });
  expect(localOverridesForPlacement(doc, CARD, PLACEMENT).map(e => e.value)).toEqual([OVERRIDE]);
});
