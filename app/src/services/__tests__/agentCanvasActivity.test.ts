import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  noteAgentWrite, noteSourceChanged, getAgentCanvasKeys, onAgentKeysAdded, resetAgentCanvasActivity,
  AGENT_REPORT_HOLD_MS,
} from '../agentCanvasActivity';
import { AGENT_ACTIVE_MS } from '../agentPresence';

describe('agentCanvasActivity (ledger B/C, docs/plans/2026-11-10-agent-canvas-flash-design.md)', () => {
  beforeEach(() => { vi.useFakeTimers(); resetAgentCanvasActivity(); });
  afterEach(() => { vi.useRealTimers(); });

  it('B1: a report right after an agent write is the agent\'s', () => {
    noteAgentWrite('p');
    noteSourceChanged('p', ['k1']);
    expect(getAgentCanvasKeys('p')).toEqual(['k1']);
  });

  it('B2: a report with no agent write is the user\'s — dropped after the hold', () => {
    noteSourceChanged('p', ['k1']);
    expect(getAgentCanvasKeys('p')).toEqual([]);
    vi.advanceTimersByTime(AGENT_REPORT_HOLD_MS + 1);
    noteAgentWrite('p'); // too late: never flash on a guess
    expect(getAgentCanvasKeys('p')).toEqual([]);
  });

  it('B5: a report that beats the agent write is held and then attributed', () => {
    noteSourceChanged('p', ['k1']);
    vi.advanceTimersByTime(AGENT_REPORT_HOLD_MS - 100);
    noteAgentWrite('p');
    expect(getAgentCanvasKeys('p')).toEqual(['k1']);
  });

  it('C2/F3: keys clear AGENT_ACTIVE_MS after the last agent write; a new write extends them', () => {
    noteAgentWrite('p');
    noteSourceChanged('p', ['k1']);
    vi.advanceTimersByTime(AGENT_ACTIVE_MS - 500);
    noteAgentWrite('p');
    vi.advanceTimersByTime(AGENT_ACTIVE_MS - 500);
    expect(getAgentCanvasKeys('p')).toEqual(['k1']);
    vi.advanceTimersByTime(600);
    expect(getAgentCanvasKeys('p')).toEqual([]);
  });

  it('a report long after the last agent write is the user\'s', () => {
    noteAgentWrite('p');
    vi.advanceTimersByTime(AGENT_ACTIVE_MS + 1);
    noteSourceChanged('p', ['k1']);
    vi.advanceTimersByTime(AGENT_REPORT_HOLD_MS + 1);
    expect(getAgentCanvasKeys('p')).toEqual([]);
  });

  it('C3: keys accumulate without duplicates; listeners hear only the new ones', () => {
    const added: string[][] = [];
    const off = onAgentKeysAdded((projectId, keys) => added.push([projectId, ...keys]));
    noteAgentWrite('p');
    noteSourceChanged('p', ['k1', 'k2']);
    noteSourceChanged('p', ['k2', 'k3']);
    off();
    expect(getAgentCanvasKeys('p')).toEqual(['k1', 'k2', 'k3']);
    expect(added).toEqual([['p', 'k1', 'k2'], ['p', 'k3']]);
  });

  it('Shape 3: a write can name its own keys (an MCP edit already in the DOM)', () => {
    noteAgentWrite('p', ['k9']);
    expect(getAgentCanvasKeys('p')).toEqual(['k9']);
  });

  it('C10: another project\'s keys never show, and its write clears the old project', () => {
    noteAgentWrite('a');
    noteSourceChanged('a', ['k1']);
    expect(getAgentCanvasKeys('b')).toEqual([]);
    noteAgentWrite('b');
    expect(getAgentCanvasKeys('a')).toEqual([]);
    noteSourceChanged('a', ['k2']); // a stale report from the old project
    expect(getAgentCanvasKeys('b')).toEqual([]);
  });
});
