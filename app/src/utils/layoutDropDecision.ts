/**
 * Pure decision for what should happen when a layout is dropped onto a page.
 *
 * Extracted from Editor.tsx onDrop so the branching is unit-testable. The host
 * (onDrop) is responsible for detecting `hasContent` reliably — in browser/dev
 * mode the Yjs rootElementIds can be EMPTY even on a page with visible content,
 * so the caller must use the iframe-scan-derived root list as the signal, not
 * Yjs roots alone. Replacing an existing layout always confirms regardless of
 * content detection, so the prompt never silently disappears (the original bug).
 */

export type LayoutDropDecision =
  | { kind: 'noop' } // same layout re-dropped — do nothing
  | { kind: 'apply' } // safe to apply silently (empty, layout-less page)
  | { kind: 'confirm'; message: string }; // needs window.confirm first

export function resolveLayoutDrop(opts: {
  currentLayout: string | null;
  layoutName: string;
  hasContent: boolean;
}): LayoutDropDecision {
  const { currentLayout, layoutName, hasContent } = opts;

  // Re-dropping the already-applied layout changes nothing.
  if (currentLayout === layoutName) return { kind: 'noop' };

  // Replacing an existing layout is always a confirm — a page that already has
  // a layout effectively always has content, and we must never swap it out
  // from under the user without asking.
  if (currentLayout) {
    return {
      kind: 'confirm',
      message: `Replace layout "${currentLayout}" with "${layoutName}"? Your page content moves into the new layout's slot.`,
    };
  }

  // First-time apply: confirm only when there is content that would be relocated
  // into the new layout's slot. A truly empty page applies silently.
  if (hasContent) {
    return {
      kind: 'confirm',
      message: `Apply layout "${layoutName}"? Your page content moves into the layout's slot.`,
    };
  }

  return { kind: 'apply' };
}
