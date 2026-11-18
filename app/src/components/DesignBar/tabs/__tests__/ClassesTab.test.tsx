// Security (audit 2026-10-18): the class editor's highlight output is rendered
// as innerHTML by react-simple-code-editor, and class strings come from
// imported third-party templates. Markup in a class string must stay text.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ClassesTab } from '../ClassesTab';

describe('ClassesTab highlighting', () => {
  it('shows a class string literally — markup in it never becomes elements', () => {
    const classes = '<img/src/onerror=alert(1)> <img src=x onerror=alert(2)> md:a&b "q"';
    const { container } = render(<ClassesTab classes={classes} onClassesChange={() => {}} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(classes);
  });
});
