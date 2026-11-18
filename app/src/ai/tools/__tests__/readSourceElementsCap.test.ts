import { describe, it, expect } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';
import type { ScannedElement } from '@/context/SelectionContext';

function makeElements(n: number): ScannedElement[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `el-${i}`,
    tagName: 'div',
    classes: 'flex items-center gap-4 px-6 py-3 text-sm font-medium',
    parentKey: null,
  } as unknown as ScannedElement));
}

describe('read_source_elements cap', () => {
  it('returns all elements when under the cap', async () => {
    const tools = generateCommandTools(makeCtx({ getScannedElements: () => makeElements(10) }));
    const result = await (tools.read_source_elements as unknown as ExecTool).execute({}) as unknown as {
      elements: unknown[]; count: number; truncated?: boolean;
    };
    expect(result.elements).toHaveLength(10);
    expect(result.count).toBe(10);
    expect(result.truncated).toBeUndefined();
  });

  it('caps at 150 elements and flags truncation with a hint', async () => {
    const tools = generateCommandTools(makeCtx({ getScannedElements: () => makeElements(400) }));
    const result = await (tools.read_source_elements as unknown as ExecTool).execute({}) as unknown as {
      elements: unknown[]; count: number; truncated: boolean; message: string;
    };
    expect(result.elements).toHaveLength(150);
    expect(result.count).toBe(400);         // real total, so the AI knows more exist
    expect(result.truncated).toBe(true);
    expect(result.message).toMatch(/read_element_html/); // hint to drill down instead
  });
});
