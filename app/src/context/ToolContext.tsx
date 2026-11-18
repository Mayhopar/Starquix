import { useContext, useState, type ReactNode } from 'react';
import { stableContext } from '@/utils/stableContext';

export type DrawTool = 'select' | 'frame' | 'text' | 'ai' | 'slot' | 'blog'
  | 'rect' | 'ellipse' | 'line' | 'arrow' | 'polygon' | 'pen';

interface ToolContextValue {
  activeTool: DrawTool;
  setActiveTool: (tool: DrawTool) => void;
  /**
   * Preview mode (task-116): chrome hides, the iframe fills the window, and
   * the bridge stops intercepting. Ephemeral by design — NOT localStorage, NOT
   * the URL. A reload lands back in the editor; preview is a glance, not a
   * destination. Design: docs/plans/2026-07-16-preview-mode-design.md.
   */
  isPreview: boolean;
  setPreview: (on: boolean) => void;
}

const ToolContext = stableContext<ToolContextValue | null>('ToolContext', null);

export function ToolProvider({ children }: { children: ReactNode }) {
  const [activeTool, setActiveTool] = useState<DrawTool>('select');
  const [isPreview, setPreview] = useState(false);

  return (
    <ToolContext.Provider value={{ activeTool, setActiveTool, isPreview, setPreview }}>
      {children}
    </ToolContext.Provider>
  );
}

export function useTool(): ToolContextValue {
  const ctx = useContext(ToolContext);
  if (!ctx) throw new Error('useTool must be used within ToolProvider');
  return ctx;
}
