// The MCP-only tool (get_project), defined as an AI-SDK tool so the catalogue
// treats it exactly like the registry tools (one schema path, one validate
// path). list_files / read_file are registry tools: the chat has them too.
import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { ToolExecutionContext } from '@/ai/tools/commandTools';
import { CONFIRM_RULE } from '@/ai/tools/commandRegistry';
import { selectCurrentBreakpoint, selectCurrentPageId } from '@/store/selectors';
import { loadCustomPrompts, DEFAULT_SYSTEM_PROMPT } from '@/ai/prompts/userPrompts';
import { getActiveStyleName, getActiveStyleSection, loadBundledThemes } from '@/ai/styles/styleLibrary';

/** The coding-agent skill, shipped with every get_project so any agent gets it
 *  (MCP or CLI) with nothing installed on its side. Agent-only: the in-editor
 *  chat's prompt stays the user's (customizable) base prompt. */
export const AGENT_GUIDE = `## Working as a coding agent
- Orient before editing: get_project → read_source_elements (sourceKeys + classes) → read_file.
- Verify every write with read_file — the element scan lags one repaint.
- A class edit inside a component (Header, Main, a layout) is a THIS-PAGE override. To change it everywhere, edit the component itself.
- A parent's own background or padding can hide a change on its children; check the element chain when an edit looks invisible.
- ${CONFIRM_RULE} Without it the call answers NEEDS_CONFIRMATION.
- Each call is one ⌘Z in the editor (add_page excepted: a file write).
- NOT_CONNECTED → ask the user to open the Starquix app and a project. DISCONNECTED/TIMEOUT → retry once, then ask them to check the app.
- Report in site terms ("Added /pricing with a 3-tier section"), never tool names.`;

export interface ExtraToolMeta { projectId: string; projectName?: string }

export function extraTools(ctx: ToolExecutionContext, meta: ExtraToolMeta) {
  return {
    get_project: tool({
      description: 'CALL THIS FIRST, and again before designing new sections. The Starquix project open in the paired editor tab (id, name, current page, selected element, breakpoint) plus `designGuide`: the same design rules the in-editor chat follows, ending with the user\'s ACTIVE STYLE when one is picked (`style` = its name; the user switches it with the Style button). Follow designGuide for everything you create.',
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        // Same assembly as the chat's system prompt (useAIAgent): base prompt
        // (custom override or default) + AGENT_GUIDE + the active style section. Read per
        // call so a style switch in the editor reaches the agent at once.
        await loadBundledThemes(); // themes.json is lazy — a bundled active style must resolve
        const designGuide = [loadCustomPrompts().systemPrompt ?? DEFAULT_SYSTEM_PROMPT, AGENT_GUIDE, getActiveStyleSection(meta.projectId)].filter(Boolean).join('\n\n');
        return {
        projectId: meta.projectId,
        projectName: meta.projectName ?? '',
        currentPageId: selectCurrentPageId(ctx.doc),
        selectedElementKey: ctx.selectedElementKey,
        breakpoint: selectCurrentBreakpoint(ctx.doc),
        style: getActiveStyleName(meta.projectId),
        designGuide,
        };
      },
    }),
  };
}
