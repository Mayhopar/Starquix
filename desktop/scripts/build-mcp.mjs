// Bundles the coding-agent relay CLI (../mcp/src/cli.ts) into ONE file the app
// ships (mcp/starquix-mcp.mjs) and runs on its own runtime — see src/main.mjs.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.resolve(here, '../../mcp/src/cli.ts')],
  outfile: path.resolve(here, '../mcp/starquix-mcp.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning',
  // CommonJS deps (ws) call require() inside an ES module bundle.
  banner: { js: "import { createRequire as __sqRequire } from 'node:module'; const require = __sqRequire(import.meta.url);" },
});
console.log('mcp/starquix-mcp.mjs built');
