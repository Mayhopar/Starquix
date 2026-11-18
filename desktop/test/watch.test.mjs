// Agent multiplayer (owner 2026-11-08, ledger E): every open project is watched,
// not only while its terminal is attached — an agent anywhere can write files.
import { afterEach, expect, it, vi } from 'vitest';
import { createWatchers } from '../src/watch.mjs';

afterEach(() => { vi.useRealTimers(); });

function rig(over = {}) {
  const events = []; const ws = [];
  const watch = vi.fn((dir, _opts, cb) => {
    const w = { dir, closed: false, close: () => { w.closed = true; }, fire: cb, on: (e, f) => { if (e === 'error') w.error = f; return w; } };
    ws.push(w); return w;
  });
  const read = vi.fn(async (_id, rels) => ({ files: Object.fromEntries(rels.map(r => [r, new Uint8Array([1])])), gone: [] }));
  const watchers = createWatchers({ read, emit: (...e) => events.push(e), watch, ...over });
  return { watchers, events, ws, watch, read };
}

it('E1/E2: watches an open project; one read per burst of changed paths; noise ignored; pushed as disk-changed', async () => {
  vi.useFakeTimers();
  const { watchers, ws, watch, read, events } = rig();
  watchers.keepOnly('p', '/S/p');
  expect(watch).toHaveBeenCalledWith('/S/p', { recursive: true }, expect.any(Function));
  for (const rel of ['src/pages/t.md', 'node_modules/x/i.js', '.astro/types.d.ts', '.claude/settings.local.json', 'src/pages/t.md', '.git/index', 'dist/a.html', 'public/a.png'])
    ws[0].fire('change', rel);
  ws[0].fire('rename', null);
  expect(read).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);
  expect(read.mock.calls).toEqual([['p', ['src/pages/t.md', 'public/a.png']]]);
  expect(events).toEqual([['disk-changed', 'p', { files: { 'src/pages/t.md': new Uint8Array([1]), 'public/a.png': new Uint8Array([1]) }, gone: [] }]]);
});

it('E1: one project at a time; reopening keeps the watcher; a released project stops after the grace', async () => {
  vi.useFakeTimers();
  const { watchers, ws } = rig({ graceMs: 1000 });
  watchers.keepOnly('a', '/S/a'); watchers.keepOnly('a', '/S/a');
  expect(ws).toHaveLength(1);
  watchers.keepOnly('b', '/S/b');
  expect(ws[0].closed).toBe(true); expect(ws).toHaveLength(2);
  watchers.release('b'); await vi.advanceTimersByTimeAsync(500);
  watchers.keepOnly('b', '/S/b'); await vi.advanceTimersByTimeAsync(1000); // reopened within the grace
  expect(ws[1].closed).toBe(false); expect(ws).toHaveLength(2);
  watchers.release('b'); await vi.advanceTimersByTimeAsync(1000);
  expect(ws[1].closed).toBe(true);
  watchers.closeAll();
});

it('E5: survives its own errors; an empty read pushes nothing; a burst after close pushes nothing', async () => {
  vi.useFakeTimers();
  const { watchers, ws, events } = rig({ read: async () => ({ files: {}, gone: [] }) });
  watchers.keepOnly('p', '/S/p'); ws[0].fire('change', 'src/a.md'); await vi.advanceTimersByTimeAsync(150);
  expect(events).toEqual([]);
  ws[0].error(new Error('EMFILE')); expect(ws[0].closed).toBe(true);
  ws[0].fire('change', 'src/b.md'); watchers.closeAll(); await vi.advanceTimersByTimeAsync(150);
  expect(events).toEqual([]);
});

it('E1: a new project is watched once its folder exists (the session opens before an import seeds it)', async () => {
  vi.useFakeTimers();
  let attempts = 0;
  const { watchers, ws, events } = rig({ watch: vi.fn((dir, _opts, cb) => {
    if (++attempts < 3) throw Object.assign(new Error(`ENOENT: no such file or directory, watch '${dir}'`), { code: 'ENOENT' });
    const w = { dir, closed: false, close: () => { w.closed = true; }, fire: cb, on: () => w }; ws.push(w); return w;
  }) });
  watchers.keepOnly('p', '/S/p');
  expect(ws).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(500);
  expect(ws).toHaveLength(1);
  ws[0].fire('change', 'src/a.md'); await vi.advanceTimersByTimeAsync(150);
  expect(events).toHaveLength(1);
  watchers.closeAll();
});

it('E1: a project closed while its folder is still missing stops retrying', async () => {
  vi.useFakeTimers();
  const watch = vi.fn(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
  const { watchers } = rig({ watch });
  watchers.keepOnly('p', '/S/p'); watchers.closeAll();
  const calls = watch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(watch.mock.calls.length).toBe(calls);
});
