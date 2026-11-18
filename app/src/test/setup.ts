import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Wait budgets sized for a loaded machine: parallel sessions put the pre-push gate at load 50+ on 8 cores and the 1 s
// waits flipped (2026-11-10). A wait returns as soon as its condition holds, so a passing run is no slower; explicit
// options still win. vi.waitFor has no config knob for its 1 s default.
configure({ asyncUtilTimeout: 10_000 });
const viWaitFor = vi.waitFor;
vi.waitFor = ((callback, options) =>
  viWaitFor(callback, typeof options === 'number' ? options : { timeout: 10_000, ...options })) as typeof vi.waitFor;

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// One disk since 2026-09-10 (docs/plans/2026-09-10-remove-open-local-folder-design.md):
// (1) the ids the legacy corpus used for "the local runtime" are files-truth
// projects; (2) every /__sq/local/* call rides the proxy transport — in tests
// the proxy is whatever `fetch` the test stubbed, exactly as the old host
// transport was. A test that installs its own transport simply overrides this.
import { beforeEach } from 'vitest';
import { markFilesTruth } from '@/utils/localMode';
import { setLocalTransport, resetLocalTransportForTests } from '@/utils/sqLocalBase';
import { FILES_TRUTH_TEST_IDS } from './filesTruthTestIds';
beforeEach(() => {
  for (const id of FILES_TRUTH_TEST_IDS) markFilesTruth(id);
  resetLocalTransportForTests();
  setLocalTransport({ fetch: (pathAndQuery, init) => {
    // Arity preserved: `toHaveBeenCalledWith(url)` assertions see fetch(url) when no init was given.
    const f = globalThis.fetch as (u: string, i?: RequestInit) => Promise<Response>;
    return init === undefined ? f(pathAndQuery) : f(pathAndQuery, init);
  } });
});
