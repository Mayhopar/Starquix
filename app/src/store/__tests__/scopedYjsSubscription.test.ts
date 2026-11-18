import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { subscribeYjsScopes } from '../scopedYjsSubscription';

describe('subscribeYjsScopes', () => {
  it('ignores another key and observes nested changes, deletion, replacement and cleanup', () => {
    const doc = new Y.Doc();
    const elements = doc.getMap('elements');
    const a = new Y.Map(); elements.set('a', a);
    const notify = vi.fn();
    const off = subscribeYjsScopes(doc, [{ map: 'elements', keys: ['a'] }], notify);
    elements.set('b', new Y.Map()); expect(notify).not.toHaveBeenCalled();
    a.set('classes', 'p-4'); expect(notify).toHaveBeenCalledTimes(1);
    const children = new Y.Array(); a.set('children', children);
    children.push(['child']); expect(notify).toHaveBeenCalledTimes(3);
    elements.delete('a'); expect(notify).toHaveBeenCalledTimes(4);
    const replacement = new Y.Map(); elements.set('a', replacement);
    replacement.set('classes', 'p-8'); expect(notify).toHaveBeenCalledTimes(6);
    off(); off(); elements.set('a', new Y.Map()); expect(notify).toHaveBeenCalledTimes(6);
    doc.destroy();
  });

  it('observes map membership and deep updates for whole-map scopes', () => {
    const doc = new Y.Doc(); const notify = vi.fn();
    const off = subscribeYjsScopes(doc, [{ map: 'elements' }], notify);
    const child = new Y.Map(); doc.getMap('elements').set('new', child);
    child.set('type', 'component'); doc.getMap('elements').delete('new');
    expect(notify).toHaveBeenCalledTimes(3);
    off(); doc.destroy();
  });

  it('does not subscribe empty scopes or empty key sets', () => {
    const doc = new Y.Doc(); const notify = vi.fn();
    const on = vi.spyOn(doc, 'on');
    const off = subscribeYjsScopes(doc, [], notify);
    const offKeys = subscribeYjsScopes(doc, [{ map: 'elements', keys: [] }], notify);
    doc.getMap('elements').set('a', 1);
    expect(notify).not.toHaveBeenCalled(); expect(on).not.toHaveBeenCalled();
    off(); offKeys(); doc.destroy();
  });

  it('flushes overlapping scopes once, synchronously after the full transaction', () => {
    const doc = new Y.Doc(); const values: unknown[][] = [];
    const off = subscribeYjsScopes(doc, [
      { map: 'elements' }, { map: 'elements', keys: ['a'] }, { map: 'meta' },
    ], () => values.push([doc.getMap('elements').get('a'), doc.getMap('meta').get('page')]));
    doc.transact(() => {
      doc.getMap('elements').set('a', 1); doc.getMap('meta').set('page', 'home');
      expect(values).toEqual([]);
    });
    expect(values).toEqual([[1, 'home']]); off(); doc.destroy();
  });

  it('keeps reentrant transactions separate and does not lose pending subscribers', () => {
    const doc = new Y.Doc(); const order: string[] = [];
    const offA = subscribeYjsScopes(doc, [{ map: 'elements' }], () => {
      order.push('elements'); doc.getMap('meta').set('page', 'next');
    });
    const offB = subscribeYjsScopes(doc, [{ map: 'elements' }, { map: 'meta' }], () => { order.push('both'); });
    doc.getMap('elements').set('a', 1);
    expect(order).toEqual(['elements', 'both', 'both']);
    offA(); offB(); doc.destroy();
  });

  it('removing a queued subscriber during notification prevents its callback', () => {
    const doc = new Y.Doc(); const removed = vi.fn();
    let offRemoved = () => {};
    const offFirst = subscribeYjsScopes(doc, [{ map: 'elements' }], () => offRemoved());
    offRemoved = subscribeYjsScopes(doc, [{ map: 'elements' }], removed);
    doc.getMap('elements').set('a', 1);
    expect(removed).not.toHaveBeenCalled(); offFirst(); doc.destroy();
  });

  it('shares map observers and removes them and the doc listener after the last consumer', () => {
    const doc = new Y.Doc(); const elements = doc.getMap('elements');
    const observe = vi.spyOn(elements, 'observeDeep'); const unobserve = vi.spyOn(elements, 'unobserveDeep');
    const on = vi.spyOn(doc, 'on'); const off = vi.spyOn(doc, 'off'); const remaining = vi.fn();
    const offA = subscribeYjsScopes(doc, [{ map: 'elements', keys: ['a'] }], () => {});
    const offB = subscribeYjsScopes(doc, [{ map: 'elements' }], remaining);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(on.mock.calls.filter(([event]) => event === 'afterTransaction')).toHaveLength(1);
    offA(); expect(unobserve).not.toHaveBeenCalled();
    elements.set('b', 2); expect(remaining).toHaveBeenCalledTimes(1);
    offB(); expect(unobserve).toHaveBeenCalledTimes(1);
    expect(off.mock.calls.filter(([event]) => event === 'afterTransaction')).toHaveLength(1);
    const offC = subscribeYjsScopes(doc, [{ map: 'elements' }], remaining);
    elements.set('c', 3); expect(remaining).toHaveBeenCalledTimes(2);
    offC(); doc.destroy();
  });
});
