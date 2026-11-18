/**
 * PrefixTag × contract (task-004). PrefixTag is SHARED (HeaderTags +
 * BlockOverridePills, 8+ sites). Its × must be class-removal only — it fires
 * onDelete and must NOT touch the active editing context, even when the pill is
 * the active layer. Resetting the context on delete is HeaderTags' job (see
 * HeaderTags.test.tsx), so BlockOverridePills' × never exits a state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setStateSpy = vi.hoisted(() => vi.fn());
const setThemeSpy = vi.hoisted(() => vi.fn());
const setBreakpointSpy = vi.hoisted(() => vi.fn());

let active = { state: 'default', theme: 'light', bp: 'xs', viewportBp: 'xs' };
vi.mock('@/context/StateContext', () => ({ useActiveState: () => ({ activeState: active.state, setActiveState: setStateSpy }) }));
vi.mock('@/context/ThemeContext', () => ({ useActiveTheme: () => ({ activeTheme: active.theme, setActiveTheme: setThemeSpy }) }));
vi.mock('@/context/BreakpointContext', () => ({ useActiveBreakpoint: () => ({ activeBreakpoint: active.bp, setActiveBreakpoint: setBreakpointSpy, viewportBreakpoint: active.viewportBp }) }));
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn() }));

import { PrefixTag } from '../PrefixTag';

beforeEach(() => {
  active = { state: 'default', theme: 'light', bp: 'xs', viewportBp: 'xs' };
  setStateSpy.mockClear();
  setThemeSpy.mockClear();
  setBreakpointSpy.mockClear();
});

describe('PrefixTag × (class-removal only, no context side-effect)', () => {
  it('fires onDelete', () => {
    const onDelete = vi.fn();
    render(<PrefixTag tag={{ label: 'hover', category: 'state', value: 'hover' }} onDelete={onDelete} />);
    fireEvent.click(screen.getByTitle('Remove all hover: classes'));
    expect(onDelete).toHaveBeenCalled();
  });

  it('does NOT reset the active context even when the pill is the active layer', () => {
    active.state = 'hover';
    render(<PrefixTag tag={{ label: 'hover', category: 'state', value: 'hover' }} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Remove all hover: classes'));
    expect(setStateSpy).not.toHaveBeenCalled();
  });
});
