import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { generateCommandTools, confirmGate, withConfirmParam } from '../commandTools';
import { commandRegistry, CONFIRM_GATED_TOOLS, CONFIRM_RULE } from '../commandRegistry';
import { makeCtx, type ExecTool } from './testCtx';

const ALL_ON = { hasPexelsKey: false, hasImageGen: false };

// Owner 2026-11-10: never a popup. A tool that can't be undone takes confirm:true — the agent asks the user in its
// reply (chat and MCP alike); everything undoable acts at once and ⌘Z takes it back.
describe('confirm gate (chat + MCP)', () => {
  it('only what ⌘Z cannot take back is gated: the public deploy', () => {
    expect(CONFIRM_GATED_TOOLS).toEqual(['deploy_project']);
    expect(CONFIRM_RULE).toContain('deploy_project'); expect(CONFIRM_RULE).toContain('"confirm": true');
  });

  it.each(CONFIRM_GATED_TOOLS)('%s answers needsConfirmation without confirm:true and never calls window.confirm', async name => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const tools = generateCommandTools(makeCtx({ availability: ALL_ON }));
    const r = await (tools[name] as unknown as ExecTool).execute({});
    expect(r).toMatchObject({ success: false, cancelled: true, needsConfirmation: true });
    expect(r.message).toMatch(/Ask the user/);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('confirm:true passes the gate and is stripped before the executor', () => {
    const entry = commandRegistry[CONFIRM_GATED_TOOLS[0] as keyof typeof commandRegistry];
    expect(confirmGate(entry, { confirm: true, provider: 'x' })).toEqual({ provider: 'x' });
  });

  it('withConfirmParam adds an optional boolean confirm to the schema', () => {
    const s = withConfirmParam(z.object({ pageId: z.string() }));
    expect(s.safeParse({ pageId: 'p', confirm: true }).success).toBe(true);
    expect(s.safeParse({ pageId: 'p' }).success).toBe(true);
    expect(s.safeParse({ pageId: 'p', confirm: 'yes' }).success).toBe(false);
  });
});
