/**
 * Writer is the signal (2026-11-08): a route's own write reaches Vite's watcher
 * at once; FSEvents' echo of the same bytes ~100 ms later is dropped.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
// @ts-expect-error plain-JS plugin
import { announceWrites } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

function setup() {
  const mtimes = new Map<string, number>();
  const stat = (f: string) => { if (!mtimes.has(f)) throw new Error('ENOENT'); return { mtimeMs: mtimes.get(f) }; };
  const watcher = new EventEmitter();
  const seen: string[] = [];
  watcher.on('change', (f: string) => seen.push(`change ${f}`));
  watcher.on('all', (ev: string, f: string) => seen.push(`all ${ev} ${f}`));
  const announce = announceWrites(watcher, stat);
  // chokidar's own delivery: emit(ev, path) then emit('all', ev, path)
  const chokidar = (f: string) => { watcher.emit('change', f); watcher.emit('all', 'change', f); };
  return { mtimes, watcher, seen, announce, chokidar };
}

describe('announceWrites', () => {
  it('announces a write once and drops the watcher echo of the same bytes', () => {
    const t = setup();
    t.mtimes.set('/p/src/pages/index.astro', 100);
    t.announce(['/p/src/pages/index.astro']);
    t.chokidar('/p/src/pages/index.astro'); // FSEvents echo, same mtime
    expect(t.seen).toEqual(['change /p/src/pages/index.astro', 'all change /p/src/pages/index.astro']);
  });

  it('passes a later write with a new mtime (an external edit)', () => {
    const t = setup();
    t.mtimes.set('/p/src/a.astro', 100);
    t.announce(['/p/src/a.astro']);
    t.mtimes.set('/p/src/a.astro', 200);
    t.chokidar('/p/src/a.astro');
    t.chokidar('/p/src/a.astro'); // no longer ours: every event passes
    expect(t.seen.filter(s => s.startsWith('change'))).toHaveLength(3);
  });

  it('never touches files it did not announce, or other events', () => {
    const t = setup();
    t.mtimes.set('/p/src/b.astro', 1);
    t.chokidar('/p/src/b.astro');
    t.watcher.emit('add', '/p/src/c.astro');
    t.announce(['/p/src/missing.astro']); // deleted before the announce: nothing to say
    expect(t.seen).toEqual(['change /p/src/b.astro', 'all change /p/src/b.astro']);
  });
});
