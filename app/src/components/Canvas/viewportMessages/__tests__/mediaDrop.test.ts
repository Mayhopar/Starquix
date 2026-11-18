/**
 * task-141: direct canvas file drop — classifyMediaDrop decision function +
 * handleCanvasFileDrop routing (swap/convert via tag-swap write, drawn via
 * RESOLVE_DRAWN_MEDIA, background via classes pipeline, rejects toasted or
 * silent).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeFakeCtx } from './fakeContext';
import { swapElementTagWithUndo } from '../../../../../../preview-template/src/plugins/sq-source-plugin.js';
const mockRead = vi.fn();
vi.mock('@/utils/sqLocalBase', () => ({ localFetch: (...args: unknown[]) => mockRead(...args) }));
const mockFlush = vi.fn(async () => {});
vi.mock('@/utils/pendingSourceWrites', () => ({ flushPendingSourceWrites: () => mockFlush() }));

const mockWriteTagSwap = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => true);
vi.mock('@/services/ViteMediaWriter', () => ({
  viteMediaWriter: { writeTagSwap: (...a: unknown[]) => mockWriteTagSwap(...a) },
}));
const mockUploadLocalAssetFile = vi.fn(async (_pid: string, file: File) => ({
  src: `/uploads/${file.name}`, previewUrl: `blob:local/${file.name}`,
}));
const mockRebindBoundAsset = vi.fn(async (_pid: string, _old: string, file: File) => ({
  newAsset: `src/content/works/images/X/${file.name}`, refs: 1,
}));
const mockRepointBoundAsset = vi.fn(async () => ({ refs: 1 }));
const mockSyncImageAttr = vi.fn();
vi.mock('@/utils/imageUpload', () => ({
  uploadLocalAssetFile: (pid: string, f: File) => mockUploadLocalAssetFile(pid, f),
  rebindLocalBoundAsset: (pid: string, old: string, f: File) => mockRebindBoundAsset(pid, old, f),
  repointLocalBoundAsset: (pid: string, from: string, to: string) => mockRepointBoundAsset(pid, from, to),
  syncImageAttrToIframe: (...a: unknown[]) => mockSyncImageAttr(...a),
}));
const mockUploadAssetBlob = vi.fn(async (_pid: string, _f: File) => ({
  assetId: 'asset-1', editorBlobUrl: 'blob:editor/x',
}));
vi.mock('@/hooks/useAssetUpload', () => ({
  uploadAssetBlob: (pid: string, f: File) => mockUploadAssetBlob(pid, f),
}));
const mockTransferAsset = vi.fn(async () => undefined);
vi.mock('@/utils/assetTransfer', () => ({
  transferAssetToIframe: (...a: unknown[]) => mockTransferAsset(...a as []),
}));
const mockToast = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: Object.assign((...a: unknown[]) => mockToast(...a), { error: vi.fn() }),
}));

import { classifyMediaDrop, handleCanvasFileDrop } from '../mediaDrop';

const base = {
  key: 'src/pages/index.astro:5:3',
  tagName: 'div',
  hasElementChildren: false,
  hasSourceLocation: true,
  insideAnchor: false,
  isLocalMode: true,
  fileKind: 'image' as const,
};

describe('classifyMediaDrop', () => {
  it('literal img uses image Fill; video retains its explicit media operation', () => {
    expect(classifyMediaDrop({ ...base, tagName: 'img' })).toBe('image-fill');
    expect(classifyMediaDrop({ ...base, tagName: 'video' })).toBe('swap');
  });

  it('childless ordinary container uses its background', () => {
    expect(classifyMediaDrop(base)).toBe('background');
    expect(classifyMediaDrop({ ...base, mediaFill: true })).toBe('convert');
  });

  it('container WITH children → background', () => {
    expect(classifyMediaDrop({ ...base, hasElementChildren: true })).toBe('background');
  });

  it('drawn element → drawn in any runtime', () => {
    expect(classifyMediaDrop({ ...base, key: 'drawn-1', isLocalMode: false, hasSourceLocation: false })).toBe('drawn');
  });

  it('rejects: no file kind, anchor ancestor, no source loc, ineligible tag', () => {
    expect(classifyMediaDrop({ ...base, fileKind: null })).toBe('reject');
    expect(classifyMediaDrop({ ...base, insideAnchor: true })).toBe('reject');
    expect(classifyMediaDrop({ ...base, hasSourceLocation: false })).toBe('reject');
    expect(classifyMediaDrop({ ...base, tagName: 'a' })).toBe('reject');
    expect(classifyMediaDrop({ ...base, key: null })).toBe('reject');
  });

  // task-144: WC drops work — overlay writes instead of file writes.
  it('WC img with source key + image file → overlay-swap', () => {
    expect(classifyMediaDrop({ ...base, isLocalMode: false, tagName: 'img' })).toBe('overlay-swap');
  });

  // WC/local parity (gaps 3/62): video file on a <video> rides the same
  // overlay-swap path an img gets — sq-asset src, bridge resolves it.
  it('WC video with source key + video file → overlay-swap', () => {
    expect(classifyMediaDrop({ ...base, isLocalMode: false, tagName: 'video', fileKind: 'video' })).toBe('overlay-swap');
  });

  // Gap 4/63 regression: an image src on a <video> renders NOTHING — a kind
  // change needs local's tag-swap write, which the overlay tier can't express.
  it('WC video target + image file → reject (never write an image src onto a <video>)', () => {
    expect(classifyMediaDrop({ ...base, isLocalMode: false, tagName: 'video' })).toBe('reject');
  });

  it('WC container with source key + image file → overlay-background (children or not)', () => {
    expect(classifyMediaDrop({ ...base, isLocalMode: false })).toBe('overlay-background');
    expect(classifyMediaDrop({ ...base, isLocalMode: false, hasElementChildren: true })).toBe('overlay-background');
  });

  it('WC rejects: video file on img/container, no source key, ineligible tag', () => {
    expect(classifyMediaDrop({ ...base, isLocalMode: false, tagName: 'img', fileKind: 'video' })).toBe('reject');
    expect(classifyMediaDrop({ ...base, isLocalMode: false, tagName: 'div', fileKind: 'video' })).toBe('reject');
    expect(classifyMediaDrop({ ...base, isLocalMode: false, hasSourceLocation: false })).toBe('reject');
    expect(classifyMediaDrop({ ...base, isLocalMode: false, tagName: 'a' })).toBe('reject');
  });

  it('local bindings and explicit slots retain their operation paths', () => {
    expect(classifyMediaDrop({ ...base, tagName: 'img' })).toBe('image-fill');
    expect(classifyMediaDrop({
      ...base, tagName: 'img', hasSourceLocation: false, boundAssetPath: '/x/a.png',
    })).toBe('rebind');
    expect(classifyMediaDrop(base)).toBe('background');
    expect(classifyMediaDrop({ ...base, mediaFill: true })).toBe('convert');
    expect(classifyMediaDrop({ ...base, hasElementChildren: true })).toBe('background');
  });
});

describe('handleCanvasFileDrop', () => {
  const LOC = { file: 'src/pages/index.astro', line: 5, column: 3 };

  beforeEach(() => {
    mockWriteTagSwap.mockClear();
    mockUploadLocalAssetFile.mockClear();
    mockUploadAssetBlob.mockClear();
    mockTransferAsset.mockClear();
    mockToast.mockClear();
    mockSyncImageAttr.mockClear();
  });

  const drop = async (
    target: Record<string, unknown> | null,
    file: File,
    env: Record<string, unknown> = { projectId: 'browser_lf_abc' },
  ) => {
    const ctx = makeFakeCtx({ env });
    await handleCanvasFileDrop(ctx, { target, files: [file] }, {} as MessageEvent);
    return ctx;
  };

  it('drop on childless container applies a background without changing its tag', async () => {
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });
    const ctx = await drop({ key: base.key, tagName: 'div', sourceLocation: LOC, hasElementChildren: false }, file);
    expect(mockUploadLocalAssetFile).toHaveBeenCalledWith('browser_lf_abc', file);
    expect(mockWriteTagSwap).not.toHaveBeenCalled();
    expect(ctx.actions.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SOURCE_CLASSES', classes: expect.stringContaining("bg-[url('/uploads/a.jpg')]") }));
  });

  it('video drop on a literal image preserves the image', async () => {
    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });
    await drop({ key: base.key, tagName: 'img', sourceLocation: LOC }, file);
    expect(mockWriteTagSwap).not.toHaveBeenCalled();
    expect(mockUploadLocalAssetFile).not.toHaveBeenCalled();
  });

  // task-142: canvas drop on a content-bound astro <Image> rebinds the data
  it('drop on bound img rebinds via rebindLocalBoundAsset + repoint undo/redo', async () => {
    const BOUND = '/x/src/content/works/images/P/P.png';
    const file = new File([new Uint8Array([1])], 'new.jpg', { type: 'image/jpeg' });
    const ctx = await drop(
      { key: 'dynamic:img-1', tagName: 'img', sourceLocation: null, boundAssetPath: BOUND, insideAnchor: true },
      file,
    );
    expect(mockRebindBoundAsset).toHaveBeenCalledWith('browser_lf_abc', BOUND, file);
    const snap = (ctx.actions.takeSnapshot as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      { reverse: () => void; forward: () => void };
    snap.reverse();
    expect(mockRepointBoundAsset).toHaveBeenCalledWith('browser_lf_abc', 'src/content/works/images/X/new.jpg', BOUND);
    snap.forward();
    expect(mockRepointBoundAsset).toHaveBeenLastCalledWith('browser_lf_abc', BOUND, 'src/content/works/images/X/new.jpg');
  });

  it('drop on drawn element snapshots then dispatches RESOLVE_DRAWN_MEDIA (WC path)', async () => {
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    const ctx = await drop({ key: 'drawn-1', tagName: 'div' }, file, { projectId: 'browser_p1' });
    expect(mockUploadAssetBlob).toHaveBeenCalledWith('browser_p1', file);
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'RESOLVE_DRAWN_MEDIA', key: 'drawn-1', kind: 'image', src: 'sq-asset:asset-1',
    });
    const snap = (ctx.actions.takeSnapshot as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const disp = (ctx.actions.dispatch as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(snap).toBeLessThan(disp);
  });

  it('image drop on container with children applies bg classes via UPDATE_SOURCE_CLASSES', async () => {
    const file = new File([new Uint8Array([1])], 'bg.jpg', { type: 'image/jpeg' });
    const ctx = makeFakeCtx({
      env: { projectId: 'browser_lf_abc' },
      actions: { getClassesFromYjs: vi.fn(() => 'p-4') },
    });
    await handleCanvasFileDrop(ctx, {
      target: { key: base.key, tagName: 'div', sourceLocation: LOC, hasElementChildren: true },
      files: [file],
    }, {} as MessageEvent);
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_SOURCE_CLASSES',
      sourceKey: base.key,
      classes: "p-4 bg-[url('/uploads/bg.jpg')]",
    });
    expect(mockWriteTagSwap).not.toHaveBeenCalled();
  });

  it('video drop on container with children toasts (task-134 not built)', async () => {
    const file = new File([new Uint8Array([1])], 'c.mp4', { type: 'video/mp4' });
    const ctx = await drop({ key: base.key, tagName: 'div', sourceLocation: LOC, hasElementChildren: true }, file);
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/Video backgrounds/i), expect.anything());
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
  });

  it('non-media file toasts', async () => {
    const pdf = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });
    await drop({ key: base.key, tagName: 'div', sourceLocation: LOC }, pdf);
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/Images and videos only/i), expect.anything());
  });

  // task-144: WC drops route to overlay writes; rejects are NEVER silent.
  it('WC drop on source img: uploads sq-asset, dispatches UPDATE_IMAGE_ATTRIBUTE + iframe sync, snapshot first', async () => {
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    const ctx = await drop({ key: base.key, tagName: 'img', sourceLocation: LOC }, file, { projectId: 'browser_p1' });
    expect(mockUploadAssetBlob).toHaveBeenCalledWith('browser_p1', file);
    expect(mockTransferAsset).toHaveBeenCalledWith('asset-1', file);
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: base.key, attribute: 'src', value: 'sq-asset:asset-1',
    });
    expect(mockSyncImageAttr).toHaveBeenCalledWith(base.key, 'src', 'sq-asset:asset-1');
    const snap = (ctx.actions.takeSnapshot as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const disp = (ctx.actions.dispatch as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(snap).toBeLessThan(disp);
    expect(mockWriteTagSwap).not.toHaveBeenCalled();
    expect(mockUploadLocalAssetFile).not.toHaveBeenCalled();
  });

  // Gaps 3/62: WC video-on-<video> parity — same overlay pipeline as img,
  // proven by ImageUploadOverlay + the bridge's video-attrs sq-asset handling.
  it('WC video drop on source video: uploads sq-asset, dispatches UPDATE_IMAGE_ATTRIBUTE + iframe sync', async () => {
    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });
    const ctx = await drop({ key: base.key, tagName: 'video', sourceLocation: LOC }, file, { projectId: 'browser_p1' });
    expect(mockUploadAssetBlob).toHaveBeenCalledWith('browser_p1', file);
    expect(mockTransferAsset).toHaveBeenCalledWith('asset-1', file);
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: base.key, attribute: 'src', value: 'sq-asset:asset-1',
    });
    expect(mockSyncImageAttr).toHaveBeenCalledWith(base.key, 'src', 'sq-asset:asset-1');
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockWriteTagSwap).not.toHaveBeenCalled();
  });

  // Gap 4/63 regression: WC used to write the image's sq-asset src onto the
  // <video> — a dead element recorded as a successful edit. Must reject loudly.
  it('WC image drop on source video: toasts, dispatches nothing', async () => {
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    const ctx = await drop({ key: base.key, tagName: 'video', sourceLocation: LOC }, file, { projectId: 'browser_p1' });
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/video/i), expect.anything());
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
    expect(mockUploadAssetBlob).not.toHaveBeenCalled();
    expect(mockSyncImageAttr).not.toHaveBeenCalled();
  });

  it('WC video drop on source img: toasts, dispatches nothing', async () => {
    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });
    const ctx = await drop({ key: base.key, tagName: 'img', sourceLocation: LOC }, file, { projectId: 'browser_p1' });
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/video/i), expect.anything());
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
    expect(mockUploadAssetBlob).not.toHaveBeenCalled();
  });

  it('WC drop on source container: UPDATE_SOURCE_CLASSES with sq-asset bg url', async () => {
    const file = new File([new Uint8Array([1])], 'bg.png', { type: 'image/png' });
    const ctx = makeFakeCtx({
      env: { projectId: 'browser_p1' },
      actions: { getClassesFromYjs: vi.fn(() => 'p-4') },
    });
    await handleCanvasFileDrop(ctx, {
      target: { key: base.key, tagName: 'div', sourceLocation: LOC, hasElementChildren: true },
      files: [file],
    }, {} as MessageEvent);
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_SOURCE_CLASSES',
      sourceKey: base.key,
      classes: "p-4 bg-[url('sq-asset:asset-1')] bg-cover",
    });
    expect(mockWriteTagSwap).not.toHaveBeenCalled();
  });

  it('WC drop on element without source key: toasts (never silent), writes nothing', async () => {
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    const ctx = await drop({ key: 'dynamic:img-9', tagName: 'img', sourceLocation: null }, file, { projectId: 'browser_p1' });
    expect(mockToast).toHaveBeenCalled();
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
    expect(mockUploadAssetBlob).not.toHaveBeenCalled();
  });

  it('WC reject on ineligible tag toasts too', async () => {
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    const ctx = await drop({ key: base.key, tagName: 'a', sourceLocation: LOC }, file, { projectId: 'browser_p1' });
    expect(mockToast).toHaveBeenCalled();
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
  });
});

const geometry = { display: 'block', boxSizing: 'border-box', maxWidth: '100%', objectFit: 'cover', objectPosition: '50% 50%', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px' };
it('native canvas image drop uses the guarded source mutation and registers exact Undo after ACK', async () => {
  let source = '<img src="/old.png" alt="Mountain" class="w-60 h-40 object-cover">';
  mockRead.mockImplementation(async () => new Response(source));
  mockWriteTagSwap.mockImplementationOnce(async (...args) => { const receipt = await swapElementTagWithUndo(source, { line: 1, column: 1 }, 'image-fill', '', args[3]); source = receipt.updated; return receipt.extra; });
  const ctx = makeFakeCtx({ env: { projectId: 'browser_lf_test' } });
  await handleCanvasFileDrop(ctx, { target: { key: 'image', tagName: 'img', classes: 'w-60 h-40 object-cover', sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 }, computedStyles: geometry }, files: [new File(['x'], 'new.png', { type: 'image/png' })] }, new MessageEvent('message'));
  expect(source).toContain('<div'); expect(source).toContain('aria-label="Mountain"'); expect(source).toContain('max-w-full');
  expect(ctx.actions.pushStructuralUndo).toHaveBeenCalledTimes(1); expect(ctx.actions.dispatch).not.toHaveBeenCalled();
  expect(ctx.refs.registerElement.current).toHaveBeenCalledWith('image', expect.stringContaining('bg-no-repeat'), expect.anything());
});
it('native canvas source preflight refuses intrinsic layout before uploading any bytes', async () => {
  mockUploadLocalAssetFile.mockClear(); mockWriteTagSwap.mockClear();
  mockRead.mockResolvedValue(new Response('<img src="/old.png" class="w-60 h-auto">'));
  const ctx = makeFakeCtx({ env: { projectId: 'browser_lf_test' } });
  await handleCanvasFileDrop(ctx, { target: { key: 'image', tagName: 'img', sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 }, computedStyles: geometry }, files: [new File(['x'], 'new.png', { type: 'image/png' })] }, new MessageEvent('message'));
  expect(mockUploadLocalAssetFile).not.toHaveBeenCalled(); expect(mockWriteTagSwap).not.toHaveBeenCalled();
});

it('computed-only background refuses before uploading or writing', async () => {
  mockUploadLocalAssetFile.mockClear();
  const ctx = makeFakeCtx({ env: { projectId: 'browser_lf_test' } });
  await handleCanvasFileDrop(ctx, { target: { key: 'bg', tagName: 'div', sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 }, classes: 'w-60 h-40', computedStyles: { backgroundImage: 'url("/authored.png")', imageFillInlineBackground: true } }, files: [new File(['x'], 'bg.png', { type: 'image/png' })] }, new MessageEvent('message'));
  expect(mockUploadLocalAssetFile).not.toHaveBeenCalled(); expect(ctx.actions.dispatch).not.toHaveBeenCalled();
});
it('canvas normalization preserves radius classes completed by the save barrier', async () => {
  let source = '<img src="/old.png" alt="Mountain" class="w-60 h-40 object-cover">';
  mockRead.mockImplementation(async () => new Response(source));
  mockFlush.mockImplementationOnce(async () => { source = source.replace('object-cover', 'object-cover rounded-lg'); });
  mockWriteTagSwap.mockImplementationOnce(async (...args) => { const receipt = await swapElementTagWithUndo(source, { line: 1, column: 1 }, 'image-fill', '', args[3]); source = receipt.updated; return receipt.extra; });
  const ctx = makeFakeCtx({ env: { projectId: 'browser_lf_test' } });
  await handleCanvasFileDrop(ctx, { target: { key: 'image', tagName: 'img', classes: 'w-60 h-40 object-cover', sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 }, computedStyles: geometry }, files: [new File(['x'], 'new.png', { type: 'image/png' })] }, new MessageEvent('message'));
  expect(source).toContain('<div'); expect(source).toContain('rounded-lg'); expect(ctx.actions.pushStructuralUndo).toHaveBeenCalledOnce();
});
