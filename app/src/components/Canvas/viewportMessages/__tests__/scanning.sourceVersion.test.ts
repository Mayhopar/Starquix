import { afterEach, describe, expect, it } from 'vitest';
import { handleElementsScanned } from '../scanning';
import { makeFakeCtx } from './fakeContext';
import { getClassWriteBaseline, resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests, getLocalSourceScanRevision, getLocalScanVersion, isLocalPageInSync, isLocalScanStaleAfterWrite, markLocalScanStaleAfterWrite, noteLocalAcceptedSourceRevision, setLocalExpectedRoute, setLocalPageFile } from '@/utils/localPageSync';
import type { MaterializationCommand } from '@/services/durableEdits/types';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';

const file = 'src/pages/index.astro';
const key = `${file}:1:1`;
const element = (sourceVersion: string, classes = '') => ({ key, tagName: 'p', classes, parentKey: null,
  sourceLocation: { file, line: 1, column: 1, sourceVersion }, rect: { top: 0, left: 0, width: 10, height: 10 } });
const write = (beforeVersion: string, afterVersion: string): MaterializationCommand[] => [{ kind: 'file-batch', payload: { files: [{ file, beforeSource: 'before', afterSource: 'after', identityMaps: [{ id: 'edit', beforeVersion, afterVersion, entries: [] }] }] } }];
afterEach(() => { setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); resetClassWriteBaselines(); });

/** 2026-09-16: a scan vouches by ROUTE alone. The token/document/revision
 * handshake (2026-09-14) refused every scan that did not echo a parent-issued
 * token, so structural ops refused ("Still switching pages") until it arrived. */
describe('scan admission by route', () => {
  function setup() {
    const ctx = makeFakeCtx();
    ctx.env.doc.getMap('meta').set('projectId', 'scan-project');
    setLocalExpectedRoute('/'); setLocalPageFile(file);
    return ctx;
  }
  it('admits an unsolicited startup scan whose route matches — no token needed', () => {
    const ctx = setup();
    handleElementsScanned(ctx, { route: '/', documentId: 'startup-doc', elements: [element('s1:10', 'p-1')] });
    expect(ctx.actions.setScannedElements).toHaveBeenCalledOnce();
    expect(getClassWriteBaseline(key)).toBe('p-1');
    expect(getLocalScanVersion()).toBe(1);
    expect(isLocalPageInSync()).toBe(true);
  });
  it('a scan from another route never vouches for this page', () => {
    const ctx = setup();
    handleElementsScanned(ctx, { route: '/about', documentId: 'other-doc', elements: [element('s1:10', 'p-1')] });
    expect(ctx.actions.setScannedElements).not.toHaveBeenCalled();
    expect(isLocalPageInSync()).toBe(false);
  });
  it('admits after navigation away and back, and after a project ABA visit', () => {
    setActiveSaveProjectId('scan-project');
    const ctx = setup();
    setLocalExpectedRoute('/about'); setLocalExpectedRoute('/');
    setActiveSaveProjectId('another-project'); setActiveSaveProjectId('scan-project');
    handleElementsScanned(ctx, { route: '/', documentId: 'old-doc', elements: [element('s1:10')] });
    expect(ctx.actions.setScannedElements).toHaveBeenCalledOnce();
    expect(isLocalPageInSync()).toBe(true);
  });
  it('an admitted scan carries the accepted revision and clears post-write staleness', () => {
    const ctx = setup();
    noteLocalAcceptedSourceRevision('scan-project', 1, write('s1:10', 's2:10'));
    markLocalScanStaleAfterWrite();
    handleElementsScanned(ctx, { route: '/', documentId: 'new-doc', elements: [element('s2:10', 'p-2')] });
    expect(ctx.actions.setScannedElements).toHaveBeenCalledOnce();
    expect(ctx.actions.setScannedElements.mock.calls[0][0][0].sourceLocation.sourceRevision).toBe(1);
    expect(getLocalSourceScanRevision()).toBe(1);
    expect(isLocalScanStaleAfterWrite()).toBe(false);
  });
  it('a scan rendered from an older source version is still admitted (identity maps project it downstream)', () => {
    const ctx = setup();
    noteLocalAcceptedSourceRevision('scan-project', 1, write('s1:10', 's2:10'));
    handleElementsScanned(ctx, { route: '/', documentId: 'old-doc', elements: [element('s1:10', 'p-1')] });
    expect(ctx.actions.setScannedElements).toHaveBeenCalledOnce();
    expect(isLocalPageInSync()).toBe(true);
  });
});
