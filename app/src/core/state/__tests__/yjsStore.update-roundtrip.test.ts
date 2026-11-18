// Guards the Option-A sync wire format (cloud-tier design §4): the doc must
// survive encodeStateAsUpdate → applyUpdate byte-for-byte semantically. If
// this breaks, server sync (Phase 2) and y-indexeddb persistence both break.
import * as Y from 'yjs';
import { describe, it, expect } from 'vitest';

describe('Yjs update round-trip (sync wire format)', () => {
  it('encodeStateAsUpdate → applyUpdate reproduces all top-level maps', () => {
    const a = new Y.Doc();
    a.getMap('pages').set('p1', 'x');
    a.getMap('masters').set('Hero.astro', 'm');
    a.getMap('sourceClasses').set('k', 'c');
    const update = Y.encodeStateAsUpdate(a);

    const b = new Y.Doc();
    Y.applyUpdate(b, update);
    expect(b.getMap('pages').get('p1')).toBe('x');
    expect(b.getMap('masters').get('Hero.astro')).toBe('m');
    expect(b.getMap('sourceClasses').get('k')).toBe('c');
  });

  it('round-trips nested Y.Map structures (element-shaped data)', () => {
    const a = new Y.Doc();
    const el = new Y.Map();
    el.set('tag', 'section');
    el.set('staticMarkup', '<section>hi</section>');
    a.getMap('elements').set('el-1', el);

    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const bEl = b.getMap('elements').get('el-1') as Y.Map<unknown>;
    expect(bEl.get('tag')).toBe('section');
    expect(bEl.get('staticMarkup')).toBe('<section>hi</section>');
  });

  it('merging two divergent updates keeps both sides (CRDT merge)', () => {
    const base = new Y.Doc();
    base.getMap('pages').set('shared', 'v0');
    const seed = Y.encodeStateAsUpdate(base);

    const devA = new Y.Doc();
    Y.applyUpdate(devA, seed);
    devA.getMap('pages').set('from-a', 1);

    const devB = new Y.Doc();
    Y.applyUpdate(devB, seed);
    devB.getMap('pages').set('from-b', 2);

    // apply remote then local — the Phase-2 reconnect order
    Y.applyUpdate(devA, Y.encodeStateAsUpdate(devB));
    expect(devA.getMap('pages').get('from-a')).toBe(1);
    expect(devA.getMap('pages').get('from-b')).toBe(2);
    expect(devA.getMap('pages').get('shared')).toBe('v0');
  });
});
