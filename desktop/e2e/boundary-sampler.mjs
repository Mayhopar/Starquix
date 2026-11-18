// Blank-frame sampler for seamless boundaries (plan Task 4.1/4.5, A4/A5): screenshots
// of the canvas region every ~50 ms; a sample is blank when its pixels are ~uniform.
import { createRequire } from 'node:module';
import path from 'node:path';
import { root } from './helpers.mjs';
const { PNG } = createRequire(path.resolve(root, '../package.json'))('pngjs');

/** Blank = brightness std-dev under this (both detectors). */
export const BLANK_SD = 2;
/** The canvas region both detectors judge (the canvas iframe's top-left, ≤600×400). */
export async function canvasClip(page) {
  const box = await page.locator('iframe[data-viewport]').first().boundingBox();
  return { x: box.x, y: box.y, width: Math.min(box.width, 600), height: Math.min(box.height, 400) };
}

export function isBlank(buffer) {
  const { data } = PNG.sync.read(buffer);
  let n = 0, sum = 0, sq = 0;
  for (let i = 0; i < data.length; i += 16) { const v = (data[i] + data[i + 1] + data[i + 2]) / 3; n++; sum += v; sq += v * v; }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean)) < BLANK_SD;
}

/** EVERY frame the window presents (main-process capture), from now until stop(): a
 *  screenshot takes ~100 ms, so sampleBlank misses a flash shorter than that. */
export async function watchFrames(app, page) {
  const clip = await canvasClip(page);
  const bw = await app.browserWindow(page);
  await bw.evaluate((w, { clip, blankSd }) => {
    const frames = globalThis.__sqFrames = [];
    const [cw] = w.getContentSize();
    w.webContents.beginFrameSubscription(false, image => {
      const s = image.getSize().width / cw;
      const data = image.crop({ x: Math.round(clip.x * s), y: Math.round(clip.y * s), width: Math.round(clip.width * s), height: Math.round(clip.height * s) })
        .resize({ width: 150 }).toBitmap();
      let n = 0, sum = 0, sq = 0;
      for (let i = 0; i < data.length; i += 4) { const v = (data[i] + data[i + 1] + data[i + 2]) / 3; n++; sum += v; sq += v * v; }
      const mean = sum / n;
      frames.push({ t: Date.now(), blank: Math.sqrt(Math.max(0, sq / n - mean * mean)) < blankSd, mean: Math.round(mean) });
    });
  }, { clip, blankSd: BLANK_SD });
  // task-272: a change that lands while the capturer delivers its first frame is dropped, and nothing redraws until the
  // next change (probe 2026-11-17: hide right after subscribing missed the hidden frame 4 of 20 times; after the first
  // frame + 50 ms, 0 of 20). Measure only once it has delivered.
  for (let i = 0; i < 200 && !(await bw.evaluate(() => globalThis.__sqFrames?.length)); i++) await page.waitForTimeout(10);
  await page.waitForTimeout(50);
  return {
    stop: () => bw.evaluate(w => { w.webContents.endFrameSubscription(); const f = globalThis.__sqFrames || []; globalThis.__sqFrames = null; return f; }),
  };
}

/** Frames → { frames, blank, blankAt: [ms epoch…] }. */
export function frameSummary(frames) {
  const blank = frames.filter(f => f.blank);
  return { frames: frames.length, blank: blank.length, blankAt: blank.map(f => f.t), means: [...new Set(blank.map(f => f.mean))] };
}

/** Sample the canvas area until `done()` resolves truthy, then `tailMs` more. */
export async function sampleBlank(page, done, { tailMs = 800, timeoutMs = 60_000 } = {}) {
  const clip = await canvasClip(page);
  const samples = []; const start = Date.now(); let doneAt = 0;
  while (Date.now() - start < timeoutMs) {
    const t = Date.now() - start;
    // Blank = no page on screen: a uniform canvas, OR the editor's boot spinner/cover
    // (not uniform, so the pixel test alone would miss it).
    const spinner = await page.getByText('Starting preview…', { exact: true }).isVisible().catch(() => false);
    const hidden = !(await page.locator('iframe[data-viewport]').first().isVisible().catch(() => false));
    const uniform = isBlank(await page.screenshot({ clip }));
    samples.push({ t, blank: spinner || hidden || uniform, why: spinner ? 'spinner' : hidden ? 'hidden' : uniform ? 'uniform' : '' });
    if (!doneAt && await done().catch(() => false)) doneAt = Date.now();
    if (doneAt && Date.now() - doneAt > tailMs) break;
    await page.waitForTimeout(50);
  }
  return { samples: samples.length, blank: samples.filter(s => s.blank).length, blankAt: samples.filter(s => s.blank).map(s => s.t + ':' + s.why), finished: !!doneAt };
}
