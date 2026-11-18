import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { acceptProjectEdit } from '../acceptance';

// The runtime probe (desktop/probe/analyze.mjs) rebuilds every accept-lane phase from these nine marks; with one missing it silently
// drops the whole `acceptPhases` block and every service-time gate reads "no data". This pins the contract.
type Hook = (what: string, data?: Record<string, unknown>) => void;
const g = globalThis as unknown as { __sqProbeMark?: Hook };
const LANE_MARKS = ['acc:enter', 'acc:lane', 'acc:checkpoint', 'acc:prepared', 'acc:staged', 'acc:features', 'acc:identities', 'acc:stored', 'acc:published'];
const doc = () => { const d = new Y.Doc(); d.getMap('pages').set('p', 'old'); return d; };
const rename = (d: Y.Doc, v: string) => { d.getMap('pages').set('p', v); };

beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { delete g.__sqProbeMark; });

describe('accept lane probe marks', () => {
  it('marks the nine lane phases of one accepted edit, in order, when the recorder hook exists', async () => {
    const seen: string[] = [];
    g.__sqProbeMark = what => { seen.push(what); };
    await acceptProjectEdit(doc(), { projectId: 'probe-lane', operationId: 'op-aaaaaa', commands: [], mutate: staged => rename(staged, 'new') });
    expect(seen.filter(m => m.startsWith('acc:'))).toEqual(LANE_MARKS);
  });

  it('carries the byte size of the staged update and a short op id', async () => {
    const seen: Array<[string, Record<string, unknown> | undefined]> = [];
    g.__sqProbeMark = (what, data) => { seen.push([what, data]); };
    await acceptProjectEdit(doc(), { projectId: 'probe-lane', operationId: 'class-edit:12345678-abcdef', commands: [], mutate: staged => rename(staged, 'new') });
    expect(seen.find(([k]) => k === 'acc:enter')?.[1]).toEqual({ op: 'abcdef' });
    expect(seen.find(([k]) => k === 'acc:staged')?.[1]?.bytes).toBeGreaterThan(0);
  });

  it('accepts exactly the same without the hook (the marks never change the edit)', async () => {
    const d = doc();
    const accepted = await acceptProjectEdit(d, { projectId: 'probe-lane', operationId: 'op-bbbbbb', commands: [], mutate: staged => rename(staged, 'new') });
    expect(accepted.revision).toBe(1);
    expect(d.getMap('pages').get('p')).toBe('new');
  });
});
