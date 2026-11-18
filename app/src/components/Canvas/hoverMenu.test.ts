import { describe, it, expect, vi } from 'vitest';
import { claimHoverMenu, releaseHoverMenu } from './hoverMenu';

describe('hoverMenu single-open coordination', () => {
  it('claiming closes the previously-open menu; release clears only the owner', () => {
    const a = vi.fn();
    const b = vi.fn();

    claimHoverMenu(a);
    claimHoverMenu(a); // re-claim by same owner is a no-op
    expect(a).not.toHaveBeenCalled();

    claimHoverMenu(b); // b opens → a must close
    expect(a).toHaveBeenCalledTimes(1);

    releaseHoverMenu(a); // stale release must not clear b's claim
    claimHoverMenu(a);
    expect(b).toHaveBeenCalledTimes(1);

    releaseHoverMenu(a);
    claimHoverMenu(b); // nothing open → no close calls
    expect(a).toHaveBeenCalledTimes(1);
  });
});
