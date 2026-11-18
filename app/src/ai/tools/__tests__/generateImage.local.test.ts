// task-144: generate_image in a local_ project must write a REAL file via
// uploadLocalAssetFile — never a Dexie sq-asset ref (it would be flushed into
// the user's .astro files and 404 forever).
//
// Contract (fdd2d12f): the auto-apply is a durable acceptance
// (acceptEditorCommands), not ctx.dispatch — assert on the accepted doc.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';

vi.mock('@/ai/AIContext', () => ({ loadAIConfig: vi.fn() }));
vi.mock('@/ai/imageGen', () => ({ resolveImageGen: vi.fn(), generateImage: vi.fn() }));
vi.mock('@/hooks/useAssetUpload', () => ({ uploadAssetBlob: vi.fn() }));
vi.mock('@/utils/assetTransfer', () => ({ transferAssetToIframe: vi.fn() }));
vi.mock('@/utils/imageUpload', async (orig) => ({
  ...(await orig() as object),
  uploadLocalAssetFile: vi.fn(),
}));

import { generateCommandTools, type ToolExecutionContext } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';
import { loadAIConfig } from '@/ai/AIContext';
import { resolveImageGen, generateImage } from '@/ai/imageGen';
import { uploadAssetBlob } from '@/hooks/useAssetUpload';
import { transferAssetToIframe } from '@/utils/assetTransfer';
import { uploadLocalAssetFile } from '@/utils/imageUpload';

const availability = { hasPexelsKey: false, hasImageGen: true };

function ctxForProject(projectId: string): ToolExecutionContext {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  // The image target: an instance root (UPDATE_IMAGE_ATTRIBUTE instance-root
  // branch stores imageAttributes on the element).
  const el = new Y.Map<unknown>();
  el.set('id', 'el-1');
  doc.getMap('elements').set('el-1', el);
  return makeCtx({ doc, availability });
}

function appliedImageAttrs(ctx: ToolExecutionContext) {
  const el = ctx.doc.getMap('elements').get('el-1') as Y.Map<unknown>;
  return (el.get('imageAttributes') as Y.Map<unknown> | undefined)?.toJSON();
}

afterEach(() => { vi.unstubAllGlobals(); });

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  vi.clearAllMocks();
  (loadAIConfig as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
  (resolveImageGen as ReturnType<typeof vi.fn>).mockReturnValue({ provider: 'openai', apiKey: 'k' });
  (generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({ bytes: new Uint8Array([1]), mimeType: 'image/png' });
  (uploadAssetBlob as ReturnType<typeof vi.fn>).mockResolvedValue({ assetId: 'A1', editorBlobUrl: 'blob:a' });
  (transferAssetToIframe as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (uploadLocalAssetFile as ReturnType<typeof vi.fn>).mockResolvedValue({ src: '/uploads/ai-1.png', previewUrl: 'blob:x' });
});

describe('generate_image local-mode routing (task-144)', () => {
  it('local project: uploads a real file and applies its /uploads src (no sq-asset)', async () => {
    const ctx = ctxForProject('browser_lf_abc');
    const tool = generateCommandTools(ctx).generate_image as unknown as ExecTool;
    const res = await tool.execute({ prompt: 'p', elementId: 'el-1' });

    expect(uploadLocalAssetFile).toHaveBeenCalled();
    expect(uploadAssetBlob).not.toHaveBeenCalled();
    expect(transferAssetToIframe).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(appliedImageAttrs(ctx)).toMatchObject({ src: '/uploads/ai-1.png', alt: 'p' });
    expect(await db.durableEdits.count()).toBe(1);
    expect(JSON.stringify(res)).not.toContain('sq-asset');
  });

  it('local project without elementId: manual-apply message quotes the /uploads src, not sq-asset', async () => {
    const ctx = ctxForProject('browser_lf_abc');
    const tool = generateCommandTools(ctx).generate_image as unknown as ExecTool;
    const res = await tool.execute({ prompt: 'p' });
    expect(res.success).toBe(true);
    expect(res.message).toContain('/uploads/ai-1.png');
    expect(JSON.stringify(res)).not.toContain('sq-asset');
  });

  it('browser project: unchanged sq-asset pipeline', async () => {
    const ctx = ctxForProject('browser_x');
    const tool = generateCommandTools(ctx).generate_image as unknown as ExecTool;
    const res = await tool.execute({ prompt: 'p', elementId: 'el-1' });

    expect(uploadAssetBlob).toHaveBeenCalled();
    expect(transferAssetToIframe).toHaveBeenCalledWith('A1', expect.any(File));
    expect(uploadLocalAssetFile).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(appliedImageAttrs(ctx)).toMatchObject({ src: 'sq-asset:A1', alt: 'p' });
    expect(await db.durableEdits.count()).toBe(1);
  });
});
