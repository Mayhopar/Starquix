import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PreviewHealthBanner } from '../PreviewHealthBanner';

describe('runtime preview recovery', () => {
  it('never renders arbitrary runtime detail, and keeps help/diagnostics without a reload action', () => {
    render(<PreviewHealthBanner status="error" detail="/private/project token <html>npm exception" onRetry={vi.fn()} />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/private|token|html|npm|exception/);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download diagnostics' })).toBeInTheDocument();
  });
  it.each(['starting', 'running'])('is absent while %s owns the canvas', status => {
    const { container } = render(<PreviewHealthBanner status={status} detail="private" />);
    expect(container).toBeEmptyDOMElement();
  });
  it.each(['project-unavailable'] as const)('does not offer futile retry for %s', reason => {
    const retry = vi.fn();
    render(<PreviewHealthBanner status="error" reason={reason} detail="private" onRetry={retry} />);
    expect(screen.queryByRole('button', { name: 'Restart preview' })).toBeNull();
    expect(screen.getByRole('alert')).not.toHaveTextContent('private');
  });
  it('shows the generic copy, with the restart hint only when a restart is offered', () => {
    const { unmount } = render(<PreviewHealthBanner status="error" onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The preview is unavailable. Restart preview to try starting it again.');
    unmount();
    render(<PreviewHealthBanner status="error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('The preview is unavailable.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Restart preview to try');
  });
  it('invokes only the supplied driver restart action', async () => {
    const retry = vi.fn();
    render(<PreviewHealthBanner status="error" onRetry={retry} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restart preview' })); });
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

it('a failed asynchronous restart keeps one region and one busy owner without rendering its exception', async () => {
  let reject!: (error: Error) => void;
  const retry = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  render(<PreviewHealthBanner status="error" onRetry={retry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restart preview' }));
  expect(screen.getByRole('button', { name: 'Restart preview' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Restart preview' }));
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('private raw restart cause')); });
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent('Recovery could not finish');
  expect(screen.getByRole('alert')).not.toHaveTextContent(/private raw/);
  expect(screen.getByRole('button', { name: 'Restart preview' })).toBeEnabled();
});
