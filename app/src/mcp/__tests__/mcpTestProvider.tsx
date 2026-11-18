import React from 'react';
import { McpContext, type McpContextValue } from '../McpContext';
export type { McpContextValue };
/** Stub provider for UI tests: no session, no hooks — just the value. */
export function McpTestProvider({ value, children }: { value: McpContextValue; children: React.ReactNode }) {
  return <McpContext.Provider value={value}>{children}</McpContext.Provider>;
}
