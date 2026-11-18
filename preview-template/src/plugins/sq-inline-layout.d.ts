// Type surface for sq-inline-layout.js (task-209: inline a layout into its importers).
/* eslint-disable @typescript-eslint/no-explicit-any */
type AstNode = any;
export type AstroParse = (source: string, opts: { position: true }) => Promise<{ ast: AstNode }>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** One parsed attribute, as `@astrojs/compiler` reports it on a component node. */
export interface AstroAttribute {
  kind: 'quoted' | 'empty' | 'expression' | 'spread' | 'shorthand' | 'template-literal';
  name: string;
  value: string;
}

export interface InlineInput {
  /** The layout's own `.astro` bytes. */
  layoutSource: string;
  /** PascalCase component name, e.g. `Foo`. */
  layoutName: string;
  /** Project-relative dir the layout lives in, e.g. `src/layouts`. */
  layoutRelDir: string;
  /** The importing file's `.astro` bytes. */
  importerSource: string;
  /** Project-relative dir of the importer, e.g. `src/pages/blog`. */
  importerRelDir: string;
  parse: AstroParse;
}

export type InlineResult = { content: string } | { error: string };

export function splitFrontmatter(source: string): { frontmatter: string; template: string };
export function rewriteRelativeImports(frontmatter: string, fromDir: string, toDir: string): string;
export function attrsToLiteralBody(attrs: readonly AstroAttribute[]): string;
export function materializeProps(source: string, literal: string): string;
export function spliceChildrenBySlot(
  template: string,
  children: ReadonlyArray<{ slot: string; source: string }>,
): string;
export function inlineLayoutIntoImporter(input: InlineInput): Promise<InlineResult>;
