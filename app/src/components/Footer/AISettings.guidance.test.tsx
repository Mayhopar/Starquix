import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { AISettings } from './AISettings';
import { McpTestProvider, type McpContextValue } from '@/mcp/__tests__/mcpTestProvider';

const ai = vi.hoisted(() => ({ config: null as null | Record<string, unknown>, setConfig: vi.fn() }));
vi.mock('@/ai/AIContext', () => ({ useAI: () => ai }));
vi.mock('@/ai/AIService', () => ({ testConnection: vi.fn(async () => true) }));

function mcp(over: Partial<McpContextValue> = {}): McpContextValue {
  return { status: { state: 'waiting' }, lastCall: null, code: 'W6J.' + 'a'.repeat(24), newCode: vi.fn(), ...over };
}
const renderSettings = (m = mcp()) => render(<McpTestProvider value={m}><AISettings isOpen onClose={() => {}} /></McpTestProvider>);

describe('AISettings: the model form, the MCP prompt, then Images + the system prompt', () => {
  beforeEach(() => { ai.config = null; ai.setConfig.mockClear(); });

  it('one body: the provider/model/key form (no Ollama) AND the MCP prompt — no Mode switch', () => {
    renderSettings();
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    for (const p of ['Anthropic', 'OpenAI', 'OpenRouter']) expect(screen.getByRole('button', { name: p })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ollama' })).toBeNull();
    expect(screen.getByTestId('mcp-prompt')).toBeInTheDocument();
    expect(screen.queryByText('Mode')).toBeNull();
    expect(screen.queryByRole('button', { name: 'MCP' })).toBeNull();
  });

  it('Images (Pexels, image generation) save on their own', () => {
    renderSettings();
    const pexels = screen.getByLabelText('Pexels API key');
    fireEvent.change(pexels, { target: { value: 'px-123' } });
    fireEvent.blur(pexels);
    expect(ai.setConfig).toHaveBeenCalledWith(expect.objectContaining({ pexelsApiKey: 'px-123' }));
    ai.setConfig.mockClear();
  });

  it('the Prompt entry opens the system prompt (an MCP agent gets it via designGuide)', () => {
    render(<McpTestProvider value={mcp()}><AISettings isOpen onClose={() => {}} initialTab="prompts" /></McpTestProvider>);
    expect(screen.getByLabelText('System prompt')).toBeInTheDocument();
  });

  it('API Save keeps the Images keys (same config)', () => {
    ai.config = { provider: 'anthropic', apiKey: 'sk-ant-x', model: 'claude-sonnet-4-6', pexelsApiKey: 'px-1' };
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(ai.setConfig).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-ant-x', pexelsApiKey: 'px-1' }));
  });

  const imageOptions = () => Array.from((screen.getByLabelText('Image generation') as HTMLSelectElement).options).map(o => o.text);

  // Owner 2026-11-08: an OpenRouter chat key + an "OpenRouter" image option that asked for a key read as "two keys".
  it('an OpenRouter chat key covers images: no second OpenRouter key on offer', () => {
    ai.config = { provider: 'openrouter', apiKey: 'sk-or-x' };
    renderSettings();
    expect(imageOptions()).toEqual(['Use my OpenRouter key', 'OpenAI (gpt-image-1)']);
  });

  it('a separate image key never makes an Anthropic chat key "cover" images', () => {
    ai.config = { provider: 'anthropic', apiKey: 'sk-ant-x', imageProvider: 'openai', imageApiKey: 'sk-img' };
    renderSettings();
    expect(imageOptions()[0]).toBe('None');
  });

  it('a saved separate key for the chat provider stays selectable', () => {
    ai.config = { provider: 'openrouter', apiKey: 'sk-or-x', imageProvider: 'openrouter', imageApiKey: 'sk-or-img' };
    renderSettings();
    expect(imageOptions()).toContain('OpenRouter (Gemini 2.5 Flash Image)');
  });
});
