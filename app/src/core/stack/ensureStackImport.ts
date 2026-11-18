import { parsePostBody, serializePostDoc, docEsmBindings, insertImportBlock } from '@/postmodel/postModel';
import { componentImportPathFor } from '@/components/PostEditor/ensureComponent';
import { systemComponentPath } from '@/utils/systemComponents';

const STACK_TAG = /<Stack[\s>/]/;

/**
 * Every body writer funnels here (design D10): a `<Stack` without a `Stack`
 * binding gets OUR import. A user's own `Stack` import wins — never rebound.
 * ponytail: a `<Stack` inside a code fence also adds the import; harmless (unused import compiles).
 */
export function ensureStackImport(body: string, postFile: string): string {
  if (!postFile.endsWith('.mdx') || !STACK_TAG.test(body)) return body;
  let doc;
  try { doc = parsePostBody(body, 'mdx'); } catch { return body; } // unparsable → the compile gate reports it
  if (docEsmBindings(doc).some(b => b.local === 'Stack')) return body;
  const importPath = componentImportPathFor(postFile, systemComponentPath('Stack'));
  return serializePostDoc(insertImportBlock(doc, `import Stack from '${importPath}';`).doc);
}
