// Type surface for sq-tagging.js (shared tagger, task-132).
export function transformCompiledOutput(
  compiledCode: string,
  originalCode: string,
  filePath: string,
  projectRoot: string,
  pathMode: 'relative' | 'absolute',
  parse: (source: string, opts: { position: boolean }) => Promise<{ ast: unknown }>,
  options?: {
    placements?: boolean;
    /**
     * task-176 — THE PARSE GATE. A JS parser (`rollup/parseAst`) that throws on
     * invalid source. When supplied, the assembled module is parsed before it
     * is returned and a module that does not parse is dropped (`null`) instead
     * of served. Local-mode only; the 6-arg WC/server path omits it and is
     * byte-identical by construction.
     */
    parseJs?: (source: string) => unknown;
  }
): Promise<{ code: string; map?: null } | null>;

/**
 * task-160 — exported so the open-time stamper
 * (`app/src/vite-plugin/server/localStamp.ts`) decides eligibility with THE
 * tagger's own rule rather than a lookalike. Stamping something the tagger
 * ignores pollutes a user's source for nothing; missing something it tags
 * leaves the sliding-ordinal hole open.
 */
export function collectImportSpecifiers(originalCode: string): Map<string, string>;

export function isTaggablePlacementComponent(
  name: string,
  specifiers: Map<string, string>,
  attributes: Array<{ name?: string; kind?: string; value?: string }> | undefined
): boolean;
export function elementFallbacks(node: { name?: string; attributes?: unknown[]; children?: unknown[] }): { cf: string | null; tf: string | null; sf: string | null } | null;
