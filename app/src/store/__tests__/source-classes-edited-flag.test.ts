/**
 * task-070: persist/export only genuinely-edited sourceClasses entries.
 *
 * REGISTER_SOURCE_ELEMENT creates an entry for EVERY element the user clicks
 * (storing its original classes); UPDATE_SOURCE_CLASSES fires only on a real
 * user edit. These tests pin the `edited: true` marker that is stamped
 * exclusively by UPDATE_SOURCE_CLASSES, so downstream persistence can tell
 * "registered" entries apart from "edited" ones.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { setClassWriteBaseline, resetClassWriteBaselines } from '@/services/classWriteBaseline';

const KEY = 'src/components/Hero.astro:5:1';

describe('UPDATE_SOURCE_CLASSES edited flag', () => {
  afterEach(resetClassWriteBaselines);
  it('REGISTER_SOURCE_ELEMENT does not mark the entry edited', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT', sourceKey: KEY, classes: 'p-4',
      sourceLocation: { file: 'src/components/Hero.astro', line: 5, column: 1 },
    });
    const entry = doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>;
    expect(entry.get('edited')).toBeUndefined();
  });

  it('UPDATE_SOURCE_CLASSES marks an existing entry edited', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT', sourceKey: KEY, classes: 'p-4',
      sourceLocation: { file: 'src/components/Hero.astro', line: 5, column: 1 },
    });
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY, classes: 'p-8', originalClasses: 'p-6' });
    const entry = doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>;
    expect(entry.get('classes')).toBe('p-8');
    expect(entry.get('edited')).toBe(true);
    expect(entry.get('baseClasses')).toBe('p-4'); // Existing registration remains the anchor.
  });

  it.each(['p-2', ''])('anchors a recreated entry to accepted original classes %j rather than stale file classes', originalClasses => {
    const doc = new Y.Doc();
    setClassWriteBaseline(KEY, 'p-4');
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY, classes: 'p-8', originalClasses });
    const entry = doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>;
    expect(entry.get('baseClasses')).toBe(originalClasses);
  });

  it('UPDATE_SOURCE_CLASSES marks a freshly-created entry edited', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY, classes: 'p-8', originalClasses: '' });
    const entry = doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>;
    expect(entry.get('edited')).toBe(true);
  });
});
