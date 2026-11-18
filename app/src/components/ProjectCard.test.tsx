import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Project } from '@/api/types';

// Stub icon imports (jsdom does not render SVG meaningfully)
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return {
    TrashIcon: Stub,
    PencilIcon: Stub,
  };
});

// Import LAST so mocks are wired up first
import { ProjectCard } from './ProjectCard';

const project: Project = {
  _id: 'browser_abc',
  name: 'New Project',
  pagesTree: [],
  pages: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function setup(onRename = vi.fn(), onDelete = vi.fn()) {
  render(
    <MemoryRouter>
      <ProjectCard project={project} onDelete={onDelete} onRename={onRename} />
    </MemoryRouter>
  );
  return { onRename, onDelete };
}

// Typing-heavy userEvent tests overrun the 5s default when the machine is
// under parallel-session load; an aborted test mid-type bleeds keystrokes
// into the next one.
vi.setConfig({ testTimeout: 20000 });

describe('ProjectCard rename', () => {
  it('shows the name as text by default (no input)', () => {
    setup();
    expect(screen.getByText('New Project')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('clicking the rename button enters edit mode without navigating', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTitle('Rename Project'));

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('New Project');
    // Still on the card (Link did not navigate / unmount)
    expect(screen.getByTitle('Delete Project')).toBeInTheDocument();
  });

  it('Enter commits the trimmed new name via onRename', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.click(screen.getByTitle('Rename Project'));

    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, '  Portfolio  {Enter}');

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('browser_abc', 'Portfolio');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('Escape reverts without calling onRename', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.click(screen.getByTitle('Rename Project'));

    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Portfolio{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('New Project')).toBeInTheDocument();
  });

  it('empty name commits nothing and reverts', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.click(screen.getByTitle('Rename Project'));

    await user.clear(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('New Project')).toBeInTheDocument();
  });

  it('unchanged name on blur commits nothing', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.click(screen.getByTitle('Rename Project'));

    await act(async () => { (screen.getByRole('textbox') as HTMLInputElement).blur(); });

    expect(onRename).not.toHaveBeenCalled();
  });

  it('blur with a changed name commits', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.click(screen.getByTitle('Rename Project'));

    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Portfolio');
    await act(async () => { (input as HTMLInputElement).blur(); });

    expect(onRename).toHaveBeenCalledWith('browser_abc', 'Portfolio');
  });
});


it('Enter and blur share one pending rename and keep the editor until acknowledgement', async () => {
  let finish!: () => void;
  const onRename = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  setup(onRename);
  fireEvent.click(screen.getByTitle('Rename Project'));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Pending name' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.blur(input);
  expect(onRename).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox')).toHaveValue('Pending name');
  await act(async () => { finish(); });
  expect(screen.queryByRole('textbox')).toBeNull();
});


it('an acknowledged rename cannot discard text typed while that write was pending', async () => {
  let finish!: () => void;
  const onRename = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  setup(onRename);
  fireEvent.click(screen.getByTitle('Rename Project'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Submitted name' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Newer exact draft  ' } });
  await act(async () => { finish(); });
  expect(screen.getByRole('textbox')).toHaveValue('  Newer exact draft  ');
  expect(onRename).toHaveBeenCalledTimes(1);
});

describe('ProjectCard delete (owner 2026-11-10: delete anything AND undo — never a question)', () => {
  it('the trash deletes at once (⌘Z on the Projects page brings it back) and never opens the editor', () => {
    const onDelete = vi.fn();
    const native = vi.spyOn(window, 'confirm');
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ProjectCard project={project} onDelete={onDelete} onRename={vi.fn()} />} />
          <Route path="/editor/:id" element={<p>EDITOR</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTitle('Delete Project'));
    expect(onDelete).toHaveBeenCalledWith('browser_abc');
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByText('EDITOR')).toBeNull();
    expect(native).not.toHaveBeenCalled();
    native.mockRestore();
  });
});
