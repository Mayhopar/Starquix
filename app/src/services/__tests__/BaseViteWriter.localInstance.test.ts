// task-132: writers armed for the LOCAL runtime — a running spawned instance
// + server-write mode arms writes; a dead instance disarms them.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// :4321 reports stopped throughout this file — isolates the NEW source from the OLD one.
vi.mock('@/services/previewServerStatus', () => ({
  previewServer: {
    onStateChange: vi.fn(() => () => {}),
    getState: vi.fn(() => ({ status: 'stopped', url: null, port: 4321, error: null })),
  },
}));

import { BaseViteWriter } from '../BaseViteWriter';
import { setServerWriteMode } from '../serverWriteMode';

class StubWriter extends BaseViteWriter {
  constructor() {
    super({ resultMessageType: 'STUB_RESULT', writerName: 'StubWriter' });
  }
}

describe('BaseViteWriter local-instance availability', () => {
  beforeEach(() => setServerWriteMode(false));

  it('a running local instance + server write mode arms writers', () => {
    const w = new StubWriter();
    setServerWriteMode(true);
    w.setLocalInstanceState({ status: 'running', url: 'http://localhost:5311' });
    expect(w.isAvailable()).toBe(true);
    w.disconnect();
  });

  it('a starting/dead local instance does not arm writers', () => {
    const w = new StubWriter();
    setServerWriteMode(true);
    w.setLocalInstanceState({ status: 'starting', url: null });
    expect(w.isAvailable()).toBe(false);
    w.setLocalInstanceState({ status: 'error', url: 'http://localhost:5311' });
    expect(w.isAvailable()).toBe(false);
    w.disconnect();
  });

  it('without server write mode a running local instance stays unavailable (WC stays off)', () => {
    const w = new StubWriter();
    w.setLocalInstanceState({ status: 'running', url: 'http://localhost:5311' });
    expect(w.isAvailable()).toBe(false);
    w.disconnect();
  });

  it('clearing local-instance state (null) revokes availability', () => {
    const w = new StubWriter();
    setServerWriteMode(true);
    w.setLocalInstanceState({ status: 'running', url: 'http://localhost:5311' });
    expect(w.isAvailable()).toBe(true);
    w.setLocalInstanceState(null);
    expect(w.isAvailable()).toBe(false);
    w.disconnect();
  });
});
