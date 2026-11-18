/**
 * sq-astro-compat — keeps Astro 4 sites running on the shared Astro 6 runtime
 * without touching their files. Used by dev (the wrapper config) and by the
 * publish build (desktop/src/build-runner.mjs).
 *
 * `legacy.collectionsBackwardsCompat` restores src/content/config.ts, implicit
 * loaders and path ids — but NOT `entry.slug` / `entry.render()`, whatever the
 * docs say (6.4.8: no emulation left in astro/dist). User sites and our own
 * generated code (utils/blogBinding) are full of both, so the entry API comes
 * back here, on the `astro:content` module. Same for `<ViewTransitions />`,
 * which Astro 6 turns into a blank 200 page, and for `Astro.glob()`.
 *
 * Plain JS by construction (it ships beside the plugin).
 */
export const SQ_ASTRO_LEGACY = { collectionsBackwardsCompat: true };

/** Type errors `astro check` raises only for what this file restores: the site runs fine, so never show them at publish. */
export const SQ_ASTRO_COMPAT_TYPE_ERROR = /^Property '(slug|render)' does not exist on type '\{ id: string|^Property 'glob' does not exist on type 'Readonly<AstroGlobal|has no exported member 'ViewTransitions'/;

const ENTRY_API = `
// \`render\` is the module's own binding: imported in Astro 6, \`createRenderEntry(...)\` in Astro 7.
import { slug as sqSlug } from 'github-slugger';
const sqLegacySlug = entry => entry.data?.slug ?? entry.id.replace(/\\.(md|mdx|markdown|markdoc)$/i, '')
  .split('/').map(segment => sqSlug(segment)).join('/').replace(/\\/index$/, '');
// The spread drops the getters runtime.js defines to warn about these very properties.
const sqLegacyEntry = entry => {
  if (!entry || typeof entry !== 'object') return entry;
  const plain = { ...entry };
  return { ...plain, slug: sqLegacySlug(plain), render: () => render(plain) };
};
export const getCollection = async (collection, filter) => (await sqGetCollection(collection))
  .map(sqLegacyEntry).filter(entry => typeof filter !== 'function' || filter(entry));
// ponytail: linear scan per lookup, a slug index if a site ever calls this per card on 1000s of posts.
export const getEntry = async (first, second) => {
  const isName = typeof first === 'string';
  const collection = isName ? first : first?.collection;
  const key = isName ? second : first?.id ?? first?.slug;
  const hit = (await sqGetCollection(collection)).map(sqLegacyEntry).find(entry => entry.id === key || entry.slug === key);
  return hit ?? sqLegacyEntry(await sqGetEntry(first, second));
};
`;

function patchContentModule(code) {
  return code
    .replace('export const getCollection = createGetCollection(', 'const sqGetCollection = createGetCollection(')
    .replace('export const getEntry = createGetEntry(', 'const sqGetEntry = createGetEntry(')
    .replace('export const getEntries = createGetEntries(getEntry);', `${ENTRY_API}\nexport const getEntries = createGetEntries(getEntry);`)
    .replace("export const getEntryBySlug = createDeprecatedFunction('getEntryBySlug');", 'export const getEntryBySlug = (collection, slug) => getEntry(collection, slug);');
}

// ponytail: literal patterns only, which is all import.meta.glob takes. Astro 4 needed one too.
const ASTRO_GLOB = /\bAstro\d*\.glob(?:<[^(]*>)?\(\s*('[^']*'|"[^"]*"|`[^`$]*`)\s*\)/g;
export function patchAstroGlob(code) {
  return code.replace(ASTRO_GLOB, 'Promise.all(Object.values(import.meta.glob($1)).map(load => load()))');
}

export function sqAstroCompat() {
  return [{
    name: 'sq-astro-compat-glob',
    // No enforce on purpose: after Astro's compile (pre), before Vite expands import.meta.glob.
    transform(code, id) {
      if (!id.split('?')[0].endsWith('.astro')) return null;
      const next = patchAstroGlob(code);
      return next === code ? null : { code: next, map: null };
    },
  }, {
    name: 'sq-astro-compat-modules',
    enforce: 'post',
    transform(code, id) {
      // Only where it is gone: a project with its own node_modules can still run Astro 4, which has no ClientRouter.
      if (id === '\0astro:transitions' && code.includes('ClientRouter') && !code.includes('ViewTransitions')) {
        return { code: `${code}\nexport { default as ViewTransitions } from 'astro/components/ClientRouter.astro';\n`, map: null };
      }
      // The client environment gets an error stub instead: nothing to patch.
      if (id === '\0astro:content' && code.includes('createGetCollection(')) return { code: patchContentModule(code), map: null };
      return null;
    },
  }];
}
