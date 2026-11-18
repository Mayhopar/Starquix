// Security (audit 2026-10-18): theme components come from user-imported theme
// ZIPs. Their HTML must render in a sandboxed frame, never into the editor
// document (which holds window.sqDesktop, every project and the stored tokens).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : Stub), has: () => true });
});
vi.mock('@/utils/iconLibrary', () => ({ loadLucideIcons: vi.fn().mockResolvedValue({}) }));

import { ThemeComponentCard } from '../ComponentPickerModal';

describe('ThemeComponentCard preview', () => {
  it('renders theme HTML in a script-less sandboxed iframe', () => {
    const html = '<img src=x onerror="alert(1)"><p>Hero</p>';
    const { container } = render(
      <ThemeComponentCard
        component={{ id: '1', name: 'Hero', path: 'src/components/Hero.astro', html, source: '', dependencies: [] }}
        isSelected={false} onSelect={() => {}} onHover={() => {}}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('srcdoc')).toContain(html);
  });
});
