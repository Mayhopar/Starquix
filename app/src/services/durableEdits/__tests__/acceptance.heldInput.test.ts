/** instant-edit P2: user-scoped held input (a typed number inside its settle window) is pushed by the user's own barriers and
 * NOT by an agent's; unscoped held input (post typing) is always pushed; a held input never counts as a pending acceptance. */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { awaitAccepted, hasPendingUserAcceptance, holdProjectInput, pushUserHeldInput } from '../acceptance';
import { PostWriteQueue } from '@/postmodel/writeQueue';

const P = 'held';
beforeEach(async () => { await db.delete(); await db.open(); });

describe('held input scopes', () => {
  it('a user barrier pushes user-scoped and unscoped holds; an agent barrier pushes only the unscoped ones', async () => {
    const user = vi.fn(), post = vi.fn();
    const off1 = holdProjectInput(P, user, { user: true }); const off2 = holdProjectInput(P, post);
    await awaitAccepted(P);
    expect(user).toHaveBeenCalledTimes(1); expect(post).toHaveBeenCalledTimes(1);
    await awaitAccepted(P, { agent: true });
    expect(user).toHaveBeenCalledTimes(1);            // an agent call never commits the user's partial value
    expect(post).toHaveBeenCalledTimes(2);            // post typing is always pushed (the agent reads the post text)
    off1(); off2();
  });

  // #22: ⌘Q within 1–3 s of typing in a post lost the text — the quit pushed only the user-scoped holds,
  // and post typing (held 800 ms – 3 s by PostBodyEditor) has no stash to fall back on.
  it('pushUserHeldInput (the quit flush) pushes every hold, post typing too, synchronously', () => {
    const user = vi.fn(), post = vi.fn();
    const off = holdProjectInput(P, user, { user: true });
    new PostWriteQueue({ projectId: P, collection: 'posts', slug: 'hello' }).holdInput(post);
    pushUserHeldInput(P);
    expect(user).toHaveBeenCalledTimes(1); expect(post).toHaveBeenCalledTimes(1);
    off();
  });

  it('is scoped by project and released by its disposer', async () => {
    const mine = vi.fn(), other = vi.fn();
    const off = holdProjectInput(P, mine, { user: true }); const offOther = holdProjectInput('other', other, { user: true });
    off();
    await awaitAccepted(P);
    pushUserHeldInput(P);
    expect(mine).not.toHaveBeenCalled(); expect(other).not.toHaveBeenCalled();
    offOther();
  });

  it('a held input is not a pending acceptance (it would silently cancel a window close or reload)', () => {
    const off = holdProjectInput(P, () => {}, { user: true });
    expect(hasPendingUserAcceptance(P)).toBe(false);
    off();
  });
});
