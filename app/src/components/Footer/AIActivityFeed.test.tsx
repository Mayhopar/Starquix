import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReplyFeed } from './AIActivityFeed';
import type { AIActivity, AIMessage } from '@/ai/types';

// SVG imports resolve to data-URL strings under vitest; stub them as components
vi.mock('@/assets/icons', () => {
  const Icon = (props: Record<string, unknown>) => <svg {...props} />;
  return new Proxy({}, { get: (_t, name) => (name === 'then' ? undefined : Icon), has: () => true });
});

afterEach(cleanup);

const act = (over: Partial<AIActivity> & { id: string }): AIActivity =>
  ({ toolName: 'update_element_by_key', label: 'Updating classes on Hero', status: 'done', key: 'src/pages/index.astro:5:1', ...over });
const reply = (over: Partial<AIMessage> = {}): AIMessage => ({ id: 'm', role: 'assistant', content: '', timestamp: 1, status: 'complete', ...over });
const hover = (text: string) => { // rowProps lands on an ancestor of the label; bubble up
  let node: HTMLElement | null = screen.getByText(text);
  while (node) { fireEvent.mouseEnter(node); node = node.parentElement; }
};

describe('ReplyFeed', () => {
  it('renders nothing for an empty reply', () => {
    const { container } = render(<ReplyFeed message={reply()} />);
    expect(container.textContent).toBe('');
  });

  it('one tool call is its own row with its detail', () => {
    render(<ReplyFeed message={reply({ activities: [act({ id: 'a1', detail: '3 elements' })] })} />);
    expect(screen.getByText('Updating classes on Hero')).toBeTruthy();
    expect(screen.getByText(/3 elements/)).toBeTruthy();
  });

  it('consecutive calls are ONE group row (first label · N actions) that lists them all on click', () => {
    const activities = [act({ id: 'a1', label: 'Added section "Pricing"' }), act({ id: 'a2', label: 'Set 3 tier titles' }), act({ id: 'a3', label: 'Styled cards' })];
    render(<ReplyFeed message={reply({ activities })} />);
    expect(screen.getByText('Added section "Pricing"')).toBeTruthy();
    expect(screen.getByText(/· 3 actions/)).toBeTruthy();
    expect(screen.queryByText('Styled cards')).toBeNull(); // collapsed
    fireEvent.click(screen.getByText('Added section "Pricing"'));
    expect(screen.getByText('Styled cards')).toBeTruthy();
  });

  it('a running group is headed by the call in progress; a failed call is counted, its raw detail never shown', () => {
    const running = [act({ id: 'a1', label: 'Added section' }), act({ id: 'a2', label: 'Generating image', status: 'running' })];
    const { rerender } = render(<ReplyFeed message={reply({ status: 'streaming', activities: running })} />);
    expect(screen.getByText('Generating image')).toBeTruthy();
    const failed = [act({ id: 'a1', label: 'Added section' }), act({ id: 'a2', label: 'Generating image', status: 'error', detail: 'sk-secret 401' })];
    rerender(<ReplyFeed message={reply({ status: 'error', failure: 'unknown', activities: failed })} />);
    expect(screen.getByText(/1 of 2 failed/)).toBeTruthy();
    fireEvent.click(screen.getByText('Added section'));
    expect(document.body.textContent).not.toContain('sk-secret');
  });

  it('text runs land between the tool steps they were written around, as markdown (raw HTML stays text)', () => {
    const content = 'On it.**Done**: three tiers. <img src=x onerror=alert(1)>';
    render(<ReplyFeed message={reply({
      content,
      activities: [act({ id: 'a1', label: 'Added section' }), act({ id: 'a2', label: 'Styled cards' })],
      textAnchors: [{ activityIndex: 0, offset: 0 }, { activityIndex: 2, offset: 6 }],
    })} />);
    const text = document.body.textContent!;
    expect(text.indexOf('On it.')).toBeLessThan(text.indexOf('Added section'));
    expect(text.indexOf('Added section')).toBeLessThan(text.indexOf('three tiers'));
    expect(screen.getByText('Done').tagName).toBe('STRONG');
    expect(document.querySelector('img')).toBeNull();
  });

  it('hovering an element row flashes it on the canvas; page/variable keys do not', () => {
    const spy = vi.fn();
    window.addEventListener('sq:ai-highlight', spy);
    const { unmount } = render(<ReplyFeed message={reply({ activities: [act({ id: 'a1' })] })} />);
    hover('Updating classes on Hero');
    expect((spy.mock.calls[0][0] as CustomEvent).detail).toEqual({ key: 'src/pages/index.astro:5:1' });
    unmount(); spy.mockClear();
    render(<ReplyFeed message={reply({ activities: [act({ id: 'a1', key: 'page:home' })] })} />);
    hover('Updating classes on Hero');
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener('sq:ai-highlight', spy);
  });
});
