/**
 * task-078: REPARENT_ELEMENT records a source-move on the host element so the
 * component editor's write-back (pushOverridesToSource → reparentOverrides →
 * applyWriteBackOverrides.moveElement) can persist a cross-parent reparent of a
 * source child to the .astro. Recording is gated: only instance-children of a
 * host that has `astroSource`, and only when the new parent is the SAME host or
 * root (cross-instance can't be expressed as one file's override). Encoding:
 * "childSelector>parentSelector", empty parent = root.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';

function setup(hostAstroSource: string | undefined): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const pages = doc.getMap('pages');
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('rootElementIds', new Y.Array());
    pages.set('page-1', page);

    const elements = doc.getMap('elements');
    const host = new Y.Map();
    host.set('id', 'host-1');
    host.set('pageId', 'page-1');
    if (hostAstroSource) host.set('astroSource', hostAstroSource);
    elements.set('host-1', host);
  }, 'sync');
  return doc;
}

function reparentRecords(doc: Y.Doc): string[] {
  const host = doc.getMap('elements').get('host-1') as Y.Map<unknown>;
  const arr = host.get('reparentOverrides') as Y.Array<string> | undefined;
  return arr ? arr.toArray() : [];
}

describe('REPARENT_ELEMENT — source-move recording', () => {
  it('records a same-host cross-parent move as "child>parent"', () => {
    const doc = setup('library/Hero.astro');
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT', pageId: 'page-1',
      elementKey: 'host-1:p-0', newParentKey: 'host-1:section-0', insertIndex: 0,
    });
    expect(reparentRecords(doc)).toEqual(['p-0>section-0']);
  });

  it('records a move to root (newParentKey=null) as "child>"', () => {
    const doc = setup('library/Hero.astro');
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT', pageId: 'page-1',
      elementKey: 'host-1:p-0', newParentKey: null, insertIndex: 0,
    });
    expect(reparentRecords(doc)).toEqual(['p-0>']);
  });

  it('treats a move to the host root itself as a top-level (root) move', () => {
    const doc = setup('library/Hero.astro');
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT', pageId: 'page-1',
      elementKey: 'host-1:p-0', newParentKey: 'host-1', insertIndex: 0,
    });
    expect(reparentRecords(doc)).toEqual(['p-0>']);
  });

  it('does NOT record a cross-instance move (different host — render-only)', () => {
    const doc = setup('library/Hero.astro');
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT', pageId: 'page-1',
      elementKey: 'host-1:p-0', newParentKey: 'other-1:div-0', insertIndex: 0,
    });
    expect(reparentRecords(doc)).toEqual([]);
  });

  it('does NOT record when the host has no astroSource', () => {
    const doc = setup(undefined);
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT', pageId: 'page-1',
      elementKey: 'host-1:p-0', newParentKey: 'host-1:section-0', insertIndex: 0,
    });
    expect(reparentRecords(doc)).toEqual([]);
  });

  it('last move wins: re-moving the same child replaces its prior record', () => {
    const doc = setup('library/Hero.astro');
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT', pageId: 'page-1',
      elementKey: 'host-1:p-0', newParentKey: 'host-1:section-0', insertIndex: 0,
    });
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT', pageId: 'page-1',
      elementKey: 'host-1:p-0', newParentKey: 'host-1:aside-0', insertIndex: 0,
    });
    expect(reparentRecords(doc)).toEqual(['p-0>aside-0']);
  });
});
