// src/ai/AIContext.tsx
import React, { useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { AIConfig, AIMessage, AIContextElement } from './types';
import { parseKey } from '@/store/types';
import { selectResolvedStaticMarkup } from '@/store/selectors';
import { useEditorDoc } from '@/store';
import { useTool } from '@/context';
import { stableContext } from '@/utils/stableContext';
import { onAgentKeysAdded } from '@/services/agentCanvasActivity';

const STORAGE_KEY = 'starquix:ai-config';
const TOUCHED_STORAGE_KEY = 'starquix:ai-touched';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function loadTouchedKeys(): string[] {
  try {
    const raw = localStorage.getItem(TOUCHED_STORAGE_KEY);
    if (!raw) return [];
    const map: Record<string, number> = JSON.parse(raw);
    const now = Date.now();
    return Object.entries(map)
      .filter(([, ts]) => now - ts < SEVEN_DAYS_MS)
      .map(([key]) => key);
  } catch {
    return [];
  }
}

function persistTouchedKey(key: string, currentKeys: string[]): string[] {
  try {
    const raw = localStorage.getItem(TOUCHED_STORAGE_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    map[key] = now;
    // Prune old entries
    for (const k of Object.keys(map)) {
      if (now - map[k] >= SEVEN_DAYS_MS) delete map[k];
    }
    localStorage.setItem(TOUCHED_STORAGE_KEY, JSON.stringify(map));
    return Object.keys(map);
  } catch {
    return currentKeys.includes(key) ? currentKeys : [...currentKeys, key];
  }
}

function cleanHTML(html: string): string {
  return html
    .replace(/\s*data-key="[^"]*"/g, '')
    .replace(/\s*data-sq-source="[^"]*"/g, '');
}

/** A reply that leaves 'streaming' records when — "Worked for Ns" in the chat. */
function settled(m: AIMessage, updates: Partial<AIMessage>): AIMessage {
  return updates.status && updates.status !== 'streaming' && !updates.endedAt ? { ...m, endedAt: Date.now() } : m;
}

export interface ChatSession {
  id: string;
  messages: AIMessage[];
}

const newChatId = (): string =>
  `chat-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Browser-tab close logic: activate the tab to the RIGHT of the closed one,
 *  else the left neighbor. Returns null when no tabs remain. */
export function nextActiveAfterClose(
  ids: readonly string[],
  activeId: string,
  closedId: string,
): string | null {
  const remaining = ids.filter(id => id !== closedId);
  if (remaining.length === 0) return null;
  if (closedId !== activeId) return activeId;
  const closedIdx = ids.indexOf(closedId);
  return remaining[Math.min(closedIdx, remaining.length - 1)];
}

interface AIState {
  isGenerating: boolean;
  streamedContent: string;
  generatedHTML: string | null;
  error: string | null;
  messages: AIMessage[];
  sessions: ChatSession[];
  activeSessionId: string;
  config: AIConfig | null;
  contextElements: AIContextElement[];
  activeKeys: string[];
  recentlyTouchedKeys: string[];
}

interface AIContextValue extends AIState {
  setConfig: (config: AIConfig) => void;
  setIsGenerating: (v: boolean) => void;
  setStreamedContent: (v: string) => void;
  setGeneratedHTML: (v: string | null) => void;
  setError: (v: string | null) => void;
  addMessage: (msg: AIMessage) => void;
  updateMessage: (id: string, updates: Partial<AIMessage>) => void;
  truncateMessagesAfter: (id: string) => void;
  newSession: () => void;
  switchSession: (id: string) => void;
  closeSession: (id: string) => void;
  addContextElement: (el: AIContextElement) => void;
  removeContextElement: (key: string) => void;
  clearContextElements: () => void;
  markActiveKey: (key: string) => void;
  clearActiveKeys: () => void;
  recordTouchedKey: (key: string) => void;
  abortRef: React.MutableRefObject<AbortController | null>;
}

const AIContext = stableContext<AIContextValue | null>('AIContext', null);

/** Read the persisted AI config. Exported for non-React callers (AI image tools). */
export function loadAIConfig(): AIConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage may not be available
  }
}

export const AIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const doc = useEditorDoc();
  const { activeTool } = useTool();
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedContent, setStreamedContent] = useState('');
  const [generatedHTML, setGeneratedHTML] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Browser-style chat tabs: `messages` is always the ACTIVE session's list;
  // new messages target the active session; updates target the message identity. One state object so
  // session list + active id transition atomically (no ref mirror, no
  // setState inside another updater).
  const [chatState, setChatState] = useState<{ sessions: ChatSession[]; activeId: string }>(
    { sessions: [{ id: 'chat-1', messages: [] }], activeId: 'chat-1' },
  );
  const { sessions, activeId: activeSessionId } = chatState;
  const messages = sessions.find(s => s.id === activeSessionId)?.messages ?? [];
  const setMessages = useCallback((updater: (prev: AIMessage[]) => AIMessage[]) => {
    setChatState(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => (s.id === prev.activeId ? { ...s, messages: updater(s.messages) } : s)),
    }));
  }, []);
  const [config, setConfigState] = useState<AIConfig | null>(loadAIConfig);
  const [contextElements, setContextElements] = useState<AIContextElement[]>([]);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const [recentlyTouchedKeys, setRecentlyTouchedKeys] = useState<string[]>(loadTouchedKeys);
  const abortRef = useRef<AbortController | null>(null);

  const setConfig = useCallback((c: AIConfig) => {
    setConfigState(c);
    saveConfig(c);
  }, []);

  const addMessage = useCallback((msg: AIMessage) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<AIMessage>) => {
    setChatState(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => s.messages.some(m => m.id === id)
        ? { ...s, messages: s.messages.map(m => m.id === id ? settled({ ...m, ...updates }, updates) : m) }
        : s),
    }));
  }, []);

  const newSession = useCallback(() => {
    setError(null);
    const fresh: ChatSession = { id: newChatId(), messages: [] };
    setChatState(prev => ({ sessions: [...prev.sessions, fresh], activeId: fresh.id }));
  }, []);

  const switchSession = useCallback((id: string) => {
    setError(null);
    setChatState(prev => ({ ...prev, activeId: id }));
  }, []);

  const closeSession = useCallback((id: string) => {
    setError(null);
    setChatState(prev => {
      const remaining = prev.sessions.filter(s => s.id !== id);
      if (remaining.length === 0) {
        // Last tab closed → fresh empty one, like a browser keeping one tab alive.
        const fresh: ChatSession = { id: newChatId(), messages: [] };
        return { sessions: [fresh], activeId: fresh.id };
      }
      return {
        sessions: remaining,
        activeId: nextActiveAfterClose(prev.sessions.map(s => s.id), prev.activeId, id) ?? prev.activeId,
      };
    });
  }, []);

  const truncateMessagesAfter = useCallback((id: string) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      return prev.slice(0, idx + 1);
    });
  }, []);

  const markActiveKey = useCallback((key: string) => {
    setActiveKeys(prev => prev.includes(key) ? prev : [...prev, key]);
  }, []);

  const clearActiveKeys = useCallback(() => {
    setActiveKeys([]);
  }, []);

  const recordTouchedKey = useCallback((key: string) => {
    setRecentlyTouchedKeys(prev => persistTouchedKey(key, prev));
  }, []);
  // An agent's canvas changes (terminal / MCP) get the same Layers touched mark
  // as the chat's (docs/plans/2026-11-10-agent-canvas-flash-design.md C13).
  useEffect(() => onAgentKeysAdded((_projectId, keys) => { for (const key of keys) recordTouchedKey(key); }), [recordTouchedKey]);

  const addContextElement = useCallback((el: AIContextElement) => {
    if (!el.key) return; // guard: skip elements with undefined/empty key
    setContextElements(prev => {
      const existingIdx = prev.findIndex(e => e.key === el.key);
      if (existingIdx >= 0) {
        // Update HTML if the new dispatch has html and the existing entry doesn't
        if (el.html && !prev[existingIdx].html) {
          const updated = [...prev];
          updated[existingIdx] = { ...prev[existingIdx], html: el.html };
          return updated;
        }
        return prev;
      }
      return [...prev, el];
    });
  }, []);

  const removeContextElement = useCallback((key: string) => {
    setContextElements(prev => prev.filter(e => e.key !== key));
  }, []);

  // Identity-stable when already empty so consumers of this provider (layers
  // tree, pages tree, …) don't re-render on every no-op clear.
  const clearContextElements = useCallback(() => {
    setContextElements(prev => (prev.length ? [] : prev));
  }, []);

  // The tray is empty outside AI mode, whatever route left it — footer tab,
  // toolbar tool button, ⌘J, preview toggle. Owned here because the state is
  // here; the Footer used to clear it from one of those four routes only, and
  // the survivors reappeared on the next visit to the AI tab.
  useEffect(() => {
    if (activeTool !== 'ai') clearContextElements();
  }, [activeTool, clearContextElements]);

  // Listen for sq:add-ai-context events from the canvas (always active when in AI mode)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        key: string;
        tagName?: string;
        classes?: string;
        html?: string;
      };

      if (!detail.key) return; // guard: skip elements with undefined/empty key

      const bridgeHTML = detail.html ? cleanHTML(detail.html) : undefined;

      // If tagName is missing this is an html-only update (e.g. from ELEMENT_SECTION_HTML response).
      if (!detail.tagName) {
        if (bridgeHTML) {
          addContextElement({ key: detail.key, elementId: detail.key, tagName: '', displayLabel: '', html: bridgeHTML });
        }
        return;
      }

      const parsed = parseKey(detail.key);

      let elementId: string;
      let html: string | undefined;
      let selector: string | undefined;
      if (!parsed || parsed.type === 'source') {
        elementId = detail.key;
        html = bridgeHTML;
      } else {
        elementId = parsed.instanceId;
        html = (selectResolvedStaticMarkup(doc, elementId) ?? undefined) || bridgeHTML;
        selector = parsed.type === 'instance-child' ? parsed.selector : undefined;
      }

      const firstClass = detail.classes
        ?.split(/\s+/)
        .find((c: string) => c && !c.startsWith('[') && c.length < 30);
      const displayLabel = firstClass
        ? `${detail.tagName}.${firstClass}`
        : detail.tagName;

      const contextEl: AIContextElement = {
        key: detail.key,
        elementId,
        tagName: detail.tagName,
        displayLabel,
        selector,
        classes: detail.classes,
        html,
      };

      addContextElement(contextEl);
    };

    window.addEventListener('sq:add-ai-context', handler);
    return () => window.removeEventListener('sq:add-ai-context', handler);
  }, [doc, addContextElement]);

  return (
    <AIContext.Provider
      value={{
        isGenerating,
        streamedContent,
        generatedHTML,
        error,
        messages,
        sessions,
        activeSessionId,
        config,
        contextElements,
        activeKeys,
        recentlyTouchedKeys,
        setConfig,
        setIsGenerating,
        setStreamedContent,
        setGeneratedHTML,
        setError,
        addMessage,
        updateMessage,
        truncateMessagesAfter,
        newSession,
        switchSession,
        closeSession,
        addContextElement,
        removeContextElement,
        clearContextElements,
        markActiveKey,
        clearActiveKeys,
        recordTouchedKey,
        abortRef,
      }}
    >
      {children}
    </AIContext.Provider>
  );
};

export function useAI(): AIContextValue {
  const ctx = useContext(AIContext);
  if (!ctx) throw new Error('useAI must be used within AIProvider');
  return ctx;
}
