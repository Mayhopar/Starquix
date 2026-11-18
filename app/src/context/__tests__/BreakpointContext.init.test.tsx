import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// jsdom under opaque origins / node webstorage may not provide a usable
// localStorage. Shim it the same way other persistence tests do.
if (
  typeof globalThis.localStorage === 'undefined'
  || typeof globalThis.localStorage.getItem !== 'function'
  || typeof globalThis.localStorage.setItem !== 'function'
) {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = String(value);
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((k) => delete store[k]);
      }),
      get length() {
        return Object.keys(store).length;
      },
      key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    },
    configurable: true,
  });
}

import { act } from '@testing-library/react';
import { EditorProvider } from '@/store/EditorContext';
import { useEditorDoc } from '@/store/hooks';
import { BreakpointProvider, useActiveBreakpoint } from '@/context/BreakpointContext';
import { BREAKPOINT_STORAGE_KEY } from '@/store/createEditorDoc';
import type * as Y from 'yjs';

let docRef: Y.Doc | null = null;

function Probe() {
  const { activeBreakpoint } = useActiveBreakpoint();
  docRef = useEditorDoc();
  return <div data-testid="active">{activeBreakpoint}</div>;
}

// User call 2026-07-03 (reverses task-094 B3 auto-follow): the editing layer
// is EXPLICIT-ONLY. It always starts at base 'xs'; a breakpoint override
// layer is entered only via the + chip / an existing tag (setActiveBreakpoint).
// The viewport/frame breakpoint never drags the editing layer along — neither
// at mount (restored from localStorage) nor on later frame switches.
describe('BreakpointProvider — editing layer is explicit-only', () => {
  afterEach(() => {
    localStorage.removeItem(BREAKPOINT_STORAGE_KEY);
    docRef = null;
  });

  it('starts at base even when the restored viewport breakpoint is md', async () => {
    localStorage.setItem(BREAKPOINT_STORAGE_KEY, 'md');
    render(
      <EditorProvider>
        <BreakpointProvider>
          <Probe />
        </BreakpointProvider>
      </EditorProvider>,
    );
    expect((await screen.findByTestId('active')).textContent).toBe('xs');
  });

  it('defaults to the primary breakpoint when nothing is saved', async () => {
    render(
      <EditorProvider>
        <BreakpointProvider>
          <Probe />
        </BreakpointProvider>
      </EditorProvider>,
    );
    expect((await screen.findByTestId('active')).textContent).toBe('xs');
  });

  it('a later viewport/frame switch does NOT move the editing layer', async () => {
    render(
      <EditorProvider>
        <BreakpointProvider>
          <Probe />
        </BreakpointProvider>
      </EditorProvider>,
    );
    await screen.findByTestId('active');
    act(() => {
      docRef!.getMap('meta').set('currentBreakpoint', 'lg');
    });
    expect(screen.getByTestId('active').textContent).toBe('xs');
  });
});
