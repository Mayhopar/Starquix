import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localFetch, resetLocalTransportForTests, setLocalTransport } from '../sqLocalBase';

// desktop/probe/metrics.mjs counts whole-file reads, layout-plan POSTs and card-source triggers from these `lf` marks (route family,
// method), so the route text must keep its project path stripped and its probe flag intact.
type Hook = (what: string, data?: Record<string, unknown>) => void;
const g = globalThis as unknown as { __sqProbeMark?: Hook; __sqProbeStacks?: boolean };
const projectPath = 'wc://browser_probe';
const q = encodeURIComponent(projectPath);
let marks: Array<Record<string, unknown> | undefined> = [];

beforeEach(() => {
  resetLocalTransportForTests();
  setLocalTransport({ projectPath, fetch: async () => Response.json({}) });
  marks = [];
});
afterEach(() => { resetLocalTransportForTests(); delete g.__sqProbeMark; delete g.__sqProbeStacks; });

describe('localFetch probe mark', () => {
  it('marks every request with its route family and method, project path stripped', async () => {
    g.__sqProbeMark = (what, data) => { if (what === 'lf') marks.push(data); };
    await localFetch(`/__sq/local/pages?path=${q}`);
    await localFetch(`/__sq/local/file?path=${q}&file=src%2Fpages%2Findex.astro&probe=1`);
    await localFetch('/__sq/local/layout-plan', { method: 'POST', body: JSON.stringify({ path: projectPath }) });
    expect(marks.map(m => [m?.m, m?.r])).toEqual([
      ['GET', 'pages'],
      ['GET', 'file&file=src%2Fpages%2Findex.astro&probe=1'],
      ['POST', 'layout-plan'],
    ]);
  });

  it('keeps the probe flag of a long file route (120 chars, not cut at 70)', async () => {
    g.__sqProbeMark = (what, data) => { if (what === 'lf') marks.push(data); };
    const file = encodeURIComponent(`src/components/${'Section'.repeat(8)}.astro`);
    await localFetch(`/__sq/local/file?path=${q}&file=${file}&probe=1`);
    expect(String(marks[0]?.r)).toMatch(/probe=1$/);
  });

  it('adds call stacks only when the recorder asked for them', async () => {
    g.__sqProbeMark = (what, data) => { if (what === 'lf') marks.push(data); };
    await localFetch(`/__sq/local/pages?path=${q}`);
    g.__sqProbeStacks = true;
    await localFetch(`/__sq/local/pages?path=${q}`);
    expect(marks[0]?.st).toBeUndefined();
    expect(Array.isArray(marks[1]?.st)).toBe(true);
  });

  it('answers the same request without the hook', async () => {
    const response = await localFetch(`/__sq/local/pages?path=${q}`);
    expect(await response.json()).toEqual({});
  });
});
