import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ToolProvider, useTool } from './ToolContext';

// ⌘\ show / hide sidebars (issue #8): a session view state, like preview.
describe('ToolProvider: sidebars', () => {
  const mount = () => renderHook(() => useTool(), { wrapper: ToolProvider }).result;

  it('shows the sidebars until toggled; a second toggle brings them back', () => {
    const tool = mount();
    expect(tool.current.sidebarsHidden).toBe(false);
    act(() => tool.current.toggleSidebars());
    expect(tool.current.sidebarsHidden).toBe(true);
    act(() => tool.current.toggleSidebars());
    expect(tool.current.sidebarsHidden).toBe(false);
  });

  it('two toggles before a render cancel out', () => {
    const tool = mount();
    act(() => { tool.current.toggleSidebars(); tool.current.toggleSidebars(); });
    expect(tool.current.sidebarsHidden).toBe(false);
  });

  it('entering and leaving preview leaves them as they were', () => {
    const tool = mount();
    act(() => tool.current.toggleSidebars());
    act(() => tool.current.setPreview(true));
    expect(tool.current.sidebarsHidden).toBe(true);
    act(() => tool.current.setPreview(false));
    expect(tool.current.sidebarsHidden).toBe(true);
  });
});
