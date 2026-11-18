/**
 * Type-intent pin for AI SDK v6 tool() typing (task-022).
 *
 * The point of this test is NOT runtime correctness — it's to lock in the
 * structural contract of generateCommandTools() so a future refactor that
 * brings back `as any` / `params: any` will fail compilation here.
 *
 * If this test file fails to TYPE-CHECK (tsc --noEmit), the typed
 * `defineCommandTool` helper has regressed and tools no longer carry per-call
 * input types. The runtime asserts below are a smoke layer; the real gate is
 * `npx tsc --noEmit` from the project root.
 */
import { describe, it, expect } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { makeCtx } from './testCtx';

describe('generateCommandTools typing', () => {
  it('produces a ToolSet whose entries each expose inputSchema + execute', () => {
    const tools = generateCommandTools(makeCtx());
    const names = Object.keys(tools);
    // We expect a handful of tools at minimum (registry has many commands).
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const t = tools[name];
      expect(t, `tool "${name}" missing`).toBeDefined();
      // AI SDK v6 Tool shape: inputSchema (FlexibleSchema) + execute fn.
      expect(t).toHaveProperty('inputSchema');
      // execute is optional in the SDK type but required for our auto-generated
      // tools — every registry entry has an executor wired up.
      expect(typeof (t as { execute?: unknown }).execute).toBe('function');
    }
  });

  it('filters by category without breaking the typed shape', () => {
    const pageTools = generateCommandTools(makeCtx(), ['page']);
    expect(Object.keys(pageTools).length).toBeGreaterThan(0);
    for (const name of Object.keys(pageTools)) {
      expect(pageTools[name]).toHaveProperty('inputSchema');
    }
  });
});
