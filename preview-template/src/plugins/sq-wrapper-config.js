/**
 * sq-wrapper-config — THE astro config wrapper for a project instance: the
 * desktop app writes it to `<project>/.sq/` (desktop/src/wrapper.mjs) and
 * spawns the user's astro dev with it.
 *
 * Plain JS by construction (it ships beside the plugin). No node imports here.
 *
 * @param opts.bridgeJsPathSrc  JS SOURCE for the bridge.js path expression —
 *        derived from import.meta.url (see SQ_BRIDGE_JS_PATH_SRC).
 * @param opts.prelude  extra import lines the expression needs.
 */

/** Our files live under <project>/.sq/, the wrapper beside them. */
export const SQ_BRIDGE_JS_PATH_SRC = "fileURLToPath(new URL('./public/scripts/bridge.js', import.meta.url))";
export const SQ_PRELUDE = "import { fileURLToPath } from 'node:url';\n";

export function renderWrapperConfig(userConfigPath, sqPluginPath, componentViewPath, postViewPath, opts) {
  const bridgeJsPathSrc = opts.bridgeJsPathSrc;
  const prelude = opts.prelude || '';
  // ponytail: naive default-export wrapper; exotic configs go through the manual escape hatch (design §3)
  return `${prelude}import userConfig from '${userConfigPath}';
import { sqSourcePlugin, sqRehypeSource } from '${sqPluginPath}';
import { sqAstroCompat, SQ_ASTRO_LEGACY } from '${sqPluginPath.replace('sq-source-plugin', 'sq-astro-compat')}';
const base = typeof userConfig === 'function' ? userConfig({ command: 'dev', mode: 'development' }) : userConfig;
// task-204: NEVER mutate the imported config — the ESM cache keeps \`base\` alive
// across wrapper re-evaluations, so in-place appends would stack a second sq
// plugin/integration and every element would ship duplicate data-sq-* attrs.
// Clone, then de-dupe by name/identity before appending exactly one of each.
const cfg = { ...base };
cfg.vite = { ...(base.vite || {}) };
cfg.vite.plugins = [...(cfg.vite.plugins || []).filter(p => !(p && p.name === 'sq-source-plugin')), sqSourcePlugin({ bridgeJsPath: ${bridgeJsPathSrc} })];
// Source ranges for markdown/MDX. The vite plugin only sees .astro, so the ONLY
// door onto markdown is the rehype hook — @astrojs/mdx inherits this config
// (extendMarkdownConfig defaults true), so it reaches .mdx too.
cfg.markdown = { ...(base.markdown || {}) };
cfg.markdown.rehypePlugins = [...(cfg.markdown.rehypePlugins || []).filter(p => p !== sqRehypeSource), sqRehypeSource];
// Astro 6 refuses to boot on v4 collections and drops their entry API — every blog project and
// our own SqPostView rely on them.
cfg.legacy = { ...(base.legacy || {}), ...SQ_ASTRO_LEGACY };
cfg.vite.plugins = [...cfg.vite.plugins.filter(p => !p?.name?.startsWith?.('sq-astro-compat')), ...sqAstroCompat()];
cfg.integrations = [...(cfg.integrations || []).filter(i => !(i && i.name === 'sq-local-component-view')), {
  name: 'sq-local-component-view',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      // entrypoint/entryPoint: astro >=3 uses the former, keeps reading the latter.
      // The file rides the PATH (catch-all param): static-output projects have
      // every route prerendered, and prerendered routes get query strings
      // STRIPPED from Astro.url/request even in dev — ?file= would vanish.
      injectRoute({ pattern: '/__sq_component_view/[...file]', entrypoint: '${componentViewPath}', entryPoint: '${componentViewPath}' });
      // Content editor: the bare post-body surface, one entry per path
      // (\`/__sq_post_view/<collection>/<slug>\`). Same path-not-query rule.
      injectRoute({ pattern: '/__sq_post_view/[...path]', entrypoint: '${postViewPath}', entryPoint: '${postViewPath}' });
    },
  },
}];
// The preview is the editor canvas, not the user's browser: Astro's dev
// toolbar (fixed to the iframe's bottom) painted a pill over the content once
// the artboard hugged it.
cfg.devToolbar = { ...(base.devToolbar || {}), enabled: false };
export default cfg;
`;
}

