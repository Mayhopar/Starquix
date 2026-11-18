// Rate-limit surfacing: 429s must reach the activity feed and fail runs explicitly.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isRateLimitError, rateLimitAwareFetch } from '../AIService';

describe('isRateLimitError', () => {
  it('matches APICallError statusCode 429', () => {
    expect(isRateLimitError({ statusCode: 429, message: 'Too Many Requests' })).toBe(true);
  });

  it('matches RetryError wrapping a 429 in lastError or errors[]', () => {
    expect(isRateLimitError({ message: 'Failed after 3 attempts', lastError: { statusCode: 429 } })).toBe(true);
    expect(isRateLimitError({ message: 'Failed after 3 attempts', errors: [{ statusCode: 500 }, { statusCode: 429 }] })).toBe(true);
  });

  it('matches rate-limit message text', () => {
    expect(isRateLimitError(new Error('Rate limit exceeded: free-models-per-day'))).toBe(true);
    expect(isRateLimitError(new Error('API error 429: slow down'))).toBe(true);
  });

  it('rejects non-429 errors', () => {
    expect(isRateLimitError(new Error('Invalid API key'))).toBe(false);
    expect(isRateLimitError({ statusCode: 500, message: 'Internal error' })).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe('rateLimitAwareFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fires onRetryable with the status on 429 and passes the response through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })));
    const onRetryable = vi.fn();
    const res = await rateLimitAwareFetch(onRetryable)('https://openrouter.ai/api/v1/chat/completions');
    expect(res.status).toBe(429);
    expect(onRetryable).toHaveBeenCalledWith(429);
  });

  it('also fires on 5xx (previously silent → invisible multi-minute retry)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream error', { status: 503 })));
    const onRetryable = vi.fn();
    await rateLimitAwareFetch(onRetryable)('https://openrouter.ai/api/v1/chat/completions');
    expect(onRetryable).toHaveBeenCalledWith(503);
  });

  it('stays silent on 2xx/4xx (non-retryable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
    const onRetryable = vi.fn();
    const res = await rateLimitAwareFetch(onRetryable)('https://api.example.com');
    expect(res.status).toBe(200);
    expect(onRetryable).not.toHaveBeenCalled();
  });
});
