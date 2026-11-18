import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OperationNotice } from '../OperationNotice';
it('announces curated copy politely and invokes the supplied recovery', () => {
  const retry = vi.fn();
  render(<OperationNotice title="Project layouts are unavailable." detail="Retry to load current layouts." action={{ label: 'Retry', onClick: retry }} />);
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  expect(screen.getByText('Retry to load current layouts.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
it('keeps one disabled recovery action while busy', () => {
  const retry = vi.fn();
  render(<OperationNotice title="Loading layouts…" action={{ label: 'Retry', onClick: retry, busy: true }} />);
  const button = screen.getByRole('button', { name: 'Retry' });
  expect(button).toBeDisabled(); fireEvent.click(button); expect(retry).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button')).toHaveLength(1);
});
it('has no recovery button unless the owner supplies one and supports explicit urgency', () => {
  render(<OperationNotice title="This change has not been confirmed." urgency="assertive" />);
  expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('keeps its text 8px inside its border — on the window\'s 16px edge (owner 2026-10-20: 4px read as no padding)', () => {
  render(<OperationNotice title="Cloudflare is busy." />);
  const row = screen.getByText('Cloudflare is busy.').closest('.border');
  expect(row).toHaveClass('px-2');
  expect(row).not.toHaveClass('pl-1');
});

it('links are ghost buttons beside the action that open their page (never blue text under the box)', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  render(<OperationNotice title="The last build failed." links={[{ label: 'Build log', href: 'https://github.com/o/r/actions/runs/1' }]}
    action={{ label: 'Retry', onClick: vi.fn() }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Build log' }));
  expect(open).toHaveBeenCalledWith('https://github.com/o/r/actions/runs/1', '_blank', 'noopener,noreferrer');
  expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Build log', 'Retry']);
  open.mockRestore();
});

it('wraps long curated copy without moving focus', () => {
  const title = 'Project components are unavailable. Existing project rows cannot be opened until the list is available.';
  const before = document.activeElement;
  render(<OperationNotice title={title} action={{ label: 'Retry', onClick: vi.fn() }} />);
  expect(screen.getByText(title).parentElement).toHaveClass('whitespace-normal', 'break-words');
  expect(document.activeElement).toBe(before);
});
