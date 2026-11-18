import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ImageFillControls } from './ImageFillControls';
const mock = vi.hoisted(() => ({ apply: vi.fn(), chooseFile: vi.fn(), state: { target: 'native', src: '/hero.png', fit: 'cover', position: 'center', repeat: 'no-repeat', description: 'Mountain', preview: null } }));
vi.mock('./useImageFill', () => ({ useImageFill: () => ({ state: mock.state, apply: mock.apply, chooseFile: mock.chooseFile, busy: false, issue: null, canRetry: false, reload: vi.fn() }) }));
vi.mock('../ColorPicker', () => ({ ColorPicker: () => <span>Color picker</span> }));
beforeEach(() => { vi.clearAllMocks(); mock.state.target = 'native'; });
const input = { ownerId: 'image', tagName: 'img', classes: 'w-60 h-40 object-cover', variant: '' } as never;
it('the tab IS the fill kind: Color applies a white solid at once and hides the image chooser; Gradient applies the stops; Image shows the chooser without writing', () => {
  render(<ImageFillControls input={input} />);
  expect(screen.getByRole('button', { name: 'Edit image Fill' })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Color' }));
  expect(mock.apply).toHaveBeenCalledWith({ type: 'color', value: 'bg-white', variant: '' });
  expect(screen.queryByRole('button', { name: 'Edit image Fill' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Gradient' }));
  expect(mock.apply).toHaveBeenLastCalledWith({ type: 'gradient', value: 'bg-gradient-to-r from-white to-black', variant: '' });
  fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
  expect(mock.apply).toHaveBeenCalledTimes(2); expect(screen.getByRole('button', { name: 'Edit image Fill' })).toBeVisible();
});
it('commits a description once on Enter then blur; Escape cancels the draft', () => {
  render(<ImageFillControls input={input} />); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
  const field = screen.getByRole('textbox', { name: 'Image description' });
  fireEvent.change(field, { target: { value: 'New mountain' } }); fireEvent.keyDown(field, { key: 'Enter' }); fireEvent.blur(field);
  expect(mock.apply).toHaveBeenCalledExactlyOnceWith({ type: 'description', value: 'New mountain' });
  fireEvent.change(field, { target: { value: 'Cancelled' } }); fireEvent.keyDown(field, { key: 'Escape' }); fireEvent.blur(field);
  expect(mock.apply).toHaveBeenCalledTimes(1);
});
it('Figma model: an <img> Fill shows its image and controls immediately — never a details/retry notice', () => {
  render(<ImageFillControls input={input} />);
  expect(screen.queryByText(/unavailable|Reading image/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit image Fill' })).toBeEnabled(); expect(mock.apply).not.toHaveBeenCalled();
});

it('the kind switch is not responsive: on a breakpoint variant (sm:) Color still applies, on the BASE style', () => {
  render(<ImageFillControls input={{ ...input, variant: 'sm:' }} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Color' }));
  expect(mock.apply).toHaveBeenCalledWith({ type: 'color', value: 'bg-white', variant: '' });
});
