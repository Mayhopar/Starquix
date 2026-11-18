// @vitest-environment node
/**
 * An uploaded public file must be served by the time the upload answers.
 * Vite serves public/ only from a set its watcher fills. On Linux (per-directory
 * inotify) a public/ subdir the upload creates while chokidar's initial scan is
 * still running is never watched, so the file 404s for good — CI failed
 * desktop/test/supervisor.test.mjs that way (2026-10-13; macOS's recursive
 * FSEvents has no such window). whenServed must hand the watcher the event it
 * missed instead of waiting for one that never comes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { whenServed } from '../../../../preview-template/src/plugins/sq-project-fs-routes.js';

let httpServer: http.Server | null = null;
afterEach(() => new Promise<void>(done => (httpServer ? httpServer.close(() => done()) : done())));

describe('whenServed', () => {
  it("hands Vite's watcher the add it missed, and watches the new dir from then on", async () => {
    const publicDir = '/tmp/sq-project/public';
    const served = new Set<string>(); // = Vite's publicFiles, filled ONLY by watcher 'add'
    const watched: string[] = [];
    const watcher = Object.assign(new EventEmitter(), { add: (p: string) => { watched.push(p); return watcher; } });
    watcher.on('add', (file: string) => served.add(file.slice(publicDir.length)));
    httpServer = http.createServer((req, res) => { res.statusCode = served.has(req.url ?? '') ? 200 : 404; res.end(); });
    await new Promise<void>(r => httpServer!.listen(0, '127.0.0.1', r));

    const t0 = Date.now();
    await whenServed({ httpServer, config: { publicDir }, watcher }, '/uploads/a.png', 2000);

    expect(served.has('/uploads/a.png')).toBe(true);
    expect(watched).toEqual(['/tmp/sq-project/public/uploads']);
    expect(Date.now() - t0).toBeLessThan(1000); // never sits out the cap
  });

  it('a file the watcher already reported is left alone (no synthetic event)', async () => {
    const publicDir = '/tmp/sq-project/public';
    const events: string[] = [];
    const watcher = Object.assign(new EventEmitter(), { add: () => watcher });
    watcher.on('add', (f: string) => events.push(f));
    httpServer = http.createServer((_req, res) => { res.statusCode = 200; res.end(); });
    await new Promise<void>(r => httpServer!.listen(0, '127.0.0.1', r));

    await whenServed({ httpServer, config: { publicDir }, watcher }, '/uploads/b.png', 2000);

    expect(events).toEqual([]);
  });
});
