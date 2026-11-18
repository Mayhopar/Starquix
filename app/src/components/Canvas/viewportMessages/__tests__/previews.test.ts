import { describe, it, expect } from 'vitest';
import { handleBgImagePreview, handleImagePreviewRefresh } from '../previews';
import { makeFakeCtx } from './fakeContext';

describe('previews handlers', () => {
  it('BG_IMAGE_PREVIEW forwards to updateBgImagePreview', () => {
    const ctx = makeFakeCtx();
    handleBgImagePreview(ctx, { key: 'k', dataUrl: 'data:image/png;base64,x' });
    expect(ctx.actions.updateBgImagePreview).toHaveBeenCalledWith('k', 'data:image/png;base64,x');
  });

  it('IMAGE_PREVIEW_REFRESH forwards to updateImagePreview', () => {
    const ctx = makeFakeCtx();
    handleImagePreviewRefresh(ctx, { key: 'k2', dataUrl: 'data:image/png;base64,y' });
    expect(ctx.actions.updateImagePreview).toHaveBeenCalledWith('k2', 'data:image/png;base64,y');
  });
});
