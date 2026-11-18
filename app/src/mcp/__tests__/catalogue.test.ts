import { describe, it, expect } from 'vitest';
import { buildCatalogue } from '../catalogue';
import { commandRegistry } from '@/ai/tools/commandRegistry';
import { makeCtx } from '@/ai/tools/__tests__/testCtx';

const KEYLESS = { hasPexelsKey: false, hasImageGen: false };
const ALL_ON = { hasPexelsKey: true, hasImageGen: true };

describe('MCP catalogue', () => {
  it('exposes every registry tool the availability filter allows (list_files / read_file among them), plus get_project, each with a JSON Schema', async () => {
    const catalogue = buildCatalogue(makeCtx({ availability: KEYLESS }), { projectId: 'browser_x' });
    const descriptors = catalogue.descriptors();
    const callables = catalogue.callables;
    const names = descriptors.map(d => d.name);
    for (const [name, e] of Object.entries(commandRegistry)) {
      const gatedOff = 'isAvailable' in e && typeof e.isAvailable === 'function' && !e.isAvailable(KEYLESS);
      if (!gatedOff) expect(names).toContain(name);
    }
    expect(names).toEqual(expect.arrayContaining(['get_project', 'list_files', 'read_file']));
    expect(new Set(names).size).toBe(names.length);
    for (const d of descriptors) {
      expect(d.inputSchema).toMatchObject({ type: 'object' });
      expect(d.description.length).toBeGreaterThan(0);
      expect(callables.has(d.name)).toBe(true);
    }
  });
  it('gated tools carry the confirm param in their schema — only the public deploy (⌘Z takes a push back)', async () => {
    const descriptors = buildCatalogue(makeCtx({ availability: ALL_ON }), { projectId: 'browser_x' }).descriptors();
    const deploy = descriptors.find(d => d.name === 'deploy_project')!;
    expect((deploy.inputSchema as { properties: Record<string, unknown> }).properties.confirm).toBeTruthy();
    const push = descriptors.find(d => d.name === 'push_instance_to_source')!;
    expect((push.inputSchema as { properties: Record<string, unknown> }).properties.confirm).toBeUndefined();
    const add = descriptors.find(d => d.name === 'add_page')!;
    expect((add.inputSchema as { properties: Record<string, unknown> }).properties.confirm).toBeUndefined();
  });
  it('marks registry readOnly tools and the extras as non-mutating, write tools as mutating', async () => {
    const { callables } = buildCatalogue(makeCtx({ availability: KEYLESS }), { projectId: 'browser_x' });
    expect(callables.get('read_page_content')!.mutating).toBe(false);
    expect(callables.get('list_files')!.mutating).toBe(false);
    expect(callables.get('add_page')!.mutating).toBe(true);
  });
  it('validate rejects bad args with a message and accepts good ones', async () => {
    const { callables } = buildCatalogue(makeCtx({ availability: KEYLESS }), { projectId: 'browser_x' });
    const read = callables.get('read_file')!;
    expect(await read.validate({})).toMatchObject({ ok: false, message: expect.stringContaining('path') });
    expect(await read.validate({ path: 'a' })).toEqual({ ok: true, value: { path: 'a' } });
    const add = callables.get('add_page')!;
    expect((await add.validate({ nope: 1 })).ok).toBe(false);
  });
  it('get_project reports the tab state', async () => {
    const { callables } = buildCatalogue(makeCtx({ availability: KEYLESS, currentPageId: 'pg1', selectedElementKey: 'k' }), { projectId: 'browser_x', projectName: 'Site' });
    expect(await callables.get('get_project')!.execute({})).toEqual({ projectId: 'browser_x', projectName: 'Site', currentPageId: 'pg1', selectedElementKey: 'k', breakpoint: 'base', style: null, designGuide: expect.any(String) });
  });
});
