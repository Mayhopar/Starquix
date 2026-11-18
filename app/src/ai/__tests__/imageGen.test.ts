// src/ai/__tests__/imageGen.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveImageGen, generateImage } from '../imageGen';
import type { AIConfig } from '../types';

const cfg = (over: Partial<AIConfig>): AIConfig => ({ provider: 'anthropic', apiKey: 'k', ...over });

describe('resolveImageGen', () => {
  it('returns null for null config', () => {
    expect(resolveImageGen(null)).toBeNull();
  });
  it('reuses openai chat key', () => {
    expect(resolveImageGen(cfg({ provider: 'openai' }))).toEqual({ provider: 'openai', apiKey: 'k' });
  });
  it('reuses openrouter chat key', () => {
    expect(resolveImageGen(cfg({ provider: 'openrouter' }))).toEqual({ provider: 'openrouter', apiKey: 'k' });
  });
  it('returns null for anthropic and ollama without separate key', () => {
    expect(resolveImageGen(cfg({ provider: 'anthropic' }))).toBeNull();
    expect(resolveImageGen(cfg({ provider: 'ollama' }))).toBeNull();
  });
  it('separate image key wins over chat-key reuse', () => {
    expect(resolveImageGen(cfg({ provider: 'openai', imageProvider: 'openrouter', imageApiKey: 'ik' })))
      .toEqual({ provider: 'openrouter', apiKey: 'ik' });
  });
  it('separate provider without key is ignored', () => {
    expect(resolveImageGen(cfg({ provider: 'anthropic', imageProvider: 'openai' }))).toBeNull();
  });
  // AI settings' Images section saves { provider: 'openrouter', apiKey: '' } when no
  // config exists: that offered generate_image to the agent while the UI said "None".
  it('a chat config without a key offers no images', () => {
    expect(resolveImageGen(cfg({ provider: 'openrouter', apiKey: '' }))).toBeNull();
    expect(resolveImageGen(cfg({ provider: 'openai', apiKey: '  ' }))).toBeNull();
  });
});

const PNG_B64 = btoa('fakepng');

describe('generateImage', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('openai: posts gpt-image-1 with mapped size, decodes b64_json', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: PNG_B64 }] }),
    });
    const img = await generateImage('a red chair', 'landscape', { provider: 'openai', apiKey: 'k' });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'gpt-image-1', size: '1536x1024' });
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(img.mimeType).toBe('image/png');
    expect(new TextDecoder().decode(img.bytes)).toBe('fakepng');
  });

  it('openrouter: decodes data-url from message.images', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { images: [{ image_url: { url: `data:image/jpeg;base64,${PNG_B64}` } }] } }] }),
    });
    const img = await generateImage('x', 'square', { provider: 'openrouter', apiKey: 'k' });
    expect(img.mimeType).toBe('image/jpeg');
  });

  it('throws with status + body excerpt on non-ok response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
    await expect(generateImage('x', 'square', { provider: 'openai', apiKey: 'k' }))
      .rejects.toThrow(/429.*rate limited/);
  });

  it('throws when openai returns no image data', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    await expect(generateImage('x', 'square', { provider: 'openai', apiKey: 'k' })).rejects.toThrow(/no image/i);
  });

  it('always passes an abort signal (timeout) to fetch', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: PNG_B64 }] }),
    });
    await generateImage('x', 'square', { provider: 'openai', apiKey: 'k' });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('caller abort propagates into the fetch signal', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: PNG_B64 }] }),
    });
    const ac = new AbortController();
    await generateImage('x', 'square', { provider: 'openai', apiKey: 'k' }, { signal: ac.signal });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.signal.aborted).toBe(false);
    ac.abort();
    expect(init.signal.aborted).toBe(true); // AbortSignal.any wiring: caller abort flips the fetch signal
  });

  it('short-circuits without fetching when caller already aborted', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ data: [{ b64_json: PNG_B64 }] }) });
    const ac = new AbortController();
    ac.abort();
    await expect(generateImage('x', 'square', { provider: 'openai', apiKey: 'k' }, { signal: ac.signal })).rejects.toThrow(/abort/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('openrouter: sends structured image_config aspect ratio', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG_B64}` } }] } }] }),
    });
    await generateImage('x', 'landscape', { provider: 'openrouter', apiKey: 'k' });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.image_config).toEqual({ aspect_ratio: '16:9' });
  });

  it('retries once on 429 then succeeds', async () => {
    vi.useFakeTimers();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'slow down' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: PNG_B64 }] }) });
    const p = generateImage('x', 'square', { provider: 'openai', apiKey: 'k' });
    await vi.advanceTimersByTimeAsync(5000);
    const img = await p;
    expect(img.mimeType).toBe('image/png');
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not retry on non-retryable 400', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 400, text: async () => 'bad prompt' });
    await expect(generateImage('x', 'square', { provider: 'openai', apiKey: 'k' })).rejects.toThrow(/400/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 500 when the caller already aborted', async () => {
    const ac = new AbortController();
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      ac.abort();
      return { ok: false, status: 500, text: async () => 'oops' };
    });
    await expect(generateImage('x', 'square', { provider: 'openai', apiKey: 'k' }, { signal: ac.signal })).rejects.toThrow(/500/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
