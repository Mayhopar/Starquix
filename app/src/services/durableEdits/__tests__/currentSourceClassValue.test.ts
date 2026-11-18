/**
 * ⌘Z after "Reset to master" painted the MASTER over the restored override:
 * currentSourceClassValue treated the override as another element's entry
 * whenever the scan's counter (sourceRevision, bumped by every preview reload)
 * or a missing version differed — and every Reset reloads the preview.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { currentSourceClassValue } from '../sourceClassIdentity';

const FILE = 'src/components/Hero.astro';

function entry(classes: string, loc: Record<string, unknown>): Y.Map<unknown> {
  const doc = new Y.Doc();
  const e = new Y.Map<unknown>();
  doc.getMap('sourceClasses').set('k', e);
  e.set('classes', classes);
  e.set('sourceLocation', new Y.Map<unknown>(Object.entries(loc)));
  return e;
}

const scan = (sourceRevision: number, sourceVersion = 's164cb694:2139') => ({
  sourceLocation: { file: FILE, line: 7, column: 1, sourceVersion, sourceRevision },
  classes: 'py-12',
});

describe('currentSourceClassValue — which value a restored override paints', () => {
  it('same element, newer scan (preview reloaded): the OVERRIDE wins, not the scan', () => {
    const e = entry('py-24', { file: FILE, line: 7, column: 1, sourceVersion: 's164cb694:2139', sourceRevision: 20 });
    expect(currentSourceClassValue(e, scan(22), e.doc!)).toBe('py-24');
  });

  it('an unversioned doc-only overlay cannot be proven stale: the OVERRIDE wins', () => {
    const e = entry('py-24', { file: FILE, line: 7, column: 1 });
    expect(currentSourceClassValue(e, scan(22), e.doc!)).toBe('py-24');
  });

  it('a versioned owner of DIFFERENT file bytes is stale: the scan wins', () => {
    const e = entry('py-24', { file: FILE, line: 7, column: 1, sourceVersion: 'sOLD:1', sourceRevision: 20 });
    expect(currentSourceClassValue(e, scan(22), e.doc!)).toBe('py-12');
  });

  it('a versioned owner at different coordinates is stale: the scan wins', () => {
    const e = entry('py-24', { file: FILE, line: 9, column: 1, sourceVersion: 's164cb694:2139', sourceRevision: 22 });
    expect(currentSourceClassValue(e, scan(22), e.doc!)).toBe('py-12');
  });
});
