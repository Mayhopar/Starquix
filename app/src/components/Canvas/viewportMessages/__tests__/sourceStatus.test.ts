import { describe, it, expect } from 'vitest';
import { makeFakeCtx } from './fakeContext';
import { handleSourceError, handleSourceOk, sourceErrorDetail } from '../sourceStatus';
import { handleIframeReady } from '../lifecycle';

describe('template error status (seamless 4.3, case 24)', () => {
  it('SOURCE_ERROR sets one status naming file:line; SOURCE_OK clears it', () => {
    const ctx = makeFakeCtx();
    handleSourceError(ctx, { file: 'src/pages/index.astro', line: 6, message: 'Expected ")"' });
    expect(ctx.actions.setSourceError).toHaveBeenLastCalledWith({ file: 'src/pages/index.astro', line: 6, message: 'Expected ")"' });
    handleSourceOk(ctx);
    expect(ctx.actions.setSourceError).toHaveBeenLastCalledWith(null);
  });

  it('a new document clears a stale status', () => {
    const ctx = makeFakeCtx({ refs: { iframe: { current: document.createElement('iframe') } } });
    handleIframeReady(ctx, { documentHeight: 1, documentWidth: 1 });
    expect(ctx.actions.setSourceError).toHaveBeenCalledWith(null);
  });

  it('detail is the file (Astro lines are compiled-code lines), falling back to the message', () => {
    expect(sourceErrorDetail({ file: 'src/a.astro', line: 25, message: 'x' })).toBe('src/a.astro');
    expect(sourceErrorDetail({ file: '', line: null, message: 'boom' })).toBe('boom');
  });
});
