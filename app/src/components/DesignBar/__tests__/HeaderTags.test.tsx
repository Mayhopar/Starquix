/**
 * HeaderTags composite-cell pills (composite-state-pills). Pills represent
 * (breakpoint, theme, state) GRID CELLS — md:hover:bg-* is ONE `md:hover` pill,
 * not separate md + hover. Pill set = cells in classes ∪ the active editing cell.
 * Click sets all 3 axes (dispatching SET_BREAKPOINT when the breakpoint differs);
 * × deletes the exact cell (and resets the context when that cell was active);
 * "+" composes a state/theme onto the current cell. Contexts/dispatch are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setStateSpy = vi.hoisted(() => vi.fn());
const setThemeSpy = vi.hoisted(() => vi.fn());
const setBreakpointSpy = vi.hoisted(() => vi.fn());
const dispatchSpy = vi.hoisted(() => vi.fn());

let active = { state: 'default', theme: 'light', bp: 'xs', viewportBp: 'xs' };
vi.mock('@/context/StateContext', () => ({ useActiveState: () => ({ activeState: active.state, setActiveState: setStateSpy }) }));
vi.mock('@/context/ThemeContext', () => ({ useActiveTheme: () => ({ activeTheme: active.theme, setActiveTheme: setThemeSpy }) }));
vi.mock('@/context/BreakpointContext', () => ({ useActiveBreakpoint: () => ({ activeBreakpoint: active.bp, setActiveBreakpoint: setBreakpointSpy, viewportBreakpoint: active.viewportBp }) }));
vi.mock('@/store/hooks', () => ({ useDispatch: () => dispatchSpy }));

import { HeaderTags } from '../HeaderTags';

beforeEach(() => {
  active = { state: 'default', theme: 'light', bp: 'xs', viewportBp: 'xs' };
  setStateSpy.mockClear();
  setThemeSpy.mockClear();
  setBreakpointSpy.mockClear();
  dispatchSpy.mockClear();
});

describe('HeaderTags composite pill set', () => {
  it('shows a pill for an active state with NO classes', () => {
    active.state = 'hover';
    render(<HeaderTags classes="" />);
    expect(screen.getByText('hover')).toBeInTheDocument();
  });

  it('shows a pill per distinct cell present in classes', () => {
    render(<HeaderTags classes="hover:bg-red-500 dark:text-white" />);
    expect(screen.getByText('hover')).toBeInTheDocument();
    expect(screen.getByText('dark')).toBeInTheDocument();
  });

  it('renders md:hover:* as ONE composite pill, not md + hover', () => {
    render(<HeaderTags classes="md:hover:bg-stone-600" />);
    expect(screen.getByText('md:hover')).toBeInTheDocument();
    expect(screen.queryByText('md')).not.toBeInTheDocument();
    expect(screen.queryByText('hover')).not.toBeInTheDocument();
  });

  it('shows the active editing cell as a composite pill (md:hover)', () => {
    active.bp = 'md'; active.viewportBp = 'md'; active.state = 'hover';
    render(<HeaderTags classes="" />);
    expect(screen.getByText('md:hover')).toBeInTheDocument();
  });

  it('dedupes when the active cell equals a cell in classes', () => {
    active.state = 'hover';
    render(<HeaderTags classes="hover:bg-red-500" />);
    expect(screen.getAllByText('hover')).toHaveLength(1);
  });

  it('renders no pills when no classes and all-base active', () => {
    const { container } = render(<HeaderTags classes="" />);
    expect(container.querySelectorAll('[data-sq-pill]')).toHaveLength(0);
  });
});

describe('HeaderTags click selects the whole cell', () => {
  it('clicking md:hover sets all 3 axes and moves the viewport to md', () => {
    // base viewport, the cell comes from the class string (non-active).
    render(<HeaderTags classes="md:hover:bg-red-500" />);
    fireEvent.click(screen.getByText('md:hover'));
    expect(dispatchSpy).toHaveBeenCalledWith({ type: 'SET_BREAKPOINT', breakpoint: 'md' });
    expect(setBreakpointSpy).toHaveBeenCalledWith('md');
    expect(setStateSpy).toHaveBeenCalledWith('hover');
  });

  it('clicking the ACTIVE pill toggles back to base (all axes)', () => {
    active.state = 'hover';
    render(<HeaderTags classes="" />);
    fireEvent.click(screen.getByText('hover'));
    expect(setStateSpy).toHaveBeenCalledWith('default');
    expect(setThemeSpy).toHaveBeenCalledWith('light');
    expect(setBreakpointSpy).toHaveBeenCalledWith('xs');
  });
});

describe('HeaderTags "+" offers cells in two groups (user call 2026-07-03)', () => {
  // The editing layer is explicit-only (no viewport auto-follow), so the +
  // menu is THE entry point for breakpoint layers: one group scoped to the
  // CURRENT frame breakpoint (md, md:hover, …, md:dark) and one universal
  // no-breakpoint group (hover, …, dark).
  it('off-base viewport → frame-scoped group (md, md:hover, md:dark) + universal group', () => {
    active.viewportBp = 'md';
    render(<HeaderTags classes="" />);
    fireEvent.click(screen.getByTestId('add-state-btn'));
    expect(screen.getByRole('menuitem', { name: 'md' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'md:hover' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'md:dark' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'hover' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'dark' })).toBeInTheDocument();
  });

  it('base viewport → universal group only (no xs-scoped duplicates)', () => {
    render(<HeaderTags classes="" />);
    fireEvent.click(screen.getByTestId('add-state-btn'));
    expect(screen.getByRole('menuitem', { name: 'hover' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'dark' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'xs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'xs:hover' })).not.toBeInTheDocument();
  });

  it('excludes the currently active cell', () => {
    active.state = 'hover';
    render(<HeaderTags classes="" />);
    fireEvent.click(screen.getByTestId('add-state-btn'));
    expect(screen.queryByRole('menuitem', { name: 'hover' })).not.toBeInTheDocument();
  });

  it('picking md:hover enters that cell — all three axes set', () => {
    active.viewportBp = 'md';
    render(<HeaderTags classes="" />);
    fireEvent.click(screen.getByTestId('add-state-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'md:hover' }));
    expect(setBreakpointSpy).toHaveBeenCalledWith('md');
    expect(setStateSpy).toHaveBeenCalledWith('hover');
    expect(setThemeSpy).toHaveBeenCalledWith('light');
  });

  it('picking the plain breakpoint (md) enters the bp-only layer', () => {
    active.viewportBp = 'md';
    render(<HeaderTags classes="" />);
    fireEvent.click(screen.getByTestId('add-state-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'md' }));
    expect(setBreakpointSpy).toHaveBeenCalledWith('md');
    expect(setStateSpy).toHaveBeenCalledWith('default');
  });

  it('picking a universal state enters the base-scoped cell', () => {
    active.viewportBp = 'md';
    render(<HeaderTags classes="" />);
    fireEvent.click(screen.getByTestId('add-state-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'focus' }));
    expect(setStateSpy).toHaveBeenCalledWith('focus');
    expect(setBreakpointSpy).toHaveBeenCalledWith('xs');
  });

  it('picking dark sets the theme axis', () => {
    render(<HeaderTags classes="" />);
    fireEvent.click(screen.getByTestId('add-state-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'dark' }));
    expect(setThemeSpy).toHaveBeenCalledWith('dark');
  });
});

describe('HeaderTags × — exit on the active chip, delete on inactive pills', () => {
  // User call 2026-07-03: ✕ on the ACTIVE chip must EXIT the layer and KEEP
  // the classes (the old delete-on-✕ silently destroyed the just-made lg:
  // edits). Deleting a cell's classes stays on the INACTIVE pill's ✕.
  it('× on the ACTIVE chip exits the layer and does NOT delete classes', () => {
    active.state = 'hover';
    const onDeleteCell = vi.fn();
    render(<HeaderTags classes="hover:bg-red-500" onDeleteCell={onDeleteCell} />);
    fireEvent.click(screen.getByTitle('Exit hover — classes are kept'));
    expect(onDeleteCell).not.toHaveBeenCalled();
    expect(setStateSpy).toHaveBeenCalledWith('default');
    expect(setBreakpointSpy).toHaveBeenCalledWith('xs');
  });

  it('× on a NON-active pill (from classes) deletes but does NOT reset', () => {
    const onDeleteCell = vi.fn();
    render(<HeaderTags classes="hover:bg-red-500" onDeleteCell={onDeleteCell} />);
    fireEvent.click(screen.getByTitle('Remove all hover: classes'));
    expect(onDeleteCell).toHaveBeenCalledWith({ bp: 'xs', theme: 'light', state: 'hover' });
    expect(setStateSpy).not.toHaveBeenCalled();
  });
});
