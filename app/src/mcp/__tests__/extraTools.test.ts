import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { extraTools, AGENT_GUIDE } from '../extraTools';
import { makeCtx } from '@/ai/tools/__tests__/testCtx';

const run = (t: { execute?: (a: never, o: never) => unknown }, args: unknown) => Promise.resolve(t.execute!(args as never, {} as never));

describe('MCP extra tool: get_project', () => {
  it('get_project hands the agent the chat’s design guide + the ACTIVE style (Style button), live per call', async () => {
    const { saveCustomTheme, setActiveStyleId } = await import('@/ai/styles/styleLibrary');
    const { DEFAULT_SYSTEM_PROMPT } = await import('@/ai/prompts/userPrompts');
    const t = extraTools(makeCtx(), { projectId: 'browser_p' });
    setActiveStyleId('browser_p', null);
    const plain = await run(t.get_project, {}) as { style: string | null; designGuide: string };
    expect(plain.style).toBeNull();
    expect(plain.designGuide).toBe(`${DEFAULT_SYSTEM_PROMPT}\n\n${AGENT_GUIDE}`); // the agent skill rides along — nothing to install agent-side
    const theme = saveCustomTheme({ name: 'Brutal Mono', markdown: 'colors:\n  primary: "#ff0000"' });
    setActiveStyleId('browser_p', `custom:${theme.id}`);
    const styled = await run(t.get_project, {}) as { style: string | null; designGuide: string };
    expect(styled.style).toBe('Brutal Mono');
    expect(styled.designGuide).toContain('ACTIVE STYLE: Brutal Mono');
    expect(styled.designGuide).toContain('primary: "#ff0000"');
    expect(styled.designGuide.indexOf('ACTIVE STYLE')).toBeGreaterThan(styled.designGuide.indexOf(AGENT_GUIDE)); // style stays last
    setActiveStyleId('browser_p', null);
  });
});
