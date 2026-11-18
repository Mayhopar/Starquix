import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useImageFill, type ImageFillInput } from './useImageFill';
import { swapElementTagWithUndo } from '../../../../../preview-template/src/plugins/sq-source-plugin.js';
import { _resetStructuralWriteInFlightForTests } from '@/store/structuralWriteGuard';

const mocks = vi.hoisted(() => ({ read: vi.fn(), upload: vi.fn(), write: vi.fn(), flush: vi.fn(async () => {}), origin: vi.fn(() => ({ armed: true, pageFile: 'src/pages/index.astro' })) }));
vi.mock('@/utils/sqLocalBase', () => ({ localFetch: mocks.read }));
vi.mock('@/utils/imageUpload', () => ({ uploadLocalAssetFile: mocks.upload }));
vi.mock('@/services/ViteMediaWriter', () => ({ viteMediaWriter: { writeTagSwap: mocks.write } }));
vi.mock('@/utils/pendingSourceWrites', () => ({ flushPendingSourceWrites: mocks.flush }));
vi.mock('@/utils/localWriteScope', async importOriginal => ({ ...(await importOriginal<typeof import('@/utils/localWriteScope')>()), captureLocalWriteOrigin: mocks.origin }));
let source: string;
let input: ImageFillInput;
beforeEach(() => {
  vi.clearAllMocks(); _resetStructuralWriteInFlightForTests();
  source = '<img src="/hero.png" alt="Mountain" class="w-64 h-40 object-cover">';
  mocks.read.mockImplementation(async () => new Response(source));
  mocks.upload.mockResolvedValue({ src: '/uploads/new.png', previewUrl: '/uploads/new.png' });
  mocks.write.mockImplementation(async (_location, _kind, _src, imageFill) => {
    const receipt = await swapElementTagWithUndo(source, { line: 1, column: 1 }, 'image-fill', '', imageFill);
    source = receipt.updated; return receipt.extra;
  });
  input = { ownerId: 'project/page/image', projectId: 'browser_lf_test', sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 }, tagName: 'img', classes: 'w-64 h-40 object-cover', variant: '', preview: null, imageSrc: '/hero.png', imageAlt: 'Mountain',
    geometry: { display: 'block', boxSizing: 'border-box', maxWidth: 'none', objectFit: 'cover', objectPosition: '50% 50%', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px' },
    onClassesChange: vi.fn(), onSourceClasses: vi.fn(), pushStructuralUndo: vi.fn() };
});
it('Figma model: an <img> Fill renders from the selection immediately — no source read, no write, no Undo, no gate', async () => {
  mocks.read.mockRejectedValue(new Error('projected source refused'));
  const { result } = renderHook(() => useImageFill(input));
  expect(result.current.state).toMatchObject({ target: 'native', src: '/hero.png', description: 'Mountain', fit: 'cover' });
  await act(async () => {});
  expect(result.current.state.target).toBe('native');
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); expect(input.pushStructuralUndo).not.toHaveBeenCalled(); expect(mocks.flush).not.toHaveBeenCalled();
});
it('a fit edit on an <img> is an object-* class change — no source conversion, no write, no structural undo', async () => {
  const { result } = renderHook(() => useImageFill(input)); await waitFor(() => expect(result.current.state.target).toBe('native'));
  await act(async () => { await result.current.apply({ type: 'fit', value: 'contain' }); });
  expect(input.onClassesChange).toHaveBeenCalledWith('w-64 h-40 object-contain');
  expect(mocks.write).not.toHaveBeenCalled(); expect(input.pushStructuralUndo).not.toHaveBeenCalled(); expect(result.current.state.fit).toBe('contain');
});
it('an <img> with intrinsic sizing (h-auto) still takes a replacement — Figma model, no geometry gate', async () => {
  source = source.replace('h-40', 'h-auto');
  const onImageAttribute = vi.fn(); input = { ...input, classes: 'w-64 h-auto object-cover', onImageAttribute };
  const { result } = renderHook(() => useImageFill(input)); await waitFor(() => expect(result.current.state.target).toBe('native'));
  await act(async () => { await result.current.chooseFile(new File(['x'], 'new.png', { type: 'image/png' })); });
  expect(mocks.upload).toHaveBeenCalledTimes(1); expect(onImageAttribute).toHaveBeenCalledWith('src', '/uploads/new.png'); expect(mocks.write).not.toHaveBeenCalled();
  expect(result.current.state.src).toBe('/uploads/new.png'); expect(result.current.issue).toBeNull();
});
it('an upload cannot mutate a new selection or show its preview there', async () => {
  let finish!: (result: { src: string; previewUrl: string }) => void;
  mocks.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook((props: ImageFillInput) => useImageFill(props), { initialProps: input }); await waitFor(() => expect(result.current.state.target).toBe('native'));
  let pending!: Promise<void>;
  act(() => { pending = result.current.chooseFile(new File(['x'], 'new.png', { type: 'image/png' })); });
  await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
  rerender({ ...input, ownerId: 'project/page/other', preview: 'data:image/png;base64,other' });
  await act(async () => { finish({ src: '/uploads/new.png', previewUrl: '/uploads/new.png' }); await pending; });
  expect(mocks.write).not.toHaveBeenCalled(); expect(result.current.state.preview).toBe('data:image/png;base64,other');
});
it('background upload merges into fresh classes without converting its container — and replaces the colour (exclusive kinds)', async () => {
  let classes = 'w-24 h-24 bg-black';
  input = { ...input, tagName: 'div', classes, getCurrentClasses: () => classes };
  mocks.upload.mockImplementationOnce(async () => { classes += ' rounded-lg'; return { src: '/uploads/new.png', previewUrl: '/uploads/new.png' }; });
  const { result } = renderHook(() => useImageFill(input));
  await act(async () => { await result.current.chooseFile(new File(['x'], 'new.png', { type: 'image/png' })); });
  expect(input.onClassesChange).toHaveBeenCalledWith(expect.stringContaining('rounded-lg'));
  expect(input.onClassesChange).toHaveBeenCalledWith(expect.not.stringContaining('bg-black'));
  expect(input.onClassesChange).toHaveBeenCalledWith(expect.stringContaining("bg-[url('/uploads/new.png')]")); expect(mocks.write).not.toHaveBeenCalled();
});
it('an <img> replacement without an attribute channel reports a plain failure and keeps the current image', async () => {
  const { result } = renderHook(() => useImageFill(input)); await waitFor(() => expect(result.current.state.target).toBe('native'));
  await act(async () => { await result.current.chooseFile(new File(['x'], 'new.png', { type: 'image/png' })); });
  expect(result.current.issue?.title).toBe("Image uploaded. Fill wasn't changed."); expect(result.current.state.src).toBe('/hero.png');
  expect(mocks.write).not.toHaveBeenCalled(); expect(input.pushStructuralUndo).not.toHaveBeenCalled();
});
it('does not write an unchanged field value', async () => {
  const onImageAttribute = vi.fn(); input = { ...input, onImageAttribute };
  const { result } = renderHook(() => useImageFill(input)); await waitFor(() => expect(result.current.state.target).toBe('native'));
  await act(async () => { await result.current.apply({ type: 'description', value: 'Mountain' }); await result.current.apply({ type: 'fit', value: 'cover' }); });
  expect(onImageAttribute).not.toHaveBeenCalled(); expect(input.onClassesChange).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
});
it('the description of an <img> is its alt attribute (image override tier), independent of a class edit', async () => {
  const onImageAttribute = vi.fn(); input = { ...input, onImageAttribute };
  const { result } = renderHook(() => useImageFill(input)); await waitFor(() => expect(result.current.state.target).toBe('native'));
  await act(async () => { await result.current.apply({ type: 'fit', value: 'contain' }); await result.current.apply({ type: 'description', value: 'New mountain' }); });
  expect(input.onClassesChange).toHaveBeenCalledWith('w-64 h-40 object-contain'); expect(onImageAttribute).toHaveBeenCalledWith('alt', 'New mountain');
  expect(source).toContain('<img'); expect(result.current.issue).toBeNull();
});
it('a computed image without a supported class is not presented as no image', async () => {
  input = { ...input, tagName: 'div', classes: 'w-60 h-40', computedBackgroundImage: 'url("/authored.png")' };
  const { result } = renderHook(() => useImageFill(input));
  expect(result.current.state.target).toBe('unsupported');
  await act(async () => { await result.current.chooseFile(new File(['x'], 'new.png', { type: 'image/png' })); });
  expect(mocks.upload).not.toHaveBeenCalled(); expect(input.onClassesChange).not.toHaveBeenCalled();
});

it('an <img> over a composed background is still edited in place (no geometry gate)', async () => {
  input.geometry = { ...input.geometry, backgroundImage: 'url("/behind.png")' };
  const { result } = renderHook(() => useImageFill(input)); await waitFor(() => expect(result.current.state.target).toBe('native'));
  expect(mocks.write).not.toHaveBeenCalled();
});
it.each([
  { classes: "bg-[url('/hero.png')]", computedBackgroundImage: 'url("/other.png")' },
  { classes: "bg-[url('/hero.png')]", computedBackgroundImage: 'url("/hero.png"), url("/behind.png")' },
  { classes: "bg-[url('/hero.png')] bg-[url('/behind.png')]", computedBackgroundImage: 'url("/hero.png")' },
])('authored or composed backgrounds remain read-only: $computedBackgroundImage', async background => {
  input = { ...input, ...background, tagName: 'div' };
  const { result } = renderHook(() => useImageFill(input));
  expect(result.current.state.target).toBe('unsupported');
  await act(async () => { await result.current.chooseFile(new File(['x'], 'new.png', { type: 'image/png' })); });
  expect(mocks.upload).not.toHaveBeenCalled();
});

it('instance edit (Figma model): a color Fill on an element another file renders here reaches the class override tier — never a refusal', async () => {
  let classes = 'py-12 bg-stone-100';
  input = { ...input, tagName: 'section', sourceLocation: { file: 'src/components/Feature.astro', line: 4, column: 1 }, classes, getCurrentClasses: () => classes };
  const { result } = renderHook(() => useImageFill(input));
  await waitFor(() => expect(result.current.state.target).toBe('background'));
  await act(async () => { await result.current.apply({ type: 'color', value: 'bg-red-500' }); });
  expect(result.current.issue).toBeNull();
  expect(input.onClassesChange).toHaveBeenCalledWith(expect.stringContaining('bg-red-500'));
  expect(mocks.write).not.toHaveBeenCalled();
});
it('instance edit: replacing a native <img> another file renders here takes the image override tier, not a source rewrite', async () => {
  const onImageAttribute = vi.fn();
  input = { ...input, sourceLocation: { file: 'src/components/Feature.astro', line: 1, column: 1 }, onImageAttribute };
  const { result } = renderHook(() => useImageFill(input));
  await waitFor(() => expect(result.current.state.target).toBe('native'));
  await act(async () => { await result.current.apply({ type: 'replace', src: '/uploads/other.png' }); });
  expect(onImageAttribute).toHaveBeenCalledWith('src', '/uploads/other.png');
  expect(mocks.write).not.toHaveBeenCalled(); expect(result.current.issue).toBeNull();
});

it('Figma model: fill kinds are exclusive — a COLOR on an <img> makes it a plain container with only that colour; REMOVE makes it a container with no fill', async () => {
  source = '<img src="/hero.png" alt="Mountain" class="w-full h-auto rounded-lg">';
  const onImageAttribute = vi.fn(); input = { ...input, classes: 'w-full h-auto rounded-lg', box: () => ({ width: 1200, height: 675 }), onImageAttribute };
  const { result } = renderHook(() => useImageFill(input));
  await act(async () => { await result.current.apply({ type: 'color', value: 'bg-white' }); });
  expect(result.current.issue).toBeNull(); expect(mocks.write).toHaveBeenCalledTimes(1); expect(onImageAttribute).not.toHaveBeenCalled();
  expect(source).toMatch(/^<div data-sq-image-fill="true" class="w-full rounded-lg aspect-\[16\/9\] bg-white"><\/div>$/);
  expect(result.current.state.target).toBe('owned'); expect(result.current.state.src).toBe('');
  source = '<img src="/hero.png" alt="Mountain" class="w-64 h-40">'; input = { ...input, classes: 'w-64 h-40' };
  const removed = renderHook(() => useImageFill({ ...input, ownerId: 'project/page/other' }));
  await act(async () => { await removed.result.current.apply({ type: 'remove' }); });
  expect(source).toBe('<div data-sq-image-fill="true" class="w-64 h-40"></div>'); expect(onImageAttribute).not.toHaveBeenCalled();
});
it('an <img> another file renders here: COLOR converts THAT file (the component) — the tag changes end-to-end, no override, no toast', async () => {
  source = '<img src="/hero.png" alt="Mountain" class="w-full h-auto rounded-lg">';
  const onImageAttribute = vi.fn(); const onSourceImageReset = vi.fn();
  input = { ...input, classes: 'w-full h-auto rounded-lg', box: () => ({ width: 1200, height: 675 }), sourceLocation: { file: 'src/components/Hero3.astro', line: 1, column: 1 }, onImageAttribute, onSourceImageReset };
  const { result } = renderHook(() => useImageFill(input));
  await act(async () => { await result.current.apply({ type: 'color', value: 'bg-red-300' }); });
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(mocks.write.mock.calls[0][0]).toEqual({ file: 'src/components/Hero3.astro', line: 1, column: 1 });
  // an honest master edit: the page origin plus the masterWrite flag
  expect(mocks.write.mock.calls[0][4]).toEqual({ armed: true, pageFile: 'src/pages/index.astro' }); expect(mocks.write.mock.calls[0][5]).toBe(true);
  expect(source).toBe('<div data-sq-image-fill="true" class="w-full rounded-lg aspect-[16/9] bg-red-300"></div>');
  expect(result.current.state.target).toBe('owned'); expect(onImageAttribute).not.toHaveBeenCalled(); expect(onSourceImageReset).toHaveBeenCalled(); expect(result.current.issue).toBeNull();
  // and back: an image on that container converts the component file again
  await act(async () => { await result.current.apply({ type: 'replace', src: '/uploads/next.png' }); });
  expect(mocks.write).toHaveBeenCalledTimes(2); expect(mocks.write.mock.calls[1][5]).toBe(true);
  expect(source).toBe('<img src="/uploads/next.png" alt="" class="w-full rounded-lg aspect-[16/9] object-cover">'); expect(result.current.state.target).toBe('native');
});
it('an <img> whose source refuses a rewrite (an astro <Image> usage) still leaves the design on COLOR — painted in place', async () => {
  source = '<Image src={hero} alt="Mountain" class="w-64 h-40" />';
  const onImageAttribute = vi.fn(); input = { ...input, classes: 'w-64 h-40', onImageAttribute };
  const { result } = renderHook(() => useImageFill(input));
  await act(async () => { await result.current.apply({ type: 'color', value: 'bg-red-300' }); });
  expect(mocks.write).not.toHaveBeenCalled(); expect(result.current.issue).toBeNull();
  // '' is an honest override now (the store keeps it; the bridge sets src="" → an empty, sized, painted box)
  expect(input.onClassesChange).toHaveBeenCalledWith('w-64 h-40 bg-red-300'); expect(onImageAttribute).toHaveBeenCalledWith('src', '');
});
it('Figma model: a GRADIENT on an <img> converts it under the hood into a container (image gone, box kept); choosing an image again converts it back to an <img>', async () => {
  source = '<img src="/hero.png" alt="Mountain" class="w-full h-auto rounded-lg" loading="lazy">';
  const onImageAttribute = vi.fn(); const onSourceImageReset = vi.fn(); input = { ...input, classes: 'w-full h-auto rounded-lg', box: () => ({ width: 1200, height: 675 }), onImageAttribute, onSourceImageReset };
  const { result } = renderHook(() => useImageFill(input));
  await act(async () => { await result.current.apply({ type: 'gradient', value: 'bg-gradient-to-r from-pink-500 to-yellow-500' }); });
  expect(result.current.issue).toBeNull(); expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(source).toMatch(/^<div data-sq-image-fill="true" class="w-full rounded-lg aspect-\[16\/9\] bg-gradient-to-r from-pink-500 to-yellow-500"><\/div>$/);
  expect(result.current.state.target).toBe('owned'); expect(input.onSourceClasses).toHaveBeenCalledWith('w-full rounded-lg aspect-[16/9] bg-gradient-to-r from-pink-500 to-yellow-500');
  await act(async () => { await result.current.apply({ type: 'replace', src: '/uploads/next.png' }); });
  expect(result.current.issue).toBeNull(); expect(mocks.write).toHaveBeenCalledTimes(2);
  expect(source).toMatch(/^<img src="\/uploads\/next.png" alt="" class="w-full rounded-lg aspect-\[16\/9\] object-cover">$/);
  expect(result.current.state).toMatchObject({ target: 'native', src: '/uploads/next.png', fit: 'cover' });
  expect(onImageAttribute).not.toHaveBeenCalled(); expect(onSourceImageReset).toHaveBeenCalledTimes(2);
});

it('a COLOR on a box with an image fill removes the image tokens (exclusive kinds)', async () => {
  input = { ...input, tagName: 'div', classes: "w-24 h-24 bg-[url('/a.png')] bg-cover bg-center bg-no-repeat", geometry: { ...input.geometry, backgroundImage: 'url("/a.png")' } };
  const { result } = renderHook(() => useImageFill(input));
  await act(async () => { await result.current.apply({ type: 'color', value: 'bg-white' }); });
  expect(input.onClassesChange).toHaveBeenCalledWith('w-24 h-24 bg-white');
});

it('a structural write publishes its result to the selection in the same tick (tag, classes, src, alt, preview) — the panel never sees a stale tag', async () => {
  source = '<div data-sq-image-fill="true" class="w-64 h-40 bg-white"></div>';
  let classes = 'w-64 h-40 bg-white';
  const onSourceConverted = vi.fn();
  const base: ImageFillInput = { ...input, tagName: 'div', classes, geometry: { ...input.geometry, imageFillOwned: true }, getCurrentClasses: () => classes, onSourceClasses: vi.fn(next => { classes = next; }), onSourceConverted };
  const { result, rerender } = renderHook((props: ImageFillInput) => useImageFill(props), { initialProps: base });
  await act(async () => { await result.current.chooseFile(new File(['x'], 'new.png', { type: 'image/png' })); });
  expect(onSourceConverted).toHaveBeenCalledWith({ tagName: 'img', classes: 'w-64 h-40 object-cover', imageSrc: '/uploads/new.png', imageAlt: '', imagePreviewDataUrl: '/uploads/new.png' });
  // the selection re-renders with exactly those facts; state and input agree, the upload preview survives
  rerender({ ...base, classes, tagName: 'img', imageSrc: '/uploads/new.png', imageAlt: '', preview: '/uploads/new.png' });
  expect(result.current.state).toMatchObject({ target: 'native', src: '/uploads/new.png', preview: '/uploads/new.png' });
  // a later class-tier edit must not wipe that preview
  rerender({ ...base, classes: classes + ' rounded', tagName: 'img', imageSrc: '/uploads/new.png', imageAlt: '', preview: '/uploads/new.png' });
  expect(result.current.state.preview).toBe('/uploads/new.png');
});
