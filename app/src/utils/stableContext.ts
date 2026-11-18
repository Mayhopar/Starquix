import { createContext, type Context } from 'react';

declare global {
  // eslint-disable-next-line no-var
  var __sqContexts: Map<string, Context<any>> | undefined;
}

/**
 * A React context whose identity survives a Vite hot update. A context module
 * re-executes whenever it or a dependency changes; a plain `createContext`
 * then mints a second object while the mounted provider still serves the
 * first, and every consumer throws "must be used within …Provider" (owner
 * 2026-09-13: "Starquix needs to recover" on a source edit). One object per
 * name for the page's lifetime; the same code path runs in production, where
 * each module executes once anyway.
 */
export function stableContext<T>(name: string, defaultValue: T): Context<T> {
  const registry = (globalThis.__sqContexts ??= new Map());
  let context = registry.get(name);
  if (!context) {
    context = createContext<T>(defaultValue);
    context.displayName = name;
    registry.set(name, context);
  }
  return context;
}
