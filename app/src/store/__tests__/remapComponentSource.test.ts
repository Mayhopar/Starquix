// Finding 26 (parity verify wave): promote/un-promote moves the component file
// but doc instances kept the OLD componentPath/astroSource — ↗ go-to-source and
// manifest lookups silently missed. REMAP_COMPONENT_SOURCE repoints them.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '../createEditorDoc';
import { applyCommand } from '../commands';

const OLD = 'library/Credit.astro';
const NEW = 'library/sq/Credit.astro';

function seedInstance(doc: Y.Doc, id: string, fields: Record<string, unknown>) {
  const el = new Y.Map();
  Object.entries(fields).forEach(([k, v]) => el.set(k, v));
  doc.getMap('elements').set(id, el);
}

describe('REMAP_COMPONENT_SOURCE', () => {
  it('rewrites componentPath and astroSource matching oldPath; leaves others alone', () => {
    const doc = createEditorDoc();
    seedInstance(doc, 'a', { componentPath: OLD, astroSource: OLD });
    seedInstance(doc, 'b', { componentPath: OLD });
    seedInstance(doc, 'c', { componentPath: 'library/Hero.astro', astroSource: 'library/Hero.astro' });

    applyCommand(doc, { type: 'REMAP_COMPONENT_SOURCE', oldPath: OLD, newPath: NEW });

    const els = doc.getMap('elements');
    expect((els.get('a') as Y.Map<unknown>).get('componentPath')).toBe(NEW);
    expect((els.get('a') as Y.Map<unknown>).get('astroSource')).toBe(NEW);
    expect((els.get('b') as Y.Map<unknown>).get('componentPath')).toBe(NEW);
    expect((els.get('c') as Y.Map<unknown>).get('componentPath')).toBe('library/Hero.astro');
    expect((els.get('c') as Y.Map<unknown>).get('astroSource')).toBe('library/Hero.astro');
  });

  it('un-promote is the same command with swapped args', () => {
    const doc = createEditorDoc();
    seedInstance(doc, 'a', { componentPath: NEW, astroSource: NEW });
    applyCommand(doc, { type: 'REMAP_COMPONENT_SOURCE', oldPath: NEW, newPath: OLD });
    const el = doc.getMap('elements').get('a') as Y.Map<unknown>;
    expect(el.get('componentPath')).toBe(OLD);
    expect(el.get('astroSource')).toBe(OLD);
  });

  it('elements without either field are untouched', () => {
    const doc = createEditorDoc();
    seedInstance(doc, 'plain', { type: 'container' });
    applyCommand(doc, { type: 'REMAP_COMPONENT_SOURCE', oldPath: OLD, newPath: NEW });
    const el = doc.getMap('elements').get('plain') as Y.Map<unknown>;
    expect(el.get('componentPath')).toBeUndefined();
    expect(el.get('astroSource')).toBeUndefined();
  });
});
