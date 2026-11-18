import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { renderHook } from '@testing-library/react';
import { applyCommand } from '@/store/commands';

let mockDoc: Y.Doc = new Y.Doc();

vi.mock('@/store/EditorContext', () => ({
  useEditorDoc: () => mockDoc,
}));

import { useFontsSync } from '../useFontsSync';

const entry = {
  source: 'google' as const,
  css: "@font-face{font-family:'Inter';src:url('sq-asset:a1');}",
  assetIds: ['a1'],
};

describe('useFontsSync', () => {
  let postMessage: ReturnType<typeof vi.fn>;
  let iframeRef: { current: { contentWindow: { postMessage: typeof postMessage } } };

  beforeEach(() => {
    mockDoc = new Y.Doc();
    postMessage = vi.fn();
    iframeRef = { current: { contentWindow: { postMessage } } };
  });

  it('injects SET_FONTS_CSS when the fonts map changes', () => {
    renderHook(() => useFontsSync(iframeRef as unknown as React.RefObject<HTMLIFrameElement>));
    expect(postMessage).not.toHaveBeenCalled(); // empty map → no initial inject
    applyCommand(mockDoc, { type: 'SET_PROJECT_FONT', family: 'Inter', entry });
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'SET_FONTS_CSS', payload: { css: entry.css } }, '*');
  });

  it('re-injects existing CSS on sq:iframe-ready', () => {
    applyCommand(mockDoc, { type: 'SET_PROJECT_FONT', family: 'Inter', entry });
    renderHook(() => useFontsSync(iframeRef as unknown as React.RefObject<HTMLIFrameElement>));
    postMessage.mockClear();
    window.dispatchEvent(new Event('sq:iframe-ready'));
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'SET_FONTS_CSS', payload: { css: entry.css } }, '*');
  });
});
