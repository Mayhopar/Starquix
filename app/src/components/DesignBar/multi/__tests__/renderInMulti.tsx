/** Test helper: render inside a DesignBarContext that carries `multi.memberClasses` (null = single). */
import React from 'react';
import { render } from '@testing-library/react';
import { DesignBarProvider, type DesignBarContextValue } from '../../DesignBarContext';

const value = (memberClasses: string[] | null): DesignBarContextValue => ({
  breakpointOverrides: {}, activeBreakpoint: 'xs', isEditingBreakpoint: false, onRemoveBreakpointOverride: () => {},
  descriptor: {} as DesignBarContextValue['descriptor'],
  ...(memberClasses ? { multi: { memberClasses } } : {}),
});
/** Same component across rerenders: change `members` without remounting (state survives). */
export function MultiProvider({ members, children }: { members: string[] | null; children: React.ReactNode }) {
  return <DesignBarProvider value={value(members)}>{children}</DesignBarProvider>;
}
export const multiWrapper = (memberClasses: string[] | null) =>
  function MultiWrapper({ children }: { children: React.ReactNode }) {
    return <MultiProvider members={memberClasses}>{children}</MultiProvider>;
  };
export const renderInMulti = (ui: React.ReactElement, memberClasses: string[]) =>
  render(ui, { wrapper: multiWrapper(memberClasses) });
