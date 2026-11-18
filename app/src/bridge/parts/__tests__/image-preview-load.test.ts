import { beforeEach, expect, it, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ImageBridge = HarnessBridge & {
  buildElementPayload(element: Element, options: object): { imagePreviewDataUrl?: string };
  handleRequestPreviewRefresh(payload: { key: string }): void;
  _makeThumbnail(element: Element): string | null;
};
const key = 'src/pages/index.astro:1:1';
let bridge: ImageBridge;
let img: HTMLImageElement;
let loaded: boolean;
beforeEach(() => {
  resetHarnessDom(); bridge = mountBridgeForTest() as ImageBridge;
  document.body.innerHTML = `<img data-key="${key}" src="/new.png"><p data-key="src/pages/index.astro:2:1">Other</p>`;
  img = document.querySelector('img')!; loaded = false;
  Object.defineProperties(img, { complete: { get: () => loaded }, naturalWidth: { get: () => loaded ? 32 : 0 } });
  bridge._makeThumbnail = vi.fn(() => 'data:image/jpeg;loaded');
});
const select = (element: Element = img) => bridge.buildElementPayload(element, { computedStyles: false });
const finishLoad = () => { loaded = true; img.dispatchEvent(new Event('load')); };
const previews = () => vi.mocked(bridge.sendToParent).mock.calls.map(([event]) => event).filter(event => (event as { type: string }).type === 'IMAGE_PREVIEW_REFRESH');

it('delivers the selected image thumbnail when its pixels load after selection and refresh', () => {
  expect(select().imagePreviewDataUrl).toBeUndefined();
  bridge.handleRequestPreviewRefresh({ key });
  finishLoad();
  expect(previews()).toEqual([{ type: 'IMAGE_PREVIEW_REFRESH', payload: { key, dataUrl: 'data:image/jpeg;loaded' } }]);
});
it.each(['src changed', 'node replaced', 'another selection'] as const)('does not publish a late thumbnail after %s', reason => {
  select();
  if (reason === 'src changed') img.src = '/newer.png';
  if (reason === 'node replaced') img.replaceWith(img.cloneNode());
  if (reason === 'another selection') select(document.querySelector('p')!);
  finishLoad();
  expect(previews()).toEqual([]);
});
it('keeps the immediate loaded-image payload', () => {
  loaded = true;
  expect(select().imagePreviewDataUrl).toBe('data:image/jpeg;loaded');
});
it('ignores an older capture request for another rendered node with the same source key', () => {
  const newer = img.cloneNode() as HTMLImageElement; document.body.appendChild(newer);
  Object.defineProperties(newer, { complete: { value: true }, naturalWidth: { value: 32 } });
  select(newer);
  bridge.handleRequestPreviewRefresh({ key }); // key lookup still finds the first rendered node
  finishLoad();
  expect(previews()).toEqual([]);
});
