// desktop/probe/recorder.mjs in a real (jsdom) DOM: the canvas-side class-attribute log `cc` (T3) and the editor-side mark hook. The recorder is serialized into
// the page by Playwright, so it is evaluated here the same way: as source text inside a child frame's window.
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recorderInit } from '../probe/recorder.mjs';

const { JSDOM } = createRequire(path.resolve(import.meta.dirname, '../../app/package.json'))('jsdom');
const windows = [];
afterEach(() => { for (const w of windows.splice(0)) w.close(); });

/** The recorder in a CHILD frame of a jsdom page (role 'frame'), or in the top window (role 'editor'). Returns { win, chunks, start, flush }. */
function load({ top = false, body = '' } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${top ? body : '<iframe id="canvas"></iframe>'}</body>`, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' });
  windows.push(dom.window);
  const win = top ? dom.window : dom.window.document.getElementById('canvas').contentWindow;
  if (!top) win.document.body.innerHTML = body;
  const chunks = []; win.__probePush = chunk => chunks.push(chunk);
  win.eval(`(${recorderInit.toString()})()`);
  return { win, chunks, start: cfg => win.__PR.start(cfg), flush: () => win.__PR.flush(false).data };
}
const settle = () => new Promise(r => setTimeout(r, 20)); // MutationObserver callbacks are microtasks; let them run

describe('recorder: the canvas class log `cc` records the class attribute of ANY element, with the value after each mutation', () => {
  it('records probe images (with their number) and other elements (with tag and id), one record per class change, old and new value', async () => {
    const { win, start, flush } = load({ body: '<section id="hero" class="mt-6"><img alt="Probe image 2" class="w-full rounded"><p class="a">x</p></section>' });
    start({ nImages: 2 });
    const doc = win.document;
    doc.querySelector('img').setAttribute('class', 'w-[3px] rounded');
    doc.querySelector('p').setAttribute('class', 'a b');
    await settle();
    const data = flush();
    expect(data.cc.map(({ id, ...rest }) => rest)).toEqual([
      expect.objectContaining({ n: 2, eid: '', tag: 'IMG', old: 'w-full rounded', val: 'w-[3px] rounded' }),
      expect.objectContaining({ n: null, eid: '', tag: 'P', old: 'a', val: 'a b' }),
    ]);
    expect(data.cc[0].id).not.toBe(data.cc[1].id);
    expect(data.cls).toEqual([expect.objectContaining({ n: 2, attr: 'class', old: 'w-full rounded', val: 'w-[3px] rounded' })]); // the old probe-image log is unchanged
  });

  it('chains the values of several writes that land in one batch: each record carries ITS value, not the DOM value at callback time', async () => {
    const { win, start, flush } = load({ body: '<img alt="Probe image 1" class="w-full">' });
    start({ nImages: 1 });
    const img = win.document.querySelector('img');
    img.setAttribute('class', 'w-[3px]'); img.setAttribute('class', 'w-[30px]'); img.setAttribute('class', 'w-[300px]'); // one task, one observer callback
    await settle();
    const data = flush();
    expect(data.cc.map(c => [c.old, c.val])).toEqual([['w-full', 'w-[3px]'], ['w-[3px]', 'w-[30px]'], ['w-[30px]', 'w-[300px]']]);
    expect(new Set(data.cc.map(c => c.id)).size).toBe(1); // one element, one id
    expect(data.cls.map(c => c.val)).toEqual(['w-[300px]', 'w-[300px]', 'w-[300px]']); // why `cls` cannot be used for T3: every record of a batch shows the last value
  });

  it('keeps elements apart when their writes interleave in one batch, and records the id of an element that has one (#fx)', async () => {
    const { win, start, flush } = load({ body: '<div id="fx" class="h-40 bg-cover"></div><img alt="Probe image 1" class="w-full">' });
    start({ nImages: 1 });
    const fx = win.document.getElementById('fx'); const img = win.document.querySelector('img');
    fx.setAttribute('class', 'h-40 bg-contain'); img.setAttribute('class', 'w-1'); fx.setAttribute('class', 'h-40 bg-cover'); img.setAttribute('class', 'w-2');
    await settle();
    const cc = flush().cc;
    expect(cc.filter(c => c.eid === 'fx').map(c => [c.old, c.val])).toEqual([['h-40 bg-cover', 'h-40 bg-contain'], ['h-40 bg-contain', 'h-40 bg-cover']]);
    expect(cc.filter(c => c.n === 1).map(c => [c.old, c.val])).toEqual([['w-full', 'w-1'], ['w-1', 'w-2']]);
  });

  it('a same-string write is recorded as a record with old equal to val (the analysis counts it apart as noop)', async () => {
    const { win, start, flush } = load({ body: '<img alt="Probe image 1" class="w-full">' });
    start({ nImages: 1 });
    win.document.querySelector('img').setAttribute('class', 'w-full');
    await settle();
    expect(flush().cc).toEqual([expect.objectContaining({ old: 'w-full', val: 'w-full' })]);
  });
});

describe('recorder: the editor mark hook', () => {
  it('records marks while running, drops a v2:write with no class write, and removes the hook on stop', async () => {
    const { win, start, flush } = load({ top: true });
    start({ nImages: 1 });
    win.__sqProbeMark('cls:set', { key: 'k', cls: 'w-[3px]', op: 'abc123' });
    win.__sqProbeMark('v2:write', { origin: 'sync', w: [] });
    win.__sqProbeMark('v2:write', { origin: 'durable-edit:…abc123', w: [{ key: 'k', act: 'update', now: 'w-[3px]' }] });
    const ev = flush().ev.filter(e => e.what !== 'start');
    expect(ev.map(e => e.what)).toEqual(['cls:set', 'v2:write']);
    expect(ev[1].w).toHaveLength(1);
    win.__PR.stop();
    expect(win.__sqProbeMark).toBeUndefined();
  });
});
