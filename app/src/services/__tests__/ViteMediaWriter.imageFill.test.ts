import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { viteMediaWriter } from '../ViteMediaWriter';
import { setServerWriteMode } from '../serverWriteMode';
import { setLocalExpectedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
const loc = { file: 'src/components/Hero.astro', line: 2, column: 3 };
const page = 'src/pages/index.astro';
const imageFill = { expectedTag: '<img src="/hero.png" class="w-24 h-24">', change: { type: 'remove' as const } };
let postMessage: ReturnType<typeof vi.fn>;
let frame: HTMLIFrameElement;
beforeEach(() => {
  _resetLocalPageSyncForTests();
  postMessage = vi.fn(); frame = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
  setServerWriteMode(true); setLocalExpectedRoute('/'); setLocalPageFile(loc.file);
  viteMediaWriter.setIframeRef(frame); viteMediaWriter.setLocalInstanceState({ status: 'running', url: 'http://localhost:5100' });
});
afterEach(() => { viteMediaWriter.setIframeRef(null); viteMediaWriter.setLocalInstanceState(null); setServerWriteMode(false); _resetLocalPageSyncForTests(); });
it('preserves the atomic payload and acknowledges the full exact source receipt', async () => {
  const pending = viteMediaWriter.writeTagSwap(loc, 'image-fill', '', imageFill, { armed: true, pageFile: loc.file });
  const message = postMessage.mock.calls[0][0];
  expect(message.payload.imageFill).toEqual(imageFill);
  const receipt = { requestId: message.payload.requestId, success: true, changed: true, replacedLine: 2, originalLineCount: 1, replacedLineCount: 1, originalSegment: '<img>\n', replacementSegment: '<div></div>\n' };
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'SQ_WRITE_TAG_SWAP_RESULT', payload: receipt } }));
  expect(await pending).toEqual(receipt);
});
it('retains a captured page refusal after the user enters the component surface', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await viteMediaWriter.writeTagSwap(loc, 'image-fill', '', imageFill, { armed: true, pageFile: page })).toBe(false);
  expect(postMessage).not.toHaveBeenCalled(); warn.mockRestore();
});
