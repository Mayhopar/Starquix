import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwind from '@astrojs/tailwind';

// @astrojs/mdx is here DELIBERATELY: src/content/works/*.mdx only compiles with
// it, and the markdown/MDX source tagger (sqRehypeSource, registered by our
// wrapper on cfg.markdown.rehypePlugins) only reaches .mdx because the mdx
// integration inherits the markdown config (extendMarkdownConfig defaults true).
// It was installed in node_modules but recorded in neither package.json nor this
// file, so a fresh `npm install` would have silently produced a fixture where
// every .mdx failed to render.
// @astrojs/tailwind is here so the fixture matches NORMAL (WC) mode, which ships
// tailwindcss + @astrojs/tailwind in `preview-template/package.json`. Without it
// the fixture had NO css at all: every utility the editor writes (`m-0`, `p-0`,
// `bg-white`, `border`) was inert text, the DesignBar showed the intended value
// while the canvas never changed, and UA default margins on h1/p/ul read to the
// user as unremovable "padding" on a section whose padding really was 0.
// Preflight (applyBaseStyles, default true) is the half that zeroes those.
export default defineConfig({
  integrations: [mdx(), tailwind()],
});
