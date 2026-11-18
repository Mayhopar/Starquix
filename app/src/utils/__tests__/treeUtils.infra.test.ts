/**
 * The preview injects editor infrastructure components (the HMR write channel,
 * the component/post view shells). The scan reports them like any other
 * component, so a layout master rendered `SqHmrWriteBridge` as a row next to
 * <slot> — and, being a mother-entity child, it wore the layout's own name,
 * which read as a second nested "Layout".
 */
import { describe, it, expect } from 'vitest';
import { buildTreeFromScannedElements, isEditorInfraTag } from '../treeUtils';
import type { ScannedElement } from '@/context/SelectionContext';

function el(key: string, tagName: string, parentKey: string | null = null): ScannedElement {
  return { key, tagName, parentKey, classes: '', rect: { top: 0, left: 0, width: 0, height: 0 } } as unknown as ScannedElement;
}

describe('editor infrastructure never reaches the Layers tree', () => {
  it('drops SqHmrWriteBridge, keeps the real rows', () => {
    const tree = buildTreeFromScannedElements([
      el('el-1:slot-0', 'slot'),
      el('el-1:sqhmrwritebridge-0', 'sqhmrwritebridge'),
      el('el-1:header-0', 'header'),
    ]);
    expect(tree.map((n) => n.tagName)).toEqual(['slot', 'header']);
  });

  it('matches the infra tags exactly — a user component is never hidden', () => {
    expect(isEditorInfraTag('sqhmrwritebridge')).toBe(true);
    expect(isEditorInfraTag('SqPostView')).toBe(true);
    expect(isEditorInfraTag('square')).toBe(false);
    expect(isEditorInfraTag('sq-custom')).toBe(false);
    expect(isEditorInfraTag(undefined)).toBe(false);
  });
});

describe('the preview shell wrapper is never a row', () => {
  const SHELL = 'src/pages/preview/[projectId]/[pageId].astro:18:29';

  it('unwraps the shell even when another root scans beside it', () => {
    // Inserting a component into a layout master puts its tag beside the shell
    // container; the old single-root guard then left a bare `div` row wrapping
    // <slot>, which exists nowhere in the .astro.
    const tree = buildTreeFromScannedElements([
      el(SHELL, 'div'),
      el('el-1:slot-0', 'slot', SHELL),
      el('el-2', 'header'),
    ]);
    expect(tree.map((n) => n.tagName)).toEqual(['slot', 'header']);
    expect(tree.every((n) => n.depth === 0)).toBe(true);
  });

  it('still unwraps when the shell is the only root', () => {
    const tree = buildTreeFromScannedElements([el(SHELL, 'div'), el('el-1:slot-0', 'slot', SHELL)]);
    expect(tree.map((n) => n.tagName)).toEqual(['slot']);
  });
});
