import type { StructuralOp } from '@/store/structuralUndo';
// The runtime imports this same browser-safe pure implementation.
// @ts-expect-error shared JavaScript transforms
import * as transform from '../../../../preview-template/src/plugins/sq-source-transforms.js';

export function structuralFile(op: StructuralOp): string {
  switch (op.kind) {
    case 'insert': case 'remove': case 'restore': case 'restore-region': return op.loc.file;
    case 'append-page': case 'import': return op.pageFile;
    case 'move':
      if (op.from.file !== op.to.file) throw new Error('A structural move must stay in one source file');
      return op.from.file;
    case 'page-delete': case 'page-restore': return op.file;
    case 'page-move': case 'content-body': throw new Error(`Structural command ${op.kind} requires its dedicated materializer`);
    default: { const exhaustive: never = op; throw new Error(String(exhaustive)); }
  }
}

export function applyStructuralTransform(source: string, op: StructuralOp): { content: string; [key: string]: unknown } {
  switch (op.kind) {
    case 'insert': return transform.insertMarkupAtLocation(source, op.loc, op.markup, op.position);
    case 'append-page': return transform.appendToPageBody(source, op.markup);
    case 'remove': return transform.removeElementAtLocation(source, op.loc, { allowRootRemoval: op.allowRootRemoval });
    case 'move': return transform.moveElement(source, op.from, op.to, op.position, { allowRootRemoval: op.allowRootRemoval });
    case 'restore': return transform.restoreSourceAtLocation(source, op.loc, op.text);
    case 'restore-region': return transform.restoreRegionAtLocation(source, op.loc, op.lineCount, op.segment);
    case 'import': {
      if (op.remove) {
        const content = transform.removeImportFromFrontmatter(source, op.name, { removeFences: op.removeFences });
        return { content, removed: content !== source };
      }
      const content = transform.addImportToFrontmatter(source, op.name, op.importPath);
      const added = content !== source;
      return { content, added, lineDelta: added ? content.split('\n').length - source.split('\n').length : 0 };
    }
    case 'page-delete': case 'page-restore': case 'page-move': case 'content-body':
      throw new Error(`Structural command ${op.kind} requires its dedicated materializer`);
    default: { const exhaustive: never = op; throw new Error(String(exhaustive)); }
  }
}
