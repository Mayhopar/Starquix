// Link / image tools: generic dispatch mapping tests (SEO tools: localSeoTools.test.ts).
import { describe, it, expect } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';

function makeLegacyDocumentCtx() {
  const ctx = makeCtx();
  ctx.doc.getMap('meta').set('projectId', 'legacy_doc_project');
  return ctx;
}

async function expectDispatch(toolName: string, params: Record<string, unknown>, expected: Record<string, unknown>) {
  const ctx = makeLegacyDocumentCtx();
  const tools = generateCommandTools(ctx);
  const result = await (tools[toolName] as ExecTool).execute(params);
  expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining(expected));
  expect(ctx.takeSnapshot).toHaveBeenCalled();
  expect(result.success).toBe(true);
}

describe('link / image / SEO tools', () => {
  it('update_link_attribute dispatches UPDATE_LINK_ATTRIBUTE', async () => {
    await expectDispatch(
      'update_link_attribute',
      { elementId: 'el-1', attribute: 'href', value: '/about' },
      { type: 'UPDATE_LINK_ATTRIBUTE', elementId: 'el-1', attribute: 'href', value: '/about' },
    );
  });

  it('unwrap_link dispatches UNWRAP_LINK', async () => {
    await expectDispatch('unwrap_link', { elementId: 'el-1' }, { type: 'UNWRAP_LINK', elementId: 'el-1' });
  });

  it('update_image_attribute dispatches UPDATE_IMAGE_ATTRIBUTE', async () => {
    await expectDispatch(
      'update_image_attribute',
      { elementId: 'el-1', attribute: 'alt', value: 'A red bicycle' },
      { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'el-1', attribute: 'alt', value: 'A red bicycle' },
    );
  });

});
