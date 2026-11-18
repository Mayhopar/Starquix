// src/ai/tools/__tests__/imageTools.test.ts
// task-119: search_stock_images + generate_image availability gating + executors.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/db';
import { dispatchDurableAction } from '@/store/durableDispatch';

vi.mock('@/ai/AIContext', () => ({ loadAIConfig: vi.fn() }));
vi.mock('@/services/stockImages', () => ({ searchStockImages: vi.fn() }));
vi.mock('@/ai/imageGen', () => ({ resolveImageGen: vi.fn(), generateImage: vi.fn() }));
vi.mock('@/hooks/useAssetUpload', () => ({ uploadAssetBlob: vi.fn() }));
vi.mock('@/utils/assetTransfer', () => ({ transferAssetToIframe: vi.fn() }));

import { generateCommandTools, type ToolExecutionContext } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';
import { loadAIConfig } from '@/ai/AIContext';
import { searchStockImages } from '@/services/stockImages';
import { resolveImageGen, generateImage } from '@/ai/imageGen';
import { uploadAssetBlob } from '@/hooks/useAssetUpload';
import { transferAssetToIframe } from '@/utils/assetTransfer';

const availability = (over: Partial<{ hasPexelsKey: boolean; hasImageGen: boolean }> = {}) => ({
  hasPexelsKey: false,
  hasImageGen: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('image tool availability gating', () => {
  it('search_stock_images absent without pexels key, present with', () => {
    const off = generateCommandTools(makeCtx({ availability: availability() }));
    expect(off).not.toHaveProperty('search_stock_images');
    const on = generateCommandTools(makeCtx({ availability: availability({ hasPexelsKey: true }) }));
    expect(on).toHaveProperty('search_stock_images');
  });

  it('generate_image gated on hasImageGen', () => {
    const off = generateCommandTools(makeCtx({ availability: availability({ hasPexelsKey: true }) }));
    expect(off).not.toHaveProperty('generate_image');
    const on = generateCommandTools(makeCtx({ availability: availability({ hasImageGen: true }) }));
    expect(on).toHaveProperty('generate_image');
  });
});

describe('executeStockSearch', () => {
  const getTool = () =>
    generateCommandTools(makeCtx({ availability: availability({ hasPexelsKey: true }) }))
      .search_stock_images as unknown as ExecTool;

  it('returns photos from the service', async () => {
    (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'anthropic', apiKey: 'k', pexelsApiKey: 'pk' });
    const photo = { id: 1, alt: 'a', width: 10, height: 10, photographer: 'p', url: 'https://x/l.jpg' };
    (searchStockImages as ReturnType<typeof vi.fn>).mockResolvedValue([photo]);
    const out = await getTool().execute({ query: 'chair', orientation: 'landscape', count: 3 }) as unknown as { photos: unknown[] };
    expect(searchStockImages).toHaveBeenCalledWith('chair', 'pk', { orientation: 'landscape', count: 3 });
    expect(out.photos).toEqual([photo]);
  });

  it('maps zero results and errors to tool text (never throws)', async () => {
    (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'anthropic', apiKey: 'k', pexelsApiKey: 'pk' });
    (searchStockImages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const empty = await getTool().execute({ query: 'x' }) as unknown as { photos: unknown[]; note: string };
    expect(empty.photos).toEqual([]);
    expect(empty.note).toMatch(/broader/i);

    (searchStockImages as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Pexels API 429'));
    const err = await getTool().execute({ query: 'x' }) as unknown as { error: string };
    expect(err.error).toMatch(/429/);
  });

  it('returns error when pexels key missing from config', async () => {
    (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'anthropic', apiKey: 'k' });
    const out = await getTool().execute({ query: 'x' }) as unknown as { error: string };
    expect(out.error).toMatch(/not configured/i);
    expect(searchStockImages).not.toHaveBeenCalled();
  });
});

describe('executeGenerateImage', () => {
  const getTool = () =>
    generateCommandTools(makeCtx({ availability: availability({ hasImageGen: true }) }))
      .generate_image as unknown as ExecTool;

  it('generate → uploadAssetBlob → transferAssetToIframe → sq-asset message', async () => {
    (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (resolveImageGen as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({ bytes: new Uint8Array([1]), mimeType: 'image/png' });
    (uploadAssetBlob as ReturnType<typeof vi.fn>).mockResolvedValue({ assetId: 'asset-1', editorBlobUrl: 'blob:x' });
    (transferAssetToIframe as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = await getTool().execute({ prompt: 'a fox logo', orientation: 'square' });
    expect(res.success).toBe(true);
    expect(res.message).toContain('sq-asset:asset-1');
    expect(generateImage).toHaveBeenCalledWith('a fox logo', 'square', { provider: 'openai', apiKey: 'k' }, { signal: undefined });
    const uploadedFile = (uploadAssetBlob as ReturnType<typeof vi.fn>).mock.calls[0][1] as File;
    expect(uploadedFile.type).toBe('image/png');
    expect(uploadedFile.name).toMatch(/\.png$/);
    expect(transferAssetToIframe).toHaveBeenCalledWith('asset-1', uploadedFile);
  });

  it('returns success:false with error text on gen failure', async () => {
    (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (resolveImageGen as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (generateImage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const res = await getTool().execute({ prompt: 'x' });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/boom/);
    expect(uploadAssetBlob).not.toHaveBeenCalled();
  });

  it('returns success:false when no provider resolves', async () => {
    (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'anthropic', apiKey: 'k' });
    (resolveImageGen as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const res = await getTool().execute({ prompt: 'x' });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/provider/i);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('threads the SDK abortSignal into generateImage', async () => {
    (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (resolveImageGen as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({ bytes: new Uint8Array([1]), mimeType: 'image/png' });
    (uploadAssetBlob as ReturnType<typeof vi.fn>).mockResolvedValue({ assetId: 'a', editorBlobUrl: 'blob:x' });
    (transferAssetToIframe as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const ac = new AbortController();
    await getTool().execute({ prompt: 'x', orientation: 'square' }, { abortSignal: ac.signal });
    expect(generateImage).toHaveBeenCalledWith('x', 'square', { provider: 'openai', apiKey: 'k' }, { signal: ac.signal });
  });

  it('auto-applies src + alt when elementId is given (no separate apply call needed)', async () => {
    (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (resolveImageGen as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({ bytes: new Uint8Array([1]), mimeType: 'image/png' });
    (uploadAssetBlob as ReturnType<typeof vi.fn>).mockResolvedValue({ assetId: 'asset-9', editorBlobUrl: 'blob:x' });
    (transferAssetToIframe as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await db.delete(); await db.open();
    const ctx = makeCtx({ availability: availability({ hasImageGen: true }) });
    ctx.doc.getMap('meta').set('projectId', `image-${crypto.randomUUID()}`);
    ctx.dispatch = action => dispatchDurableAction(ctx.doc, action);
    const tool = generateCommandTools(ctx).generate_image as unknown as ExecTool;
    const res = await tool.execute({ prompt: 'a fox hero image', orientation: 'landscape', elementId: 'Hero.astro:5:1' });

    expect(res.success).toBe(true);
    expect(res.message).toMatch(/applied to Hero\.astro:5:1/);
    expect(await db.durableEdits.count()).toBe(1);
    expect(ctx.doc.getMap('sourceImageAttributes').toJSON()).toMatchObject({ 'Hero.astro:5:1': { src: 'sq-asset:asset-9', alt: 'a fox hero image' } });
  });

  // The apply is a durable acceptance now (fdd2d12f), not ctx.dispatch — the
  // "target vanished" case is a real missing instance in an accepting project.
  it('falls back to manual-apply message when the target is gone (nothing to apply to)', async () => {
    (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (resolveImageGen as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({ bytes: new Uint8Array([1]), mimeType: 'image/png' });
    (uploadAssetBlob as ReturnType<typeof vi.fn>).mockResolvedValue({ assetId: 'asset-9', editorBlobUrl: 'blob:x' });
    (transferAssetToIframe as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await db.delete(); await db.open();
    const ctx = makeCtx({ availability: availability({ hasImageGen: true }) });
    ctx.doc.getMap('meta').set('projectId', `image-${crypto.randomUUID()}`);
    const tool = generateCommandTools(ctx).generate_image as unknown as ExecTool;
    const res = await tool.execute({ prompt: 'x', elementId: 'gone:1:1' });
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/sq-asset:asset-9/); // fell back to the model-applies message
  });

  it('bails before upload when aborted after generation', async () => {
    (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    (resolveImageGen as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
    const ac = new AbortController();
    (generateImage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      ac.abort();
      return { bytes: new Uint8Array([1]), mimeType: 'image/png' };
    });
    const res = await getTool().execute({ prompt: 'x' }, { abortSignal: ac.signal });
    expect(res.success).toBe(false);
    expect(uploadAssetBlob).not.toHaveBeenCalled();
  });
});
