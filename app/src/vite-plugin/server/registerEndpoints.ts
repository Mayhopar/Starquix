import type { SqServerContext } from './context';
import { registerVariablesEndpoints } from './variables';
import { registerWriteEndpoints } from './writeEndpoints';
import { registerLayoutsEndpoints } from './layouts';
import { registerComponentsEndpoints } from './components';
import { registerWriteBackEndpoints } from './writeBack';
import { registerContentEndpoints } from './content';
import { registerFoldersEndpoints } from './folders';
import { registerComponentFileEndpoints } from './localComponentFiles';

/**
 * Registers the extracted /__sq/* endpoint groups. Modules are added here as
 * the godfile-decomposition plan extracts them (Tasks B3..B9). All routes are
 * distinct connect prefixes, so registering them as one block is
 * order-equivalent to the original inline registrations; the only
 * order-sensitive pair (the two /__sq/element-source middlewares) moves as a
 * unit inside its module.
 */
export function registerSqEndpoints(ctx: SqServerContext): void {
  registerVariablesEndpoints(ctx);
  registerWriteEndpoints(ctx);
  registerLayoutsEndpoints(ctx);
  registerComponentsEndpoints(ctx);
  registerWriteBackEndpoints(ctx);
  registerContentEndpoints(ctx);
  registerFoldersEndpoints(ctx);
  registerComponentFileEndpoints(ctx);
  // The /__sq/local/* route table is NOT mounted on the app host any more: the
  // host-folder disk is gone (docs/plans/2026-09-10-remove-open-local-folder-design.md).
  // Every /__sq/local/* call reaches the instance in the desktop app through
  // the transport utils/sqLocalBase.ts holds.
}
