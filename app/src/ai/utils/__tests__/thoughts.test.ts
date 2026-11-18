import { describe, it, expect } from 'vitest';
import { upsertThought, closeThoughts, buildChatFeed } from '../activityFeed';
import type { AIActivity, AIThought } from '../../types';

const act = (id: string): AIActivity => ({ id, toolName: 'add_page_content', label: id, status: 'done' });
const thought = (over: Partial<AIThought> & { id: string }): AIThought => ({
  text: '',
  startedAt: 1000,
  activityIndex: 0,
  ...over,
});

describe('upsertThought', () => {
  it('opens a block anchored to the activity count at that moment', () => {
    const out = upsertThought([], { id: 'b1', text: 'Let me', activityIndex: 3, now: 5000 });
    expect(out).toEqual([{ id: 'b1', text: 'Let me', startedAt: 5000, activityIndex: 3 }]);
  });

  it('extends an existing block without moving its anchor or start time', () => {
    const first = upsertThought([], { id: 'b1', text: 'Let me', activityIndex: 0, now: 5000 });
    const second = upsertThought(first, { id: 'b1', text: 'Let me plan', activityIndex: 7, now: 9000 });
    expect(second).toEqual([{ id: 'b1', text: 'Let me plan', startedAt: 5000, activityIndex: 0 }]);
  });

  it('keeps every step as its own block instead of overwriting one string', () => {
    // The whole point of per-step blocks: a 3-step run must retain 3 transcripts.
    let thoughts: AIThought[] = [];
    thoughts = upsertThought(thoughts, { id: 'b1', text: 'step one', activityIndex: 0, now: 1 });
    thoughts = upsertThought(thoughts, { id: 'b2', text: 'step two', activityIndex: 1, now: 2 });
    thoughts = upsertThought(thoughts, { id: 'b3', text: 'step three', activityIndex: 2, now: 3 });
    expect(thoughts.map(t => t.text)).toEqual(['step one', 'step two', 'step three']);
  });
});

describe('closeThoughts', () => {
  it('stamps endedAt on open blocks only', () => {
    const before = [
      thought({ id: 'b1', endedAt: 2000 }),
      thought({ id: 'b2' }),
    ];
    const after = closeThoughts(before, 9999);
    expect(after[0].endedAt).toBe(2000); // untouched
    expect(after[1].endedAt).toBe(9999);
  });

  it('returns the same reference when nothing is open (lets callers skip a re-render)', () => {
    const settled = [thought({ id: 'b1', endedAt: 5 })];
    expect(closeThoughts(settled, 9999)).toBe(settled);
    expect(closeThoughts([], 9999)).toEqual([]);
  });
});

describe('buildChatFeed', () => {
  const feed = (activities: AIActivity[], thoughts: AIThought[] = [], content = '', textAnchors?: { activityIndex: number; offset: number }[]) =>
    buildChatFeed({ content, activities, thoughts, textAnchors });
  const ids = (items: ReturnType<typeof buildChatFeed>) => items.map(r =>
    r.kind === 'thought' ? `T:${r.thought.id}` : r.kind === 'text' ? `X:${r.text}` : `A:${r.activities.map(a => a.id).join('+')}`);

  it('renders a block before the activity it was anchored to', () => {
    const items = feed([act('a0'), act('a1')], [thought({ id: 'b1', activityIndex: 0 }), thought({ id: 'b2', activityIndex: 1 })]);
    expect(ids(items)).toEqual(['T:b1', 'A:a0', 'T:b2', 'A:a1']);
  });

  it('trails blocks anchored past the last activity (still thinking, no tools yet)', () => {
    expect(ids(feed([act('a0')], [thought({ id: 'b1', activityIndex: 1 })]))).toEqual(['A:a0', 'T:b1']);
  });

  it('handles thoughts with no activities at all', () => {
    expect(ids(feed([], [thought({ id: 'b1', activityIndex: 0 })]))).toEqual(['T:b1']);
  });

  it('keeps multiple blocks at the same anchor in order', () => {
    const items = feed([act('a0')], [thought({ id: 'b1', activityIndex: 0 }), thought({ id: 'b2', activityIndex: 0 })]);
    expect(ids(items)).toEqual(['T:b1', 'T:b2', 'A:a0']);
  });

  it('clamps an out-of-range anchor instead of dropping the block', () => {
    const items = feed([act('a0')], [thought({ id: 'high', activityIndex: 99 }), thought({ id: 'neg', activityIndex: -3 })]);
    expect(ids(items)).toEqual(['T:neg', 'A:a0', 'T:high']);
  });

  it('consecutive tool calls are ONE group; a thought or text between them splits it', () => {
    expect(ids(feed([act('a0'), act('a1'), act('a2')]))).toEqual(['A:a0+a1+a2']);
    expect(ids(feed([act('a0'), act('a1'), act('a2')], [thought({ id: 'b', activityIndex: 2 })]))).toEqual(['A:a0+a1', 'T:b', 'A:a2']);
  });

  it('text runs sit where they were written: thought, then the step\'s text, then its tools', () => {
    const content = 'On it.Done: three tiers.';
    const items = feed([act('a0'), act('a1')], [thought({ id: 'b', activityIndex: 0 })], content,
      [{ activityIndex: 0, offset: 0 }, { activityIndex: 2, offset: 6 }]);
    expect(ids(items)).toEqual(['T:b', 'X:On it.', 'A:a0+a1', 'X:Done: three tiers.']);
  });

  it('no anchors (an older reply, or a settle text like "Cancelled."): the text follows the feed; blank text renders nothing', () => {
    expect(ids(feed([act('a0')], [], 'Cancelled.'))).toEqual(['A:a0', 'X:Cancelled.']);
    expect(ids(feed([act('a0')], [], '  \n'))).toEqual(['A:a0']);
    expect(feed([], [])).toEqual([]);
  });
});
