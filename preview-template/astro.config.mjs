import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import node from '@astrojs/node';
import { sqSourcePlugin, sqRehypeSource } from './src/plugins/sq-source-plugin.js';

export default defineConfig({
  output: 'server',  // Enable SSR for dynamic routes
  adapter: node({
    mode: 'standalone'
  }),
  // mdx() last: it inherits the markdown config the earlier integrations set.
  // Required, not optional — content posts are written as .mdx (content-ops
  // `resolvePostPath`), and Astro's content loader fails on an .mdx entry when
  // the integration is absent, even if no route renders it.
  // The post-view route MUST be injected, not file-based: Astro's route walker
  // skips any path segment starting with '_' — directories included — so
  // src/pages/__sq_post_view/ is invisible to file-based routing and the URL
  // 404s. The instance's wrapper config injects it; so does this config.
  integrations: [tailwind(), mdx(), {
    name: 'sq-inject-routes',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        // entrypoint/entryPoint: astro >=3 reads the former, still accepts the latter.
        injectRoute({
          pattern: '/__sq_post_view/[...path]',
          entrypoint: './src/components/SqPostView.astro',
          entryPoint: './src/components/SqPostView.astro',
        });
      },
    },
  }],
  // The post-editor resolves "which page renders this post" from the
  // data-sq-post marker this rehype hook emits (parity with local mode's
  // wrapper config; @astrojs/mdx inherits markdown config).
  markdown: {
    rehypePlugins: [sqRehypeSource],
  },
  vite: {
    plugins: [sqSourcePlugin()],
    server: {
      cors: true,
      hmr: {
        // Allow cross-origin WebSocket connections from starquix editor
        protocol: 'ws',
        host: 'localhost'
      }
    }
  }
});
