// The chat marks the stable start of its system prompt for the provider's prompt cache, so the later
// tool steps of a run (each re-sends the whole prompt) and the next requests read it at the cached price.
// Real `ai` SDK and providers — only the network is stubbed, so each body below is what leaves the app.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { generateWithTools, promptCacheFetch, type AgentMessage } from '../AIService';
import { generateCommandTools } from '../tools/commandTools';
import { makeCtx } from '../tools/__tests__/testCtx';
import type { AIConfig } from '../types';

const STABLE = 'You are the editor agent.\n\nRules that are the same on every request.';
const CHANGING = '## Current Editor State\n- Active Page: Home';
const FULL = `${STABLE}\n\n${CHANGING}`;
const MARKER = { type: 'ephemeral' };
/** What the chat hands the service: one system prompt, its stable start measured. */
const split = (): AgentMessage[] => [
  { role: 'system', content: FULL, stableChars: STABLE.length },
  { role: 'user', content: 'Hi' },
];
/** The same prompt as it was handed over before the split. */
const unsplit = (): AgentMessage[] => [
  { role: 'system', content: FULL },
  { role: 'user', content: 'Hi' },
];

const ANTHROPIC: AIConfig = { provider: 'anthropic', apiKey: 'k' };
const OPENROUTER_CLAUDE: AIConfig = { provider: 'openrouter', apiKey: 'k', model: 'anthropic/claude-sonnet-4' };

// --- provider replies (server-sent events): the least each SDK parser accepts ---
const sse = (events: unknown[]) => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
const anthropicReply = (block: object, delta: object, stop: string, usage: object = { input_tokens: 1 }) => sse([
  { type: 'message_start', message: { id: 'msg_1', model: 'm', role: 'assistant', usage } },
  { type: 'content_block_start', index: 0, content_block: block },
  { type: 'content_block_delta', index: 0, delta },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 1 } },
  { type: 'message_stop' },
]);
const anthropicText = (usage?: object) => anthropicReply({ type: 'text', text: '' }, { type: 'text_delta', text: 'ok' }, 'end_turn', usage);
const anthropicToolCall = anthropicReply({ type: 'tool_use', id: 'toolu_1', name: 'ping' }, { type: 'input_json_delta', partial_json: '{}' }, 'tool_use');
const chatReply = (delta: object, finish: string) => sse([
  { id: 'c1', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] },
  { id: 'c1', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: finish }] },
]) + 'data: [DONE]\n\n';
const chatText = chatReply({ content: 'ok' }, 'stop');
const chatToolCall = chatReply({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'ping', arguments: '{}' } }] }, 'tool_calls');
const responsesText = sse([
  { type: 'response.created', response: { id: 'resp_1', created_at: 1, model: 'gpt-4o' } },
  { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } },
]);

type Body = { system?: unknown; messages: unknown[]; tools?: unknown[] };

/** Answer each request with the next reply; returns the request bodies as sent. */
function stubNetwork(replies: string[]) {
  const sent: Body[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(init!.body as string));
    return new Response(replies[sent.length - 1], { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }));
  return sent;
}

/** One agent run, wired like the chat: both observers on, so every fetch wrapper is in the chain. */
async function run(config: AIConfig, messages: AgentMessage[], tools: ToolSet = {}) {
  const errors: Error[] = [];
  await generateWithTools(config, messages, tools, {
    onText: () => {}, onToolCall: () => {}, onToolResult: () => {}, onComplete: () => {},
    onError: e => errors.push(e), onReasoning: () => {}, onRateLimit: () => {},
  });
  expect(errors).toEqual([]);
}

const ping: ToolSet = { ping: tool({ description: 'Ping', inputSchema: z.object({}), execute: async () => ({ success: true }) }) };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('prompt cache marker on the stable part of the system prompt', () => {
  it('anthropic: the stable part is a system block of its own with the marker, the changing part follows', async () => {
    const sent = stubNetwork([anthropicText()]);
    await run(ANTHROPIC, split());
    expect(sent[0].system).toEqual([
      { type: 'text', text: STABLE, cache_control: MARKER },
      { type: 'text', text: `\n\n${CHANGING}` }, // the two blocks together are the prompt as it was
    ]);
    expect(JSON.stringify(sent[0].messages)).not.toContain('cache_control');
  });

  it('openrouter with an Anthropic model: the marker is on the stable content part, the changing part follows', async () => {
    const sent = stubNetwork([chatText]);
    await run(OPENROUTER_CLAUDE, split());
    expect(sent[0].messages).toEqual([
      { role: 'system', content: [
        { type: 'text', text: STABLE, cache_control: MARKER },
        { type: 'text', text: `\n\n${CHANGING}` },
      ] },
      { role: 'user', content: 'Hi' },
    ]);
  });

  it.each([
    ['anthropic', ANTHROPIC, [anthropicToolCall, anthropicText()], (body: Body) => body.system],
    ['openrouter with an Anthropic model', OPENROUTER_CLAUDE, [chatToolCall, chatText], (body: Body) => body.messages[0]],
  ] as const)('%s: every tool step re-sends the same marked prefix', async (_name, config, replies, system) => {
    const sent = stubNetwork([...replies]);
    await run(config, split(), ping);
    expect(sent).toHaveLength(2); // the tool call, then the reply after its result
    expect(JSON.stringify(system(sent[0]))).toContain('"cache_control":{"type":"ephemeral"}');
    expect(JSON.stringify(system(sent[1]))).toBe(JSON.stringify(system(sent[0])));
    expect(JSON.stringify(sent[1].tools)).toBe(JSON.stringify(sent[0].tools));
    expect(sent[1].messages.length).toBeGreaterThan(sent[0].messages.length); // the tool round trip comes after it
  });

  // These cache a repeated prefix by themselves (or not at all): no marker, the request as it always was.
  it.each([
    ['openai', { provider: 'openai', apiKey: 'k' }, responsesText],
    ['openrouter, default model', { provider: 'openrouter', apiKey: 'k' }, chatText],
    ['openrouter, another model', { provider: 'openrouter', apiKey: 'k', model: 'moonshotai/kimi-k3' }, chatText],
    ['ollama', { provider: 'ollama', apiKey: '' }, chatText],
  ] as const)('%s: the request is the one the unsplit prompt gives', async (_name, config, reply) => {
    const sent = stubNetwork([reply, reply]);
    await run(config, split());
    await run(config, unsplit());
    expect(sent[0]).toEqual(sent[1]);
    expect(JSON.stringify(sent[0])).toContain(JSON.stringify(FULL)); // one string, stable part first
    expect(JSON.stringify(sent[0])).not.toContain('cache_control');
  });

  it('no stable part measured: no marker, even on Anthropic', async () => {
    const sent = stubNetwork([anthropicText()]);
    await run(ANTHROPIC, unsplit());
    expect(sent[0].system).toEqual([{ type: 'text', text: FULL }]);
  });

  // Tools render ahead of the system prompt, so they are the start of the cached prefix.
  it('the tool definitions are the same, in the same order, on every request', async () => {
    const sent = stubNetwork([anthropicText(), anthropicText()]);
    await run(ANTHROPIC, split(), generateCommandTools(makeCtx()));
    await run(ANTHROPIC, split(), generateCommandTools(makeCtx()));
    expect(sent[0].tools!.length).toBeGreaterThan(50);
    expect(JSON.stringify(sent[1].tools)).toBe(JSON.stringify(sent[0].tools));
  });

  // A cache that stops being hit raises no error — the bill is just higher. This line is the only place it shows.
  it('logs what each step read from the cache', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    stubNetwork([anthropicToolCall, anthropicText({ input_tokens: 5, cache_read_input_tokens: 1200 })]);
    await run(ANTHROPIC, split(), ping);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('cache read 1200'));
  });
});

describe('promptCacheFetch', () => {
  const sentBody = async (body: string | undefined) => {
    const inner = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'));
    await promptCacheFetch(inner as typeof fetch, STABLE)('https://openrouter.ai/api/v1/chat/completions', { body });
    return inner.mock.calls[0][1]?.body;
  };

  it('leaves a request alone unless its system message starts with the stable part', async () => {
    const other = JSON.stringify({ messages: [{ role: 'system', content: 'Something else' }] });
    expect(await sentBody(other)).toBe(other);
    const noSystem = JSON.stringify({ messages: [{ role: 'user', content: FULL }] });
    expect(await sentBody(noSystem)).toBe(noSystem);
    expect(await sentBody('not json')).toBe('not json');
    expect(await sentBody(undefined)).toBeUndefined();
  });

  it('marks a system message that is only the stable part, with no empty second part', async () => {
    const body = JSON.parse(await sentBody(JSON.stringify({ messages: [{ role: 'system', content: STABLE }] })) as string);
    expect(body.messages[0].content).toEqual([{ type: 'text', text: STABLE, cache_control: MARKER }]);
  });
});
