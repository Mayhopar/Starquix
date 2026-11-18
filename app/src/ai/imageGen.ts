// src/ai/imageGen.ts
// Image-generation provider resolution + generation calls (plain fetch, browser-side).
import type { AIConfig } from './types';

export type ImageGenProvider = 'openai' | 'openrouter';
export type ImageOrientation = 'square' | 'landscape' | 'portrait';

export interface ResolvedImageGen {
  provider: ImageGenProvider;
  apiKey: string;
}

/** Providers AISettings offers for a separate image key. */
export const IMAGE_CAPABLE_PROVIDERS: { id: ImageGenProvider; name: string }[] = [
  { id: 'openai', name: 'OpenAI (gpt-image-1)' },
  { id: 'openrouter', name: 'OpenRouter (Gemini 2.5 Flash Image)' },
];

export function resolveImageGen(config: AIConfig | null): ResolvedImageGen | null {
  if (!config) return null;
  if (config.imageProvider && config.imageApiKey) {
    return { provider: config.imageProvider, apiKey: config.imageApiKey };
  }
  return chatImageGen(config);
}

/** The chat key itself, when its provider also makes images: one key covers both. */
export function chatImageGen(config: AIConfig | null): ResolvedImageGen | null {
  if (!config?.apiKey?.trim()) return null;
  if (config.provider === 'openai' || config.provider === 'openrouter') {
    return { provider: config.provider, apiKey: config.apiKey };
  }
  return null;
}

const OPENAI_SIZES: Record<ImageOrientation, string> = {
  square: '1024x1024',
  landscape: '1536x1024',
  portrait: '1024x1536',
};

// OpenRouter/Gemini honors structured aspect ratio via image_config, not `size`
// (the OpenRouter path previously encoded orientation as prose only, so Gemini
// returned its 1:1 default regardless of the requested orientation).
const OPENROUTER_ASPECT: Record<ImageOrientation, string> = {
  square: '1:1',
  landscape: '16:9',
  portrait: '9:16',
};

// ponytail: model ids pinned; make configurable only if a user asks
const OPENAI_IMAGE_MODEL = 'gpt-image-1';
const OPENROUTER_IMAGE_MODEL = 'google/gemini-2.5-flash-image'; // verified against live model list 2026-07-17

// A single image legitimately takes ~30-90s; cap it so a wedged provider request
// can't stall the whole agent run forever. On timeout the fetch aborts and the
// tool returns a failed result the model continues from.
const IMAGE_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 3000;

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: string;
}

export interface GenerateImageOptions {
  /** Run-level abort signal — Stop cancels the in-flight request. */
  signal?: AbortSignal;
}

/** HTTP failure carrying the status so the retry policy can decide. */
class ImageHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ImageHttpError';
  }
}

/** Combine the caller signal with a hard timeout; either aborts the fetch. */
function requestSignal(callerSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

/** Retryable = transient provider hiccup (429/5xx). 4xx (bad prompt/key) is terminal.
 *  Shared with the agent stream's rateLimitAwareFetch — one retry policy, one home. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** AbortError (not a plain Error) so the repo-wide `err.name === 'AbortError'`
 *  checks — useAIAgent's catch net, useComponentLibrary, useLayoutLibrary — all
 *  recognise a Stop pressed during the retry backoff. */
const abortError = () => new DOMException('Image generation aborted', 'AbortError');

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
  });

export async function generateImage(
  prompt: string,
  orientation: ImageOrientation,
  gen: ResolvedImageGen,
  opts: GenerateImageOptions = {},
): Promise<GeneratedImage> {
  // One retry for a transient failure; a caller abort short-circuits it.
  if (opts.signal?.aborted) throw abortError();
  try {
    return await generateImageOnce(prompt, orientation, gen, opts.signal);
  } catch (err) {
    const retryable = err instanceof ImageHttpError && isRetryableStatus(err.status);
    if (!retryable || opts.signal?.aborted) throw err;
    await delay(RETRY_DELAY_MS, opts.signal);
    return generateImageOnce(prompt, orientation, gen, opts.signal);
  }
}

async function generateImageOnce(
  prompt: string,
  orientation: ImageOrientation,
  gen: ResolvedImageGen,
  callerSignal?: AbortSignal,
): Promise<GeneratedImage> {
  const signal = requestSignal(callerSignal);

  if (gen.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gen.apiKey}` },
      body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt, size: OPENAI_SIZES[orientation] }),
      signal,
    });
    if (!res.ok) throw new ImageHttpError(res.status, `OpenAI image API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI image API returned no image data');
    return { bytes: base64ToBytes(b64), mimeType: 'image/png' };
  }

  // OpenRouter: image-output model via chat completions
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gen.apiKey}` },
    body: JSON.stringify({
      model: OPENROUTER_IMAGE_MODEL,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: OPENROUTER_ASPECT[orientation] },
      messages: [{ role: 'user', content: `Generate an image (${orientation} orientation): ${prompt}` }],
    }),
    signal,
  });
  if (!res.ok) throw new ImageHttpError(res.status, `OpenRouter image API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const dataUrl: string | undefined = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl || !dataUrl.startsWith('data:')) throw new Error('OpenRouter returned no image');
  const [meta, b64] = dataUrl.split(',');
  return { bytes: base64ToBytes(b64), mimeType: meta.slice(5).split(';')[0] || 'image/png' };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
