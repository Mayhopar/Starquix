import * as Y from 'yjs';
import { resolveRelImport, resolveComponentSourcePath } from '@/utils/astroAssetPaths';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { captureLocalWriteOrigin } from '@/utils/localWriteScope';
import { acceptDocumentMutation } from '@/store/documentMutation';
import type { DurableLayoutAppend, MaterializationCommand, DurableFileChange, SourceIdentityMap } from './types';
import { attributeIdentityMap } from './sourceIdentity';
import { createSourceIdentityMap, spliceSourceSpans } from '@/vite-plugin/source-transform-identity';

export function layoutAppendCommand(layoutSource: string, componentName: string, componentPath: string, defer = false): MaterializationCommand {
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(componentName)) throw new Error('Invalid component name');
  return { kind: 'layout-append', payload: { pageFile: resolveComponentSourcePath(layoutSource), markup: `  <${componentName} />`,
    importName: componentName, importPath: resolveRelImport(layoutSource, componentPath), origin: captureLocalWriteOrigin(),
    ...(defer ? { deferUntil: Date.now() + 86400000 } : {}) } };
}

/** Preserve the layout editor's existing static-source placement rule. */
export function applyLayoutAppend(source: string, intent: DurableLayoutAppend): string {
  return prepareLayoutAppend(source, intent).afterSource!;
}

export function prepareLayoutAppend(source: string, intent: DurableLayoutAppend): DurableFileChange {
  const crlf = source.includes('\r\n');
  const lineEndings = (text: string) => crlf ? text.replace(/\n/g, '\r\n') : text;
  let content = source.replace(/\r\n/g, '\n');
  const maps: SourceIdentityMap[] = [];
  const original = content;
  if (intent.importName && intent.importPath && !new RegExp(`import\\s+${intent.importName}\\b`).test(content)) {
    const statement = `import ${intent.importName} from '${intent.importPath}';`;
    const fm = content.match(/^(---\s*\n)([\s\S]*?)(\n---\s*\n?)/);
    content = fm ? fm[1] + fm[2].trimEnd() + '\n' + statement + fm[3] + content.slice(fm[0].length)
      : `---\n${statement}\n---\n${content}`;
  }
  if (content !== original) maps.push(attributeIdentityMap(source, lineEndings(content)));
  const closing = content.match(/<\/([A-Z][A-Za-z0-9_]*)>\s*$/);
  const body = content.match(/<\/body>/i);
  const start = closing?.index ?? body?.index ?? content.trimEnd().length;
  const end = closing || body ? start : content.length;
  const inserted = `${closing || body ? '' : '\n'}${intent.markup.replace(/\r\n/g, '\n')}\n`;
  const after = content.slice(0, start) + inserted + content.slice(end);
  maps.push(createSourceIdentityMap(lineEndings(content), lineEndings(after), spliceSourceSpans(content.length, start, end, inserted.length)));
  return { file: intent.pageFile, beforeSource: source, afterSource: lineEndings(after), identityMaps: maps };
}

export async function appendComponentToLayoutSource(layoutSource: string, componentName: string, componentPath: string): Promise<void> {
  const projectId = getActiveSaveProjectId();
  if (!projectId) throw new Error('Project storage is not ready');
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  try {
    await acceptDocumentMutation(doc, () => {}, undefined, [layoutAppendCommand(layoutSource, componentName, componentPath)]);
  } finally { doc.destroy(); }
}
