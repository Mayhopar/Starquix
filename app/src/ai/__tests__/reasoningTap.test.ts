import { describe, it, expect, vi } from 'vitest';
import {
  extractReasoningDelta,
  createSseReasoningParser,
  withReasoningEnabled,
  reasoningTapFetch,
  createReasoningSink,
} from '../reasoningTap';

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (d: unknown) => ({ choices: [{ delta: d }] });

describe('extractReasoningDelta', () => {
  it('reads reasoning_details[].text (OpenRouter current shape)', () => {
    expect(
      extractReasoningDelta({
        reasoning_details: [{ type: 'reasoning.text', text: 'step one', id: 'r1', index: 0 }],
      }),
    ).toBe('step one');
  });

  it('concatenates multiple details entries in order', () => {
    expect(
      extractReasoningDelta({
        reasoning_details: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
      }),
    ).toBe('abc');
  });

  it('falls back to summary when an entry has no text', () => {
    expect(extractReasoningDelta({ reasoning_details: [{ summary: 'gist' }] })).toBe('gist');
  });

  it('yields nothing for encrypted-only details and does NOT fall through to the legacy field', () => {
    // Routes that send both would otherwise double-count the same reasoning.
    expect(
      extractReasoningDelta({
        reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque' }],
        reasoning: 'already counted',
      }),
    ).toBe('');
  });

  it('reads the legacy delta.reasoning string', () => {
    expect(extractReasoningDelta({ reasoning: 'thinking' })).toBe('thinking');
  });

  it('reads deepseek-style delta.reasoning_content', () => {
    expect(extractReasoningDelta({ reasoning_content: 'hmm' })).toBe('hmm');
  });

  it('ignores content-only, empty and non-object deltas', () => {
    expect(extractReasoningDelta({ content: 'visible answer' })).toBe('');
    expect(extractReasoningDelta({})).toBe('');
    expect(extractReasoningDelta(null)).toBe('');
    expect(extractReasoningDelta('nope')).toBe('');
  });
});

describe('createSseReasoningParser', () => {
  it('emits one delta per reasoning chunk', () => {
    const seen: string[] = [];
    const feed = createSseReasoningParser((t) => seen.push(t));
    feed(sse(delta({ reasoning_details: [{ text: 'one' }] })));
    feed(sse(delta({ reasoning_details: [{ text: 'two' }] })));
    expect(seen).toEqual(['one', 'two']);
  });

  it('reassembles a data: line split across network chunks', () => {
    const seen: string[] = [];
    const feed = createSseReasoningParser((t) => seen.push(t));
    const raw = sse(delta({ reasoning: 'split me' }));
    feed(raw.slice(0, 12));
    expect(seen).toEqual([]); // nothing until the newline arrives
    feed(raw.slice(12));
    expect(seen).toEqual(['split me']);
  });

  it('handles several events arriving in one chunk', () => {
    const seen: string[] = [];
    const feed = createSseReasoningParser((t) => seen.push(t));
    feed(sse(delta({ reasoning: 'a' })) + sse(delta({ reasoning: 'b' })));
    expect(seen).toEqual(['a', 'b']);
  });

  it('skips [DONE], keep-alive comments, blank lines and unparseable payloads', () => {
    const seen: string[] = [];
    const feed = createSseReasoningParser((t) => seen.push(t));
    feed(': OPENROUTER PROCESSING\n\ndata: [DONE]\n\ndata: {not json\n\n');
    feed(sse(delta({ reasoning: 'survived' })));
    expect(seen).toEqual(['survived']);
  });

  it('ignores tool-call and content deltas', () => {
    const seen: string[] = [];
    const feed = createSseReasoningParser((t) => seen.push(t));
    feed(sse(delta({ content: 'answer' })));
    feed(sse(delta({ tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] })));
    expect(seen).toEqual([]);
  });
});

describe('withReasoningEnabled', () => {
  it('opts the request into reasoning', () => {
    const out = withReasoningEnabled({ body: JSON.stringify({ model: 'moonshotai/kimi-k3' }) });
    expect(JSON.parse(out!.body as string)).toEqual({
      model: 'moonshotai/kimi-k3',
      reasoning: { enabled: true },
    });
  });

  it('never overrides an explicit reasoning / include_reasoning setting', () => {
    const explicit = JSON.stringify({ model: 'x', reasoning: { effort: 'high' } });
    expect(withReasoningEnabled({ body: explicit })!.body).toBe(explicit);
    const legacy = JSON.stringify({ model: 'x', include_reasoning: false });
    expect(withReasoningEnabled({ body: legacy })!.body).toBe(legacy);
  });

  it('leaves non-JSON and non-string bodies untouched', () => {
    expect(withReasoningEnabled({ body: 'not json' })!.body).toBe('not json');
    expect(withReasoningEnabled(undefined)).toBeUndefined();
    const blob = new Blob(['x']);
    expect(withReasoningEnabled({ body: blob })!.body).toBe(blob);
  });
});

describe('reasoningTapFetch', () => {
  const streamOf = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
        c.close();
      },
    });

  it('accumulates reasoning while leaving the SDK branch byte-identical', async () => {
    const body =
      sse(delta({ reasoning_details: [{ text: 'plan' }] })) +
      sse(delta({ content: 'hello' })) +
      sse(delta({ reasoning_details: [{ text: ' more' }] })) +
      'data: [DONE]\n\n';
    const inner = vi.fn(async () => new Response(streamOf([body]), { status: 200 }));
    const seen: Array<[string, string]> = [];

    const res = await reasoningTapFetch(inner as unknown as typeof fetch, (t, id) => seen.push([t, id]))(
      'https://openrouter.ai/api/v1/chat/completions',
      { body: JSON.stringify({ model: 'moonshotai/kimi-k3' }) },
    );
    const sdkText = await res.text();

    expect(sdkText).toBe(body); // the SDK must see the original stream verbatim
    expect(seen.map(([text]) => text)).toEqual(['plan', 'plan more']); // running total
    expect(seen[0][1]).toBe(seen[1][1]); // one request = one stable block id
  });

  it('gives each request its own block id so steps do not merge', async () => {
    const body = sse(delta({ reasoning: 'x' }));
    const inner = vi.fn(async () => new Response(streamOf([body]), { status: 200 }));
    const ids: string[] = [];
    const tap = reasoningTapFetch(inner as unknown as typeof fetch, (_t, id) => ids.push(id));
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    await (await tap(url, { body: '{}' })).text();
    await (await tap(url, { body: '{}' })).text();
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('opts the outbound chat request into reasoning', async () => {
    const inner = vi.fn(async () => new Response(streamOf([]), { status: 200 }));
    await reasoningTapFetch(inner as unknown as typeof fetch, () => {})(
      'https://openrouter.ai/api/v1/chat/completions',
      { body: JSON.stringify({ model: 'm' }) },
    );
    const sent = JSON.parse((inner.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.reasoning).toEqual({ enabled: true });
  });

  it('passes non-chat requests straight through without touching the body', async () => {
    const inner = vi.fn(async () => new Response('{}', { status: 200 }));
    const onReasoning = vi.fn();
    await reasoningTapFetch(inner as unknown as typeof fetch, onReasoning)(
      'https://openrouter.ai/api/v1/models',
      { body: JSON.stringify({ model: 'm' }) },
    );
    const sent = JSON.parse((inner.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.reasoning).toBeUndefined();
    expect(onReasoning).not.toHaveBeenCalled();
  });

  it('returns error responses untouched so the SDK can report them', async () => {
    const inner = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const res = await reasoningTapFetch(inner as unknown as typeof fetch, () => {})(
      'https://openrouter.ai/api/v1/chat/completions',
      { body: '{}' },
    );
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('rate limited');
  });
});

describe('createReasoningSink', () => {
  it('lets the first emitter own the run and ignores the other', () => {
    const onReasoning = vi.fn();
    const sink = createReasoningSink(onReasoning);
    sink.fromTap('a', 'b1');
    sink.fromSdk('SHOULD BE IGNORED', 'b1');
    sink.fromTap('a b', 'b1');
    expect(onReasoning.mock.calls).toEqual([
      ['a', 'b1'],
      ['a b', 'b1'],
    ]);
  });

  it('works the other way round when the SDK emits first', () => {
    const onReasoning = vi.fn();
    const sink = createReasoningSink(onReasoning);
    sink.fromSdk('x', 'b1');
    sink.fromTap('SHOULD BE IGNORED', 'b2');
    expect(onReasoning.mock.calls).toEqual([['x', 'b1']]);
  });

  it('is safe with no callback wired', () => {
    const sink = createReasoningSink(undefined);
    expect(() => sink.fromTap('a', 'b1')).not.toThrow();
  });
});
