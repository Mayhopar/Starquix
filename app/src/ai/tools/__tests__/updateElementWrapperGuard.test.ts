// update_element_by_key must refuse the page-wrapper key (2026-07-23): the
// scan exposes #sq-components' key, a model styled it "as the page", and the
// override reflowed every section. The rejection message steers to real keys.
import { it, expect } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';

it('update_element_by_key refuses the page wrapper key', async () => {
  const ctx = makeCtx();
  const tools = generateCommandTools(ctx);
  const result = await (tools.update_element_by_key as ExecTool).execute({
    sourceKey: 'src/pages/preview/[projectId]/[pageId].astro:18:29',
    classes: 'py-20 max-w-6xl mx-auto',
  });
  expect(result.success).toBe(false);
  expect(result.message).toMatch(/WRAPPER/);
  expect(ctx.dispatch).not.toHaveBeenCalled();
});
