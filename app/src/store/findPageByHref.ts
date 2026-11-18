/**
 * Resolve an internal href to the page it points at.
 *
 * THE single href→page matcher. Extracted from LinkBlock's `matchingPage`
 * (task-116) so preview-mode link navigation and the DesignBar's "Go to page"
 * resolve identically — a second lookalike matcher is exactly the drift this
 * codebase has paid for before.
 *
 * Lenient by design: hrefs are stored, not derived, so they must be matched
 * case-insensitively, trailing-slash-tolerantly, and against the legacy
 * derivation as well as the current one.
 */
import type { PageData } from './types';
import { pageRoute } from './pageRoute';

/**
 * LEGACY href derivation — hrefs stored before 2026-06-11 were minted with
 * this (strips special chars: 'Q&A' → '/qa'; no index case: Home → '/home').
 * Kept ONLY so stored old hrefs still resolve. NEVER use it to mint new
 * hrefs — that's pageRoute (store/pageRoute.ts).
 */
function legacyPageNameToPath(name: string): string {
  return '/' + name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/** Normalize a path for internal-link comparison: lowercase + trim trailing slashes */
function normalizePath(path: string): string {
  const trimmed = path.toLowerCase().replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * First page whose current OR legacy path matches `href`, else null.
 * A miss is normal (external link, typo, unbuilt page) — callers treat it as
 * inert rather than an error.
 */
export function findPageByHref(pages: PageData[], href: string | null | undefined): PageData | null {
  if (!href) return null;
  const normalized = normalizePath(href);
  return pages.find(page =>
    normalizePath(pageRoute(page)) === normalized ||
    normalizePath(legacyPageNameToPath(page.name)) === normalized,
  ) ?? null;
}
