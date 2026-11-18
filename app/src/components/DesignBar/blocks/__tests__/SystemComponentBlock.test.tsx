/**
 * task-207 Task 9: the generic sq/ component panel. Reuses the SAME
 * saveMediaEdit path Media uses (useInvocation) — this pins that it writes
 * plain props through setProp and refuses hand-written markup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/core/postmedia/saveMediaEdit', () => ({
  saveMediaEdit: vi.fn(),
  readMediaInvocation: vi.fn(),
}));
vi.mock('@/components/Canvas/reloadPreview', () => ({ requestPreviewReload: vi.fn() }));

import { saveMediaEdit, readMediaInvocation } from '@/core/postmedia/saveMediaEdit';
import { requestPreviewReload } from '@/components/Canvas/reloadPreview';
import { SystemComponentBlock } from '../SystemComponentBlock';
import type { Manifest } from '@/core/manifest/types';
import type { ComponentUnit } from '../../componentUnit';

const CREDIT = '<Credit role="Design" name="Oleg" />';
const POST = { collection: 'works', slug: 'p1' };
const UNIT: ComponentUnit = {
  path: 'src/components/sq/Credit.astro', name: 'Credit',
  write: { bodyLine: 25, bodyEnd: 25 },
};
const MANIFEST: Manifest = {
  props: [
    { name: 'role', label: 'Role', control: { kind: 'text' } },
    { name: 'gap', label: 'Gap', control: { kind: 'number', unit: 'px' } },
  ],
};

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  asMock(readMediaInvocation).mockResolvedValue(CREDIT);
  asMock(saveMediaEdit).mockResolvedValue(CREDIT);
});

async function renderLoaded(over: Partial<React.ComponentProps<typeof SystemComponentBlock>> = {}) {
  const utils = render(
    <SystemComponentBlock unit={UNIT} postTarget={POST} manifest={MANIFEST} {...over} />,
  );
  await waitFor(() => expect(readMediaInvocation).toHaveBeenCalled());
  return utils;
}

describe('SystemComponentBlock', () => {
  it('titles the block with the promoted component name', async () => {
    await renderLoaded();
    expect(screen.getByText('Credit')).toBeTruthy();
  });

  it('reads current attr values off the invocation', async () => {
    await renderLoaded();
    expect((screen.getByLabelText('Role') as HTMLInputElement).value).toBe('Design');
  });

  it('a text edit writes that prop and nothing else', async () => {
    await renderLoaded();
    const role = screen.getByLabelText('Role');
    fireEvent.change(role, { target: { value: 'PM' } });
    fireEvent.blur(role);
    await waitFor(() => expect(saveMediaEdit).toHaveBeenCalled());
    const call = asMock(saveMediaEdit).mock.calls[0][0];
    expect(call).toMatchObject({ collection: 'works', slug: 'p1', bodyLine: 25 });
    expect(call.mutate(CREDIT)).toBe('<Credit role="PM" name="Oleg" />');
  });

  it('a numeric edit writes an expression, and clearing REMOVES the attr (B5)', async () => {
    await renderLoaded();
    const gap = screen.getByLabelText('Gap');
    fireEvent.change(gap, { target: { value: '16' } });
    fireEvent.blur(gap);
    await waitFor(() => expect(saveMediaEdit).toHaveBeenCalled());
    expect(asMock(saveMediaEdit).mock.calls[0][0].mutate(CREDIT))
      .toBe('<Credit gap={16} role="Design" name="Oleg" />');

    fireEvent.change(gap, { target: { value: '' } });
    fireEvent.blur(gap);
    await waitFor(() => expect(asMock(saveMediaEdit).mock.calls.length).toBe(2));
    expect(asMock(saveMediaEdit).mock.calls[1][0].mutate('<Credit gap={16} name="Oleg" />'))
      .toBe('<Credit name="Oleg" />');
  });

  it('refuses hand-written markup — the mutate returns null (B2/B7)', async () => {
    await renderLoaded();
    const gap = screen.getByLabelText('Gap');
    fireEvent.change(gap, { target: { value: '16' } });
    fireEvent.blur(gap);
    await waitFor(() => expect(saveMediaEdit).toHaveBeenCalled());
    const { mutate } = asMock(saveMediaEdit).mock.calls[0][0];
    expect(mutate('<Credit gap={spacing} />')).toBeNull();
    expect(mutate('<Credit {...props} />')).toBeNull();
  });

  it('a successful save reloads the preview', async () => {
    await renderLoaded();
    const role = screen.getByLabelText('Role');
    fireEvent.change(role, { target: { value: 'PM' } });
    fireEvent.blur(role);
    await waitFor(() => expect(requestPreviewReload).toHaveBeenCalled());
  });

  it('no write target → read-only note, disabled controls, no read, no write (B9/WC)', () => {
    render(
      <SystemComponentBlock unit={{ ...UNIT, write: null }} postTarget={POST} manifest={MANIFEST} />,
    );
    expect(screen.getByText('Open the post to edit this component')).toBeTruthy();
    expect((screen.getByLabelText('Role') as HTMLInputElement).disabled).toBe(true);
    expect(readMediaInvocation).not.toHaveBeenCalled();
    expect(saveMediaEdit).not.toHaveBeenCalled();
  });

  it('an empty manifest renders no block at all (A15)', () => {
    const { container } = render(
      <SystemComponentBlock unit={UNIT} postTarget={POST} manifest={{ props: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
