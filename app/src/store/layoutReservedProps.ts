/**
 * Layout prop names that are OWNED by page.seo and therefore must NOT be
 * editable as hand-typed layout props. They are fed to the layout from
 * page.seo at codegen time and migrated out of layoutProps on load.
 * Mapping is 1:1 by name to the SeoPageData field of the same name.
 */
export const LAYOUT_SEO_RESERVED_PROPS = new Set<string>(['title', 'description']);

export function isReservedLayoutProp(name: string): boolean {
  return LAYOUT_SEO_RESERVED_PROPS.has(name);
}
