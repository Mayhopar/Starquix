import { describe, it, expect } from 'vitest';
import { resolveFinishState, shouldAutoContinue, buildCancelledSettle, MAX_AUTO_CONTINUES } from '../useAIAgent';

describe('resolveFinishState', () => {
  it('completed: model stopped on its own with text', () => {
    expect(resolveFinishState({ finishReason: 'stop', stepsUsed: 5, stepCap: 40, toolCalls: 3, fullText: 'done' }).state).toBe('completed');
  });
  it('needs-continue: step cap hit', () => {
    const r = resolveFinishState({ finishReason: 'tool-calls', stepsUsed: 40, stepCap: 40, toolCalls: 40, fullText: '' });
    expect(r.state).toBe('needs-continue');
  });
  it('never fabricates Done: no text + tool calls + stop → completed with honest fallback text', () => {
    const r = resolveFinishState({ finishReason: 'stop', stepsUsed: 3, stepCap: 40, toolCalls: 2, fullText: '' });
    expect(r.state).toBe('completed');
    expect(r.fallbackText).toContain('2'); // e.g. "Finished — 2 actions executed (no summary given)."
  });
  it('failed: error finish', () => {
    expect(resolveFinishState({ finishReason: 'error', stepsUsed: 1, stepCap: 40, toolCalls: 0, fullText: '' }).state).toBe('failed');
  });
});

describe('shouldAutoContinue', () => {
  it('resumes a capped run until the auto budget is spent', () => {
    expect(shouldAutoContinue('needs-continue', 0)).toBe(true);
    expect(shouldAutoContinue('needs-continue', MAX_AUTO_CONTINUES - 1)).toBe(true);
    expect(shouldAutoContinue('needs-continue', MAX_AUTO_CONTINUES)).toBe(false); // manual Continue takes over
  });
  it('never resumes completed or failed runs', () => {
    expect(shouldAutoContinue('completed', 0)).toBe(false);
    expect(shouldAutoContinue('failed', 0)).toBe(false);
  });
});

describe('buildCancelledSettle', () => {
  it('finalizes running rows as done and sets Cancelled fallback', () => {
    const acts = [{ id: 'a', toolName: 't', label: 'l', status: 'running' as const }];
    const { activities, content, status } = buildCancelledSettle(acts, '');
    expect(activities[0].status).toBe('done');
    expect(content).toBe('Cancelled.');
    expect(status).toBe('complete');
  });
  it('keeps streamed text when present', () => {
    expect(buildCancelledSettle([], 'partial answer').content).toBe('partial answer');
  });
});
