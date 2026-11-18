import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';

function tools(): Record<'verify_layout' | 'set_breakpoint', ExecTool> {
  const ctx = makeCtx();
  ctx.doc.getMap('meta').set('currentBreakpoint', 'md');
  return generateCommandTools(ctx) as never;
}
const tool = () => tools().verify_layout;

afterEach(() => vi.restoreAllMocks());

describe('verify_layout tool', () => {
  it('sends the request event and resolves with findings from the result event', async () => {
    const seen: Array<{ requestId: string; keys: string[]; breakpoint: string }> = [];
    window.addEventListener('sq:ai-verify-layout', (e) => {
      const detail = (e as CustomEvent).detail;
      seen.push(detail);
      window.dispatchEvent(new CustomEvent('sq:ai-verify-layout-result', {
        detail: { requestId: detail.requestId, findings: [{ key: 'a', severity: 'error', issue: 'overlaps sibling', suggestion: 'fix' }] },
      }));
    }, { once: true });

    const result = await tool().execute({ keys: ['a'] }) as unknown as { success: boolean; findings: unknown[] };
    expect(seen[0].keys).toEqual(['a']);
    expect(seen[0].breakpoint).toBe('md'); // defaults to the breakpoint the canvas is on
    expect(result.success).toBe(true);
    expect(result.findings).toHaveLength(1);
  });

  // task-266: the canvas mounts ONE frame, at the editor's breakpoint. Another
  // width is checked by moving the canvas there and back: the user ends on the
  // width they were on. (A request for another width first ended in a 3 s
  // timeout, then in a refusal that left the switching to the AI.)
  describe('another breakpoint', () => {
    // A frame like ViewportFrame: it answers only for the breakpoint it rendered,
    // renders the doc's breakpoint a moment late, and says when it is there.
    function setup(frame: 'answers' | 'never answers' | 'never gets there') {
      const ctx = makeCtx();
      const meta = ctx.doc.getMap('meta');
      meta.set('currentBreakpoint', 'md');
      let rendered = 'md';
      const answeredAt: string[] = [];
      meta.observe(() => {
        const next = meta.get('currentBreakpoint') as string;
        if (frame === 'never gets there') return;
        setTimeout(() => { rendered = next; window.dispatchEvent(new CustomEvent('sq:ai-verify-ready', { detail: { breakpoint: next } })); }, 20);
      });
      const onAsk = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (frame !== 'answers' || detail.breakpoint !== rendered) return;
        answeredAt.push(rendered);
        window.dispatchEvent(new CustomEvent('sq:ai-verify-layout-result', { detail: { requestId: detail.requestId, findings: [{ key: 'a', severity: 'error', issue: 'overflows parent' }] } }));
      };
      window.addEventListener('sq:ai-verify-layout', onAsk);
      const verify = (generateCommandTools(ctx) as never as Record<'verify_layout', ExecTool>).verify_layout;
      return { meta, answeredAt, verify, done: () => window.removeEventListener('sq:ai-verify-layout', onAsk) };
    }

    it('moves the canvas there, checks, and puts it back', async () => {
      const { meta, answeredAt, verify, done } = setup('answers');
      const result = await verify.execute({ keys: ['a'], breakpoint: 'base' }) as unknown as { success: boolean; breakpoint: string; findings: unknown[] };
      done();
      expect(result).toMatchObject({ success: true, breakpoint: 'base' });
      expect(result.findings).toHaveLength(1);
      expect(answeredAt).toEqual(['base']); // asked once, when the frame was on that width
      expect(meta.get('currentBreakpoint')).toBe('md');
    });

    it.each(['never gets there', 'never answers'] as const)('puts the canvas back when the frame %s', async (frame) => {
      vi.useFakeTimers();
      const { meta, verify, done } = setup(frame);
      const pending = verify.execute({ keys: ['a'], breakpoint: 'base' });
      await vi.advanceTimersByTimeAsync(3200);
      const result = await pending as { success: boolean; message?: string };
      done();
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/timeout/i);
      expect(meta.get('currentBreakpoint')).toBe('md');
      vi.useRealTimers();
    });
  });

  // task-266: set_breakpoint moves the canvas on purpose and leaves it there;
  // verify_layout then reads the breakpoint live, not a copy taken at run start.
  it('set_breakpoint switches the canvas; verify_layout then asks the frame of that width', async () => {
    const { set_breakpoint, verify_layout } = tools();
    expect((await set_breakpoint.execute({ breakpoint: 'base' })).success).toBe(true);
    const seen: string[] = [];
    window.addEventListener('sq:ai-verify-layout', (e) => {
      const detail = (e as CustomEvent).detail;
      seen.push(detail.breakpoint);
      window.dispatchEvent(new CustomEvent('sq:ai-verify-layout-result', { detail: { requestId: detail.requestId, findings: [] } }));
    }, { once: true });
    const result = await verify_layout.execute({ keys: ['a'], breakpoint: 'base' }) as unknown as { success: boolean; breakpoint: string };
    expect(seen).toEqual(['base']);
    expect(result).toMatchObject({ success: true, breakpoint: 'base' });
  });

  it('times out with success:false when no frame responds', async () => {
    vi.useFakeTimers();
    const p = tool().execute({ keys: ['a'] });
    await vi.advanceTimersByTimeAsync(3100);
    const result = await p as { success: boolean; message?: string };
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/timeout/i);
    vi.useRealTimers();
  });
});
