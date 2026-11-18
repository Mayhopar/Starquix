/**
 * A Fill-kind conversion of an element another file renders is an intentional
 * master edit (SourceMediaMutation.masterWrite). Its undo/redo record carries
 * that decision, so replay from the page view crosses the same surface instead
 * of refusing 'Structural replay belongs to another surface' (2026-09-20).
 */
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const accept = vi.fn(async () => ({ files: [] }));
vi.mock('../fileAcceptance', () => ({ acceptFileChanges: (...args: unknown[]) => accept(...args as []), preparePageFilePlan: vi.fn(), projectIdForFolder: vi.fn() }));
vi.mock('../sourceIdentity', () => ({ invertIdentityMaps: (maps: unknown[]) => maps, structuralIdentityMap: vi.fn() }));
vi.mock('@/utils/localWriteScope', () => ({ captureLocalWriteOrigin: () => ({ armed: true, pageFile: 'src/pages/index.astro' }), isCrossFileAtOrigin: (_o: unknown, file: string) => file !== 'src/pages/index.astro' }));

import { acceptStructuralReplay } from '../structuralReplayAcceptance';
import { mergeStructuralRecords } from '@/store/structuralUndo';

const doc = new Y.Doc(); doc.getMap('meta').set('projectId', 'browser_p');
const conversion = [{ file: 'src/components/Hero3.astro', beforeSource: '<img src="/a.png">', afterSource: '<div data-sq-image-fill="true"></div>', identityMaps: [{}] as never }];

describe('structural replay of a master edit', () => {
  it('refuses a cross-surface replay without the flag (the law), accepts it with the flag', async () => {
    await expect(acceptStructuralReplay(doc, [], conversion, 'before')).rejects.toThrow(/another surface/);
    expect(accept).not.toHaveBeenCalled();
    await acceptStructuralReplay(doc, [], conversion, 'before', undefined, true);
    expect(accept).toHaveBeenCalledTimes(1);
  });
  it('a merged undo entry keeps the flag when any step was a master edit', () => {
    const merged = mergeStructuralRecords([
      { structuralOp: { forward: [], inverse: [], sourceFiles: conversion, masterWrite: true } },
      { structuralOp: { forward: [], inverse: [], sourceFiles: [{ file: 'src/components/Hero3.astro', beforeSource: '<div data-sq-image-fill="true"></div>', afterSource: '<div data-sq-image-fill="true" class="bg-white"></div>', identityMaps: [] }] } },
    ]);
    expect(merged.structuralOp.masterWrite).toBe(true);
  });
});
