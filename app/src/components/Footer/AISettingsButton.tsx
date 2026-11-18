import { FileTextIcon as SharedFileTextIcon, PaletteIcon as SharedPaletteIcon, SparkleIcon as SharedSparkleIcon } from '@/assets/icons';
// src/components/Footer/AISettingsButton.tsx
import React, { useMemo } from 'react';
import { useAI } from '@/ai/AIContext';
import { DEFAULT_MODELS, AVAILABLE_MODELS, hasChatKey } from '@/ai/types';
import { Button, cx } from '@/components/ui';
import { useMcpOptional } from '@/mcp/McpContext';
import { McpDot, mcpStatusView } from '@/mcp/statusView';
import { useAgentActivity } from '@/services/agentPresence';

type Variant = 'model' | 'style' | 'prompt' | 'mcp';

interface AISettingsButtonProps {
  variant: Variant;
  onClick: () => void;
  className?: string;
  /** Overrides the computed label (e.g. the style pill's active theme name). */
  label?: string;
}

const icons: Record<Exclude<Variant, 'mcp'>, React.ReactNode> = {
  model: (
    <SharedSparkleIcon className="w-4 h-4 shrink-0" />
  ),
  style: (
    <SharedPaletteIcon className="w-4 h-4 shrink-0" />
  ),
  prompt: (
    <SharedFileTextIcon className="w-4 h-4 shrink-0" />
  ),
};

const titles: Record<Variant, string> = {
  model: 'Model settings',
  style: 'AI style theme',
  prompt: 'Prompt settings',
  mcp: 'MCP settings',
};

// Same pill recipe as the top-bar breakpoint/theme/zoom chips (BreakpointBar)
const BASE_CLASS = 'px-3 gap-1.5';

export const AISettingsButton: React.FC<AISettingsButtonProps> = ({ variant, onClick, className, label: propLabel }) => {
  const { config } = useAI();
  // The terminal panel's MCP light: the session agents in the Terminal tab and outside use.
  const mcp = useMcpOptional();
  const mcpStatus = variant === 'mcp' ? mcp?.status ?? { state: 'off' as const } : null;
  const mcpView = mcpStatus ? mcpStatusView(mcpStatus.state, mcpStatus.error) : null;
  // Agent multiplayer (ledger G): while the agent works, the light says on what.
  const agent = useAgentActivity();
  const agentAt = mcpStatus && agent ? agent.file?.split('/').pop() ?? agent.action ?? null : null;

  const label = useMemo(() => {
    if (propLabel) return propLabel;
    if (variant === 'style') return 'Style';
    if (variant === 'prompt') return 'Prompt';
    if (mcpView && agent && mcpStatus) return agentAt ? `Agent · ${agentAt}` : 'Agent';
    if (mcpView) return `MCP · ${mcpView.label}`;
    if (!config || !hasChatKey(config)) return 'No model';
    const modelId = config.model || DEFAULT_MODELS[config.provider];
    const found = AVAILABLE_MODELS[config.provider]?.find(m => m.id === modelId);
    return found?.name || modelId;
  }, [variant, config, propLabel, mcpView, agent, mcpStatus, agentAt]);

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      title={mcpStatus?.error ? `MCP: ${mcpStatus.error}` : mcpStatus && agent?.file ? `Agent editing ${agent.file}` : titles[variant]}
      icon={mcpStatus ? <McpDot status={mcpStatus} agent={!!agent} /> : icons[variant as Exclude<Variant, 'mcp'>]}
      label={label}
      className={cx(BASE_CLASS, className)}
    />
  );
};
