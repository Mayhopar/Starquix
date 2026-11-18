// app/src/ai/__tests__/agentStreamParts.test.ts
import { it, expect, vi } from 'vitest';

vi.mock('ai', () => ({
  streamText: vi.fn(),
  stepCountIs: vi.fn(() => 'stop-cond'),
}));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: () => (m: string) => ({ modelId: m }) }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => Object.assign((m: string) => ({ modelId: m }), { chat: (m: string) => ({ modelId: m }) }) }));

import { streamText } from 'ai';
import { generateWithTools, resolveStepCap } from '../AIService';
import type { AIConfig } from '../types';

function fakeStream(parts: unknown[]) {
  return {
    fullStream: (async function* () { for (const p of parts) yield p; })(),
    response: Promise.resolve({}),
    finishReason: Promise.resolve('stop'),
    steps: Promise.resolve([{}]),
  };
}

it('routes tool-input-start/delta/end to the new callbacks', async () => {
  (streamText as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([
    // Real AI SDK v6 TextStreamPart shape: tool-input-delta carries `delta`
    // (NOT `inputTextDelta`, which belongs to the UI-message union — reading
    // that field made every delta '' and killed the stream preview).
    { type: 'tool-input-start', id: 'c1', toolName: 'add_page_content' },
    { type: 'tool-input-delta', id: 'c1', delta: '{"staticMarkup":"<div>' },
    { type: 'tool-input-end', id: 'c1' },
    { type: 'tool-call', toolCallId: 'c1', toolName: 'add_page_content', input: {} },
    { type: 'tool-result', toolCallId: 'c1', toolName: 'add_page_content', output: { success: true } },
  ]));

  const seen: string[] = [];
  await generateWithTools(
    { provider: 'anthropic', apiKey: 'k' } as never,
    [],
    {},
    {
      onText: () => {}, onToolCall: () => {}, onToolResult: () => {},
      onComplete: () => {}, onError: (e) => { throw e; },
      onToolInputStart: (name) => seen.push(`start:${name}`),
      onToolInputDelta: (d) => seen.push(`delta:${d}`),
      onToolInputEnd: () => seen.push('end'),
    },
  );
  expect(seen).toEqual(['start:add_page_content', 'delta:{"staticMarkup":"<div>', 'end']);
});

it('routes tool-error parts to onToolResult with success:false', async () => {
  (streamText as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([
    { type: 'tool-call', toolCallId: 'c1', toolName: 'update_element_by_key', input: { sourceKey: 'a' } },
    { type: 'tool-error', toolCallId: 'c1', toolName: 'update_element_by_key', error: new Error('boom') },
  ]));

  const results: Array<[string, unknown]> = [];
  await generateWithTools(
    { provider: 'anthropic', apiKey: 'k' } as never,
    [],
    {},
    {
      onText: () => {}, onToolCall: () => {},
      onToolResult: (n, r) => results.push([n, r]),
      onComplete: () => {}, onError: (e) => { throw e; },
    },
  );
  expect(results).toHaveLength(1); // tool-call emits no result; only the tool-error does
  const [name, errResult] = results[0];
  expect(name).toBe('update_element_by_key');
  expect((errResult as Record<string, unknown>).success).toBe(false);
  expect(String((errResult as Record<string, unknown>).error)).toContain('boom');
});

it('routes reasoning-delta parts to onReasoning (accumulated)', async () => {
  (streamText as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([
    { type: 'reasoning-start', id: 'r1' },
    { type: 'reasoning-delta', id: 'r1', text: 'Let me ' },
    { type: 'reasoning-delta', id: 'r1', text: 'think about the layout' },
    { type: 'reasoning-end', id: 'r1' },
    { type: 'text-delta', text: 'Done.' },
  ]));

  const reasoning: Array<[string, string]> = [];
  await generateWithTools(
    { provider: 'openrouter', apiKey: 'k', model: 'moonshotai/kimi-k3' } as never,
    [],
    {},
    {
      onText: () => {}, onToolCall: () => {}, onToolResult: () => {},
      onComplete: () => {}, onError: (e) => { throw e; },
      onReasoning: (t, id) => reasoning.push([t, id]),
    },
  );
  expect(reasoning).toEqual([
    ['Let me ', 'r1'],
    ['Let me think about the layout', 'r1'],
  ]);
});

it('keeps each step a separate reasoning block, accumulating per id', async () => {
  // Per-step blocks are the whole point: a shared accumulator would emit
  // "step onestep two" and the UI would show one merged thought.
  (streamText as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([
    { type: 'reasoning-start', id: 'r1' },
    { type: 'reasoning-delta', id: 'r1', text: 'step one' },
    { type: 'reasoning-start', id: 'r2' },
    { type: 'reasoning-delta', id: 'r2', text: 'step two' },
    { type: 'text-delta', text: 'Done.' },
  ]));

  const reasoning: Array<[string, string]> = [];
  await generateWithTools(
    { provider: 'openrouter', apiKey: 'k', model: 'moonshotai/kimi-k3' } as never,
    [],
    {},
    {
      onText: () => {}, onToolCall: () => {}, onToolResult: () => {},
      onComplete: () => {}, onError: (e) => { throw e; },
      onReasoning: (t, id) => reasoning.push([t, id]),
    },
  );
  expect(reasoning).toEqual([
    ['step one', 'r1'],
    ['step two', 'r2'],
  ]);
});

it('opens a block for a reasoning-delta that arrives with no preceding start', async () => {
  (streamText as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([
    { type: 'reasoning-delta', text: 'orphan thought' },
    { type: 'text-delta', text: 'Done.' },
  ]));

  const reasoning: Array<[string, string]> = [];
  await generateWithTools(
    { provider: 'openrouter', apiKey: 'k', model: 'moonshotai/kimi-k3' } as never,
    [],
    {},
    {
      onText: () => {}, onToolCall: () => {}, onToolResult: () => {},
      onComplete: () => {}, onError: (e) => { throw e; },
      onReasoning: (t, id) => reasoning.push([t, id]),
    },
  );
  expect(reasoning.map(([text]) => text)).toEqual(['orphan thought']);
  expect(reasoning[0][1]).toBeTruthy(); // synthetic id, never empty
});

describe('resolveStepCap', () => {
  const cfg = (over: Partial<AIConfig>): AIConfig => ({ provider: 'openrouter', apiKey: 'k', ...over });
  it('frontier providers get 40', () => {
    expect(resolveStepCap(cfg({ provider: 'anthropic' }))).toBe(40);
    expect(resolveStepCap(cfg({ provider: 'openai' }))).toBe(40);
  });
  it('openrouter frontier models get 40 (kimi-k3 no longer penalized)', () => {
    expect(resolveStepCap(cfg({ model: 'moonshotai/kimi-k3' }))).toBe(40);
    expect(resolveStepCap(cfg({ model: 'anthropic/claude-sonnet-4' }))).toBe(40);
  });
  it('openrouter :free tier and ollama keep the weak 15 cap', () => {
    expect(resolveStepCap(cfg({ model: 'deepseek/deepseek-chat-v3-0324:free' }))).toBe(15);
    expect(resolveStepCap(cfg({ provider: 'ollama', model: 'llama3.2' }))).toBe(15);
  });
});

it('fires onAbort when the stream emits an abort part', async () => {
  (streamText as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([{ type: 'abort' }]));

  const onAbort = vi.fn();
  const onComplete = vi.fn();
  await generateWithTools(
    { provider: 'anthropic', apiKey: 'k' } as never,
    [],
    {},
    {
      onText: () => {}, onToolCall: () => {}, onToolResult: () => {},
      onComplete, onError: (e) => { throw e; },
      onAbort,
    },
  );
  expect(onAbort).toHaveBeenCalledTimes(1);
  expect(onComplete).not.toHaveBeenCalled();
});

it('fires onAbort exactly once when abortSignal is aborted mid-stream', async () => {
  (streamText as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([
    { type: 'text-delta', text: 'x' },
    { type: 'text-delta', text: 'y' },
    { type: 'abort' }, // signal guard wins first; the abort part must not double-fire
  ]));

  const ac = new AbortController();
  const onAbort = vi.fn();
  const onComplete = vi.fn();
  const seenText: string[] = [];
  await generateWithTools(
    { provider: 'anthropic', apiKey: 'k' } as never,
    [],
    {},
    {
      onText: (t) => { seenText.push(t); ac.abort(); },
      onToolCall: () => {}, onToolResult: () => {},
      onComplete, onError: (e) => { throw e; },
      onAbort,
    },
    ac.signal,
  );
  expect(seenText).toEqual(['x']); // second delta never delivered
  expect(onAbort).toHaveBeenCalledTimes(1);
  expect(onComplete).not.toHaveBeenCalled();
});


it.each([
  [{ statusCode: 401 }, 'authorization'],
  [{ cause: { status: 403 } }, 'authorization'],
  [{ lastError: { errors: [{ statusCode: 402 }] } }, 'credits'],
  [{ errors: [{ cause: { status: 429 } }] }, 'rate-limit'],
  [{ statusCode: 503 }, 'connection'],
  [{ code: 'ECONNREFUSED' }, 'connection'],
  [new Error('credits 429 unauthorized https://untrusted.example/token-secret'), 'unknown'],
])('classifies structured provider failure without exposing raw diagnostics: %j', async (cause, failure) => {
  const error = Object.assign(cause, { message: '<html>429 credit unauthorized token-secret stack /private/file</html>' });
  (streamText as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([{ type: 'error', error }]));
  let received: Error | undefined;
  await generateWithTools({ provider: 'anthropic', apiKey: 'test' }, [], {}, {
    onText: () => {}, onToolCall: () => {}, onToolResult: () => {}, onComplete: () => {},
    onError: e => { received = e; },
  });
  expect(received).toMatchObject({ failure });
  expect(received?.message).not.toMatch(/token-secret|private|<html>/);
});
it('terminates classification for cyclic SDK causes', async () => {
  const error: { cause?: unknown; lastError?: unknown; status?: number } = { status: 402 };
  error.cause = error;
  error.lastError = error;
  (streamText as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([{ type: 'error', error }]));
  let received: Error | undefined;
  await generateWithTools({ provider: 'anthropic', apiKey: 'test' }, [], {}, {
    onText: () => {}, onToolCall: () => {}, onToolResult: () => {}, onComplete: () => {}, onError: e => { received = e; },
  });
  expect(received).toMatchObject({ failure: 'credits' });
});

it('a thrown abort stays cancellation rather than provider failure', async () => {
  (streamText as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new DOMException('token-secret', 'AbortError'); });
  const onAbort = vi.fn();
  const onError = vi.fn();
  const onComplete = vi.fn();
  await generateWithTools({ provider: 'anthropic', apiKey: 'test' }, [], {}, {
    onText: () => {}, onToolCall: () => {}, onToolResult: () => {}, onComplete, onError, onAbort,
  });
  expect(onAbort).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
});
it('a cyclic cause with no structured status safely falls back to unknown', async () => {
  const error: { cause?: unknown; errors?: unknown[] } = {};
  error.cause = error; error.errors = [error];
  (streamText as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([{ type: 'error', error }]));
  let received: Error | undefined;
  await generateWithTools({ provider: 'anthropic', apiKey: 'test' }, [], {}, {
    onText: () => {}, onToolCall: () => {}, onToolResult: () => {}, onComplete: () => {}, onError: e => { received = e; },
  });
  expect(received).toMatchObject({ failure: 'unknown' });
});
