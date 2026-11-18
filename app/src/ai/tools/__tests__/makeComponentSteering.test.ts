// make_component on a non-drawn element (add_page_content output) must fail
// with a steering message pointing at create_component — not an opaque
// "Could not serialize element". task-121 regression.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { generateCommandTools } from '../commandTools';
import { applyCommand } from '@/store/commands';
import { makeCtx, type ExecTool } from './testCtx';

const emptyClasses = () => ({ base: [], sm: [], md: [], lg: [], xl: [], '2xl': [] });

describe('make_component steering (task-121)', () => {
  it('fails with a create_component pointer on a non-drawn element', async () => {
    const ctx = makeCtx({ currentPageId: 'page-1' });
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('rootElementIds', new Y.Array());
    ctx.doc.getMap('pages').set('page-1', page);
    applyCommand(ctx.doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'element-123-abc', pageId: 'page-1', parentId: null, index: 0, type: 'frame', staticMarkup: '<section>hi</section>', classes: emptyClasses() },
    });
    const tools = generateCommandTools(ctx);
    const r = await (tools.make_component as ExecTool).execute({ key: 'element-123-abc' });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/not a drawn element/i);
    expect(r.message).toMatch(/create_component/);
  });
});
