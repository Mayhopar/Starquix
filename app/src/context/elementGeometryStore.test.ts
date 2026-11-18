import { expect, it, vi } from 'vitest';
import { createElementGeometryStore } from './elementGeometryStore';
const rect = { top: 0, left: 0, width: 100, height: 50 };
it('keeps equal snapshots stable and notifies only changed keys once per atomic batch', () => {
  const store = createElementGeometryStore();
  store.replace([{ key: 'a', rect }, { key: 'b', rect }]);
  const a = vi.fn(), b = vi.fn(() => expect(store.get('a')?.width).toBe(120));
  const off = store.subscribe('a', a); store.subscribe('b', b);
  const previous = store.get('a');
  store.update([{ key: 'a', rect: { ...rect } }]);
  expect(store.get('a')).toBe(previous); expect(a).not.toHaveBeenCalled();
  store.update([{ key: 'b', rect: { ...rect, width: 110 } }, { key: 'a', rect: { ...rect, width: 120 } }, { key: 'b', rect: { ...rect, width: 130 } }]);
  expect(b).toHaveBeenCalledTimes(1); expect(a).toHaveBeenCalledTimes(1);
  off(); a.mockClear(); b.mockImplementation(() => {}); store.replace([{ key: 'a', rect }]);
  expect(a).not.toHaveBeenCalled(); expect(store.get('b')).toBeNull();
});
it('owns immutable snapshots and removes absent keys including clear', () => {
  const store = createElementGeometryStore(); const input = { ...rect };
  store.update([{ key: 'a', rect: input }]); const published = store.get('a');
  input.width = 900; expect(published?.width).toBe(100);
  const removed = vi.fn(() => expect(store.get('a')).toBeNull()); store.subscribe('a', removed);
  store.clear(); store.clear(); expect(removed).toHaveBeenCalledTimes(1);
  expect(published?.width).toBe(100);
});
it('notifies a derived overlay subscribed to several changed keys only once per batch', () => {
  const store = createElementGeometryStore();
  const listener = vi.fn();
  store.subscribe('a', listener); store.subscribe('b', listener);
  store.update([{ key: 'a', rect }, { key: 'b', rect }]);
  expect(listener).toHaveBeenCalledTimes(1);
});
