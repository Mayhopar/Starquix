import React from 'react';
import * as Y from 'yjs';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), markup: vi.fn() }));
const doc = new Y.Doc();
vi.mock('@/utils/localElementSource', () => ({ readLocalElementSource: io.read, writeLocalElementSource: io.write }));
vi.mock('@/store/hooks', () => ({ useEditorDoc: () => doc, useDispatch: () => vi.fn(), useYjsValue: () => 'project-a' }));
vi.mock('@/store/selectors', () => ({ selectResolvedStaticMarkup: io.markup, selectProjectId: vi.fn(), selectCurrentPageId: vi.fn() }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }) }));
vi.mock('@/hooks', () => ({ useVerticalResize: () => ({ height: 192, isDragging: false, handleResizeStart: vi.fn() }) }));
vi.mock('@/components/shared', () => ({ ResizeHandle: () => null }));
vi.mock('react-simple-code-editor', () => ({ default: ({ value, onValueChange }: { value: string; onValueChange: (v: string) => void }) => <textarea aria-label="Source draft" value={value} onChange={e => onValueChange(e.target.value)} /> }));
vi.mock('prismjs', () => ({ default: { languages: { markup: {} }, highlight: (code: string) => code } }));
vi.mock('prismjs/components/prism-markup', () => ({ default: {} }));

import { SourceTab } from '../SourceTab';
const location = { file: 'src/pages/index.astro', line: 3, column: 1, tag: 'p' };
const rawError = '<!doctype html> /Users/private/project.astro token=secret';
const content = { source: '<p>Before</p>', startLine: 3, endLine: 3 };
beforeEach(() => { io.read.mockReset().mockResolvedValue(content); io.write.mockReset().mockResolvedValue(undefined); io.markup.mockReset().mockReturnValue('<p>Component</p>'); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps the exact failed draft and selection ownership without rendering a transport message', async () => {
  io.write.mockRejectedValue(new Error(rawError));
  const view = render(<SourceTab elementKey="source-a" sourceLocation={location} />);
  await view.findByDisplayValue(content.source);
  fireEvent.change(view.getByLabelText('Source draft'), { target: { value: '<p>Draft & exact</p>\n' } });
  fireEvent.click(view.getByText('Apply'));
  await waitFor(() => expect(io.write).toHaveBeenCalledTimes(1));
  await waitFor(() => expect((view.getByLabelText('Source draft') as HTMLTextAreaElement).value).toBe('<p>Draft & exact</p>\n'));
  expect(view.queryByText(rawError)).toBeNull();
  expect(view.getByText('This change has not been confirmed.')).toBeTruthy();
  expect((view.getByText('Apply') as HTMLButtonElement).disabled).toBe(false);
  view.rerender(<SourceTab elementKey="source-b" sourceLocation={{ ...location, file: 'src/pages/other.astro' }} />);
  expect((view.getByLabelText('Source draft') as HTMLTextAreaElement).value).toBe('<p>Draft & exact</p>\n');
  expect((view.getByText('Apply') as HTMLButtonElement).disabled).toBe(true);
  expect(io.read).toHaveBeenCalledTimes(1);
});

it('offers a read-only retry for unavailable source, then removes the notice on success', async () => {
  io.read.mockRejectedValueOnce(new Error(rawError));
  const view = render(<SourceTab elementKey="source-a" sourceLocation={location} />);
  await view.findByText('The source could not be opened.');
  expect(view.queryByText(rawError)).toBeNull();
  fireEvent.click(view.getByText('Retry'));
  await view.findByDisplayValue(content.source);
  expect(view.queryByText('The source could not be opened.')).toBeNull();
  expect(io.write).not.toHaveBeenCalled();
});

it('keeps a draft when selection is cleared and restores it when the owner is selected again', async () => {
  const view = render(<SourceTab elementKey="source-a" sourceLocation={location} />);
  await view.findByDisplayValue(content.source);
  fireEvent.change(view.getByLabelText('Source draft'), { target: { value: 'Retained source' } });
  view.rerender(<SourceTab elementKey={null} sourceLocation={null} />);
  view.rerender(<SourceTab elementKey="source-a" sourceLocation={location} />);
  expect(view.getByDisplayValue('Retained source')).toBeTruthy();
  expect((view.getByText('Apply') as HTMLButtonElement).disabled).toBe(false);
  expect(io.read).toHaveBeenCalledTimes(1);
});

it.each(['resolve', 'reject'] as const)('ignores an obsolete source read %s after selecting a component', async outcome => {
  let resolve!: (value: typeof content) => void;
  let reject!: (error: Error) => void;
  io.read.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; }));
  const view = render(<SourceTab elementKey="source-a" sourceLocation={location} />);
  view.rerender(<SourceTab elementKey="el-component" sourceLocation={null} />);
  await view.findByDisplayValue('<p>Component</p>');
  await act(async () => { if (outcome === 'resolve') resolve(content); else reject(new Error(rawError)); });
  expect(view.getByDisplayValue('<p>Component</p>')).toBeTruthy();
  expect(view.queryByText(rawError)).toBeNull();
  expect(view.queryByText('The source could not be opened.')).toBeNull();
});

it('finishes an active read when the same selection receives a fresh location object', async () => {
  let resolve!: (value: typeof content) => void;
  io.read.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const view = render(<SourceTab elementKey="source-a" sourceLocation={location} />);
  view.rerender(<SourceTab elementKey="source-a" sourceLocation={{ ...location }} />);
  await act(async () => { resolve(content); });
  expect(view.getByDisplayValue(content.source)).toBeTruthy();
  expect(io.read).toHaveBeenCalledTimes(1);
});

it('completes the current source read after StrictMode replays effects', async () => {
  const view = render(<React.StrictMode><SourceTab elementKey="source-a" sourceLocation={location} /></React.StrictMode>);
  await view.findByDisplayValue(content.source);
  expect(view.queryByText('Loading source...')).toBeNull();
});

it('re-reads component markup that becomes available before an explicit read retry', async () => {
  io.markup.mockReturnValue(null);
  const view = render(<SourceTab elementKey="el-component" sourceLocation={null} />);
  await view.findByText('The source could not be opened.');
  io.markup.mockReturnValue('<p>Recovered component</p>');
  fireEvent.click(view.getByText('Retry'));
  await view.findByDisplayValue('<p>Recovered component</p>');
  expect(io.read).not.toHaveBeenCalled();
  expect(io.write).not.toHaveBeenCalled();
});
