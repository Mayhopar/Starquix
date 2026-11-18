// src/components/Footer/AISettings.tsx
// The chat's model (provider/model/key form), then the MCP pairing prompt + light (agents in the Terminal tab and
// outside), then images (Pexels, image generation) and the system prompt — the chat runs on it and an MCP agent gets
// it through get_project's designGuide. Images and the prompt save on their own.
import React, { useState, useCallback, useEffect } from 'react';
import { Badge, Button, Field, IconButton, Modal, OperationNotice, Row, SegmentedControl } from '@/components/ui';
import { CloseIcon, HiddenIcon, VisibleIcon } from '@/assets/icons';
import { McpTab } from './McpTab';
import { useAI } from '@/ai/AIContext';
import { testConnection } from '@/ai/AIService';
import type { AIConfig, AIProvider } from '@/ai/types';
import { AVAILABLE_MODELS, DEFAULT_MODELS } from '@/ai/types';
import { chatImageGen, IMAGE_CAPABLE_PROVIDERS, type ImageGenProvider } from '@/ai/imageGen';
import { useMcpOptional } from '@/mcp/McpContext';
import { loadCustomPrompts, saveCustomPrompts, DEFAULT_SYSTEM_PROMPT, type CustomPromptsStore } from '@/ai/prompts/userPrompts';

const OPENROUTER_CACHE_KEY = 'sq_openrouter_models';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

interface ModelCache {
  models: { id: string; name: string }[];
  fetchedAt: number;
}

function loadCachedModels(): ModelCache | null {
  try {
    const raw = localStorage.getItem(OPENROUTER_CACHE_KEY);
    if (!raw) return null;
    const cache: ModelCache = JSON.parse(raw);
    if (Date.now() - cache.fetchedAt > CACHE_TTL_MS) return null;
    return cache;
  } catch {
    return null;
  }
}

async function fetchOpenRouterModels(apiKey?: string): Promise<{ id: string; name: string }[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
  if (!res.ok) throw new Error('Failed to fetch');
  const json = await res.json();
  const models = (json.data as { id: string; name: string }[])
    .map(m => ({ id: m.id, name: m.name ?? m.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  localStorage.setItem(OPENROUTER_CACHE_KEY, JSON.stringify({ models, fetchedAt: Date.now() } satisfies ModelCache));
  return models;
}

/** 'prompts' opens with the system prompt expanded. */
export type SettingsTab = 'api' | 'prompts';

// Ollama was dropped from the UI (2026-09-27).
type ChatProvider = Exclude<AIProvider, 'ollama'>;
const PROVIDER_LABELS: Record<ChatProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter' };
const PROVIDERS: ChatProvider[] = ['anthropic', 'openai', 'openrouter'];
const API_KEY_PLACEHOLDERS: Record<string, string> = { anthropic: 'sk-ant-...', openrouter: 'sk-or-...' };
const DEFAULT_KEY_PLACEHOLDER = 'sk-...';

interface AISettingsProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export const AISettings: React.FC<AISettingsProps> = ({ isOpen, onClose, initialTab }) => {
  const mcp = useMcpOptional();
  const bottom = <>{mcp && <McpTab />}<ImagesSection /><SystemPrompt initiallyOpen={initialTab === 'prompts'} /></>;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" className="flex flex-col max-h-[80vh]">
      <Row title="AI settings" className="pl-4 pr-2 border-b border-stroke" hover={false}
        right={[{ type: 'custom', unboxed: true, node: (
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" icon={<CloseIcon className="w-4 h-4" />} onClick={onClose} />
        ) }]} />
      <ApiForm onClose={onClose} bottom={bottom} />
    </Modal>
  );
};

/** The window's scrolling body: one 16px left edge, kit rows and fields stacked tight. */
function Body({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-2 space-y-2">{children}</div>;
}

/** A label Row over a full-width control (culture.md: long inputs). */
function Labeled({ label, children, right, rightText }: { label: string; children: React.ReactNode; right?: React.ReactNode; rightText?: string }): React.ReactElement {
  return (
    <div>
      <Row title={label} size="sm" className="px-0" hover={false} rightText={rightText}
        right={right ? [{ type: 'custom', unboxed: true, node: right }] : undefined} />
      {children}
    </div>
  );
}

function ApiForm({ onClose, bottom }: { onClose: () => void; bottom: React.ReactNode }): React.ReactElement {
  const { config, setConfig } = useAI();
  const saved = config && config.provider !== 'ollama' ? config : null;
  const [provider, setProvider] = useState<ChatProvider>((saved?.provider as ChatProvider) || 'anthropic');
  const [apiKey, setApiKey] = useState(saved?.apiKey || '');
  const [model, setModel] = useState(saved?.model || DEFAULT_MODELS[provider]);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  // One cache read per open (the cached OpenRouter list is tens of KB of JSON).
  const [cached] = useState(loadCachedModels);
  const [openRouterModels, setOpenRouterModels] = useState<{ id: string; name: string }[] | null>(cached?.models ?? null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsFetchedAt, setModelsFetchedAt] = useState<number | null>(cached?.fetchedAt ?? null);

  const loadOpenRouterModels = useCallback((force = false) => {
    if (!force) {
      const cache = loadCachedModels();
      if (cache) { setOpenRouterModels(cache.models); setModelsFetchedAt(cache.fetchedAt); return; }
    }
    setLoadingModels(true);
    fetchOpenRouterModels(apiKey || undefined)
      .then(models => { setOpenRouterModels(models); setModelsFetchedAt(Date.now()); })
      .catch(() => {/* keep existing models on error */})
      .finally(() => setLoadingModels(false));
  }, [apiKey]);

  useEffect(() => {
    if (provider !== 'openrouter' || openRouterModels) return; // the mount-time cache already covers it
    loadOpenRouterModels();
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProviderChange = (p: ChatProvider) => { setProvider(p); setModel(DEFAULT_MODELS[p]); setTestResult(null); };

  const handleSave = () => {
    // Keep the Images section's keys: they live in the same config.
    setConfig({ ...config, provider, apiKey, model });
    onClose();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestResult((await testConnection({ provider, apiKey, model })) ? 'success' : 'error');
    setTesting(false);
  };

  return (
    <>
      <Body>
        <Labeled label="Provider">
          <SegmentedControl
            options={PROVIDERS.map(p => ({ value: p, label: PROVIDER_LABELS[p] }))}
            value={provider}
            onChange={v => handleProviderChange(v as ChatProvider)}
          />
        </Labeled>
        <Labeled
          label="Model"
          rightText={provider === 'openrouter' && modelsFetchedAt ? `Updated ${new Date(modelsFetchedAt).toLocaleDateString()}` : undefined}
          right={provider === 'openrouter' && (
            <Button variant="ghost" size="sm" onClick={() => loadOpenRouterModels(true)} disabled={loadingModels} label={loadingModels ? 'Refreshing…' : 'Refresh'} />
          )}
        >
          <Field
            as="select"
            aria-label="Model"
            value={model}
            onChange={setModel}
            disabled={loadingModels}
            options={(provider === 'openrouter' && openRouterModels ? openRouterModels : AVAILABLE_MODELS[provider]).map(m => ({ value: m.id, label: m.name }))}
          />
        </Labeled>
        <Labeled label="API key">
          <Field
            type={showKey ? 'text' : 'password'}
            autoComplete="new-password"
            aria-label="API key"
            value={apiKey}
            onChange={v => { setApiKey(v); setTestResult(null); }}
            placeholder={API_KEY_PLACEHOLDERS[provider] || DEFAULT_KEY_PLACEHOLDER}
            trailing={(
              <IconButton size="sm" className="w-4 h-4" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide key' : 'Show key'} title={showKey ? 'Hide key' : 'Show key'}>
                {showKey ? <HiddenIcon className="w-4 h-4" /> : <VisibleIcon className="w-4 h-4" />}
              </IconButton>
            )}
          />
        </Labeled>
        {testResult === 'error' && <OperationNotice title="Connection failed." detail="Check your API key." />}
        {bottom}
      </Body>
      <div className="flex items-center gap-2 border-t border-stroke px-4 py-2">
        <Button variant="ghost" size="md" onClick={handleTest} disabled={!apiKey || testing} label={testing ? 'Testing…' : 'Test connection'} />
        {testResult === 'success' && <Badge variant="success">Connected</Badge>}
        <div className="flex-1" />
        <Button variant="primary" size="md" onClick={handleSave} disabled={!apiKey} label="Save" />
      </div>
    </>
  );
}

/** Pexels + image generation: the chat and an MCP agent call the same image tools; saves on its own. */
function ImagesSection(): React.ReactElement {
  const { config, setConfig } = useAI();
  const [pexels, setPexels] = useState(config?.pexelsApiKey || '');
  const [imageProvider, setImageProvider] = useState<ImageGenProvider | ''>(config?.imageProvider || '');
  const [imageKey, setImageKey] = useState(config?.imageApiKey || '');
  const save = (patch: Partial<AIConfig>) => setConfig({ ...(config ?? { provider: 'openrouter', apiKey: '' }), ...patch });
  const chatGen = chatImageGen(config);
  const chatName = config ? (PROVIDER_LABELS as Record<string, string>)[config.provider] ?? config.provider : '';

  return (
    <>
      <Row title="Images" size="sm" className="px-0 mt-2" hover={false} right={[{ type: 'badge', label: 'Optional', variant: 'default' }]} />
      <Labeled label="Pexels API key">
        <Field
          type="password"
          aria-label="Pexels API key"
          value={pexels}
          onChange={setPexels}
          onBlur={() => save({ pexelsApiKey: pexels.trim() || undefined })}
          placeholder="Stock photo search — free key at pexels.com/api"
        />
      </Labeled>
      <Labeled label="Image generation">
        <Field
          as="select"
          aria-label="Image generation"
          value={imageProvider}
          onChange={v => {
            const next = v as ImageGenProvider | '';
            setImageProvider(next);
            if (!next) save({ imageProvider: undefined, imageApiKey: undefined });
          }}
          // The chat key's own provider would only ask for that key again — kept when a separate key is already saved.
          options={[{ value: '', label: chatGen ? `Use my ${chatName} key` : 'None' }, ...IMAGE_CAPABLE_PROVIDERS
            .filter(p => p.id !== chatGen?.provider || p.id === imageProvider)
            .map(p => ({ value: p.id, label: p.name }))]}
        />
      </Labeled>
      {imageProvider && (
        <Field
          type="password"
          aria-label="Image generation key"
          value={imageKey}
          onChange={setImageKey}
          onBlur={() => save({ imageProvider, imageApiKey: imageKey.trim() || undefined })}
          placeholder={API_KEY_PLACEHOLDERS[imageProvider] || DEFAULT_KEY_PLACEHOLDER}
        />
      )}
    </>
  );
}

/** The chat's system prompt — also what the MCP agent follows (get_project → designGuide). Saves on blur. */
function SystemPrompt({ initiallyOpen }: { initiallyOpen: boolean }): React.ReactElement {
  const [promptOpen, setPromptOpen] = useState(initiallyOpen);
  const [prompts, setPrompts] = useState<CustomPromptsStore>(loadCustomPrompts);
  const systemPrompt = prompts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const update = (next: CustomPromptsStore) => { setPrompts(next); saveCustomPrompts(next); };

  return (
    <Row
      title="System prompt"
      size="sm"
      className="px-0 mt-2"
      hover={false}
      expandable
      expanded={promptOpen}
      onExpandChange={setPromptOpen}
      right={prompts.systemPrompt ? [{ type: 'custom', unboxed: true, node: (
        <Button variant="ghost" size="sm" label="Reset to default" onClick={() => { const n = { ...prompts }; delete n.systemPrompt; update(n); }} />
      ) }] : undefined}
    >
      <Field
        as="textarea"
        aria-label="System prompt"
        value={systemPrompt}
        onChange={v => setPrompts(p => ({ ...p, systemPrompt: v }))}
        onBlur={() => saveCustomPrompts(prompts)}
        rows={6}
        mono
      />
    </Row>
  );
}
