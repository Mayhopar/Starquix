// Agent multiplayer presence (owner 2026-11-08, ledger G).
import { afterEach, expect, it, vi } from 'vitest';
import { AGENT_ACTIVE_MS, getAgentActivity, isOwnWrite, noteAgentActivity, noteOwnWrite, subscribeAgentActivity } from '../agentPresence';

afterEach(() => { vi.useRealTimers(); });

it('G1/G2/G3: activity shows at once, the newest wins, and it fades after the last sign of work', () => {
  vi.useFakeTimers();
  const seen: unknown[] = [];
  const off = subscribeAgentActivity(() => seen.push(getAgentActivity()));
  noteAgentActivity({ projectId: 'p', action: 'update_post' });
  vi.advanceTimersByTime(AGENT_ACTIVE_MS - 1);
  noteAgentActivity({ projectId: 'p', file: 'src/pages/index.astro' });
  vi.advanceTimersByTime(AGENT_ACTIVE_MS - 1);
  expect(getAgentActivity()).toMatchObject({ projectId: 'p', file: 'src/pages/index.astro' });
  vi.advanceTimersByTime(1);
  expect(getAgentActivity()).toBeNull();
  expect(seen).toHaveLength(3);
  off();
});

it('G5: the editor\'s own writes are recognised by content, per project and file, for a short while', () => {
  vi.useFakeTimers();
  noteOwnWrite('p', 'src/a.md', 'mine');
  expect(isOwnWrite('p', 'src/a.md', 'mine')).toBe(true);
  expect(isOwnWrite('p', 'src/a.md', 'the agent\'s')).toBe(false);
  expect(isOwnWrite('q', 'src/a.md', 'mine')).toBe(false);
  vi.advanceTimersByTime(15_000);
  expect(isOwnWrite('p', 'src/a.md', 'mine')).toBe(false);
});
