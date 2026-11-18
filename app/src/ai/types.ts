// src/ai/types.ts

export type AIProvider = 'anthropic' | 'openai' | 'openrouter' | 'ollama';

/** Can the built-in chat run? A key, or a legacy local Ollama config. The ONE
 *  check — the footer, the chat, the mode default and the model pill share it. */
export function hasChatKey(config: AIConfig | null | undefined): boolean {
  return !!config && (config.provider === 'ollama' || !!config.apiKey?.trim());
}

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  /** Pexels API key — enables the search_stock_images AI tool */
  pexelsApiKey?: string;
  /** Separate image-generation provider; overrides chat-key reuse when set with imageApiKey */
  imageProvider?: 'openai' | 'openrouter';
  imageApiKey?: string;
}

export interface AIContextElement {
  key: string;
  elementId: string;
  tagName: string;
  displayLabel: string;
  selector?: string;
  classes?: string;
  html?: string;
}

/** One tool call in an assistant run, rendered as a live activity-feed row. */
export interface AIActivity {
  id: string;
  toolName: string;
  label: string;
  /** Short result note ("3 elements", "failed: not found") set when the call resolves. */
  detail?: string;
  status: 'running' | 'done' | 'error';
  /** Element/page/variable key for hover-highlight on canvas. */
  key?: string;
  /** Epoch ms when the call started — drives the live elapsed counter so a long
   *  tool (image gen) is visibly progressing rather than indistinguishable from a hang. */
  startedAt?: number;
}

/**
 * One contiguous block of reasoning-model thinking, from a single agent step.
 *
 * A run produces one block per step, interleaved with the tool rows it preceded —
 * kept whole rather than overwritten, so the finished message reads as the actual
 * transcript ("thought → did → thought → did") instead of only the last step's
 * leftovers.
 */
export interface AIThought {
  /** Stable per-block id: the provider's reasoning-part id, or one minted per request. */
  id: string;
  /** Full accumulated thinking text for this block — never truncated in the model. */
  text: string;
  startedAt: number;
  /** Set when the block closes (its step's first tool call, or run end) → "Thought for Ns".
   *  While unset the block is still streaming and renders auto-expanded. */
  endedAt?: number;
  /** `activities.length` when this block opened — the feed renders it immediately
   *  before that activity row, which is what puts the timeline in real order. */
  activityIndex: number;
}

export type AIFailureCode = 'configuration' | 'authorization' | 'credits' | 'rate-limit' | 'connection' | 'save' | 'unknown';

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'streaming' | 'complete' | 'error' | 'needs-continue';
  /** Finite feedback, kept separate from the exact model reply. */
  failure?: AIFailureCode;
  contextElements?: AIContextElement[];
  activities?: AIActivity[];
  /** Per-step reasoning blocks. A minutes-long thinking phase streams live here
   *  instead of leaving a static "Thinking…" with nothing behind it. */
  thoughts?: AIThought[];
  /** Where each run of reply text began (`offset` into `content`) and the activity row it preceded, so the chat shows
   *  "text → tools → text" in order. Absent on messages saved before 2026-11-08: their text renders after the feed. */
  textAnchors?: { activityIndex: number; offset: number }[];
  /** When the reply settled (complete, error, needs-continue, cancelled): "Worked for Ns". */
  endedAt?: number;
}

/** Default models per provider */
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  openrouter: 'google/gemini-2.5-flash-preview-05-20',
  ollama: 'llama3.2:1b',
};

/** Available models per provider */
export const AVAILABLE_MODELS: Record<AIProvider, { id: string; name: string }[]> = {
  anthropic: [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  ],
  openrouter: [
    { id: 'google/gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash' },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)' },
    { id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek V3 (Free)' },
    { id: 'qwen/qwen3-235b-a22b:free', name: 'Qwen 3 235B (Free)' },
    { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B (Free)' },
  ],
  ollama: [
    { id: 'llama3.2:1b', name: 'Llama 3.2 1B (light)' },
    { id: 'llama3.2', name: 'Llama 3.2 3B' },
    { id: 'llama3.1', name: 'Llama 3.1 8B' },
    { id: 'tinyllama', name: 'TinyLlama (smallest)' },
  ],
};
