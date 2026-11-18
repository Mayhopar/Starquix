import ts from 'typescript';
import { relative, resolve } from 'node:path';

const YJS_WRITES = new Set(['set', 'delete', 'insert', 'push', 'unshift', 'clear', 'applyDelta']);

/** Type-aware: catches Y.Map/Y.Array writes even without doc.transact, while
 * ignoring native Map, DOM and Dexie calls. Tests/fixtures are not owners. */
export function directMutationInventory(root: string): Record<string, number> {
  const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const result: Record<string, number> = {};
  for (const source of program.getSourceFiles()) {
    const file = relative(resolve(root, 'src'), source.fileName).replace(/\\/g, '/');
    if (file.startsWith('..') || file.startsWith('test/') || file.includes('__tests__/') || file.includes('__fixtures__/') || /\.(test|spec)\./.test(file) || source.isDeclarationFile) continue;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        // The checker is the expensive part (a whole-app type walk that timed out a loaded gate at 60s): ask it only for
        // the method names that can count — same result, a fraction of the type resolutions.
        const isYjsReceiver = () => {
          const receiver = checker.getNonNullableType(checker.getTypeAtLocation((node.expression as ts.PropertyAccessExpression).expression));
          return (receiver.getSymbol()?.getDeclarations() ?? []).some(decl => /[\\/]yjs[\\/]/.test(decl.getSourceFile().fileName));
        };
        if (method === 'transact' || (YJS_WRITES.has(method) && isYjsReceiver())) {
          const key = `${file}:${method === 'transact' ? 'transactions' : 'writes'}`;
          result[key] = (result[key] ?? 0) + 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
