/**
 * OpenRouter reasoning-token tap.
 *
 * `@ai-sdk/openai`'s chat-completions parser maps only `delta.content`,
 * `delta.tool_calls` and `delta.annotations`, so it drops the thinking tokens
 * OpenRouter sends — leaving a minutes-long reasoning phase with nothing to show.
 * The tap opts the request into reasoning, tees the SSE body, and parses the
 * reasoning fields off the copy; the SDK's branch is byte-identical.
 *
 * Field names per https://openrouter.ai/docs/use-cases/reasoning-tokens (2026-07-25).
 */

/**
 * Receives the running total for one reasoning block. `blockId` is stable for the
 * life of that block, so the UI can keep per-step blocks apart instead of
 * overwriting a single string.
 */
export type ReasoningSink = (fullText: string, blockId: string) => void;

/** Per-request block ids. One chat request = one agent step = one thought block. */
let blockSeq = 0;

/**
 * Pull reasoning text out of a single streamed `choices[].delta`.
 * Exported for tests — this is the whole provider-shape surface.
 */
export function extractReasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== 'object') return '';
  const d = delta as Record<string, unknown>;

  const details = d.reasoning_details;
  if (Array.isArray(details)) {
    let out = '';
    for (const entry of details) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as { text?: unknown; summary?: unknown };
      // `reasoning.encrypted` entries carry an opaque `data` blob, not text —
      // there is nothing to display, so they contribute nothing.
      if (typeof e.text === 'string') out += e.text;
      else if (typeof e.summary === 'string') out += e.summary;
    }
    // A details array that yielded no text (encrypted/redacted) must NOT fall
    // through to the legacy fields — on routes that send both, that would
    // re-append text we already counted.
    return out;
  }

  if (typeof d.reasoning === 'string') return d.reasoning;
  if (typeof d.reasoning_content === 'string') return d.reasoning_content; // deepseek-style
  return '';
}

/**
 * Feed SSE text in, get reasoning deltas out. Handles `data:` lines split across
 * network chunks, multiple events per chunk, `[DONE]`, comments and keep-alives.
 */
export function createSseReasoningParser(onDelta: (text: string) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue; // ": OPENROUTER PROCESSING" keep-alives land here
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      // Most events are content/tool-call deltas the SDK already parses. Every
      // field we read contains "reasoning", so a substring test skips the
      // JSON.parse for the large majority of a stream.
      if (!payload.includes('reasoning')) continue;
      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        continue; // partial or non-JSON payload — the SDK branch owns error reporting
      }
      const choices = (json as { choices?: unknown })?.choices;
      if (!Array.isArray(choices)) continue;
      for (const choice of choices) {
        const text = extractReasoningDelta((choice as { delta?: unknown })?.delta);
        if (text) onDelta(text);
      }
    }
  };
}

/**
 * Opt the request into reasoning. `reasoning: { enabled: true }` is OpenRouter's
 * current parameter; models that cannot reason ignore it rather than erroring.
 * An explicit `reasoning`/`include_reasoning` already on the body always wins.
 */
export function withReasoningEnabled(init?: RequestInit): RequestInit | undefined {
  if (typeof init?.body !== 'string') return init;
  try {
    const body = JSON.parse(init.body) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return init;
    if ('reasoning' in body || 'include_reasoning' in body) return init;
    return { ...init, body: JSON.stringify({ ...body, reasoning: { enabled: true } }) };
  } catch {
    return init; // not JSON — leave it alone
  }
}

async function drainReasoning(
  stream: ReadableStream<Uint8Array>,
  onReasoning: ReasoningSink,
  blockId: string,
  signal?: AbortSignal | null,
): Promise<void> {
  const decoder = new TextDecoder();
  let full = '';
  const feed = createSseReasoningParser((text) => {
    full += text;
    onReasoning(full, blockId);
  });
  const reader = stream.getReader();
  // Cancelling one tee branch does not cancel the source, so without this a Stop
  // leaves this copy pulling the whole response — and its closure holding the
  // run's scope — long after the SDK's branch is gone.
  const stop = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
    }
  } catch {
    // Aborted run or torn stream. The SDK's branch reports the failure; this
    // copy exists only to paint text, so it dies quietly.
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

/**
 * Wrap a fetch so OpenRouter chat completions stream their reasoning tokens.
 * Non-chat requests, error responses and body-less responses pass straight
 * through untouched.
 */
export function reasoningTapFetch(
  inner: typeof globalThis.fetch,
  onReasoning: ReasoningSink,
): typeof globalThis.fetch {
  return async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const isChat = url.includes('/chat/completions');
    if (!isChat) return inner(input, init);

    const res = await inner(input, withReasoningEnabled(init));
    if (!res.ok || !res.body) return res;

    // tee() gives the SDK an untouched branch; ours is read to completion so the
    // shared buffer never grows unbounded.
    const [forSdk, forTap] = res.body.tee();
    void drainReasoning(forTap, onReasoning, `or-reasoning-${++blockSeq}`, init?.signal);
    return new Response(forSdk, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}

/**
 * Single-owner reasoning sink.
 *
 * Both the SDK (`reasoning-delta` stream parts — live today on Anthropic) and
 * the tap (OpenRouter) can produce reasoning. If a future `@ai-sdk/openai` starts
 * mapping the field, both would fire for the same run and the UI would show the
 * text twice. First emitter claims ownership for the rest of the run; the other
 * is ignored.
 */
export function createReasoningSink(onReasoning?: ReasoningSink): {
  fromSdk: ReasoningSink;
  fromTap: ReasoningSink;
} {
  let owner: 'sdk' | 'tap' | null = null;
  return {
    fromSdk(fullText, blockId) {
      if (owner === 'tap') return;
      owner = 'sdk';
      onReasoning?.(fullText, blockId);
    },
    fromTap(fullText, blockId) {
      if (owner === 'sdk') return;
      owner = 'tap';
      onReasoning?.(fullText, blockId);
    },
  };
}
