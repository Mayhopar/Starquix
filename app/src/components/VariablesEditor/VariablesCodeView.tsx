// app/src/components/VariablesEditor/VariablesCodeView.tsx

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import Editor from 'react-simple-code-editor';
import type { VariableCollection } from '@/core/variables/types';
import { generateCSS } from '@/core/variables/cssGenerator';
import { parseCSS } from '@/core/variables/cssParser';

// Lazy-loaded Prism — same pattern as SourceTab
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Prism: any = null;
const loadPrism = async () => {
  if (!_Prism) {
    const mod = await import('prismjs');
    _Prism = mod.default;
    // @ts-expect-error — prism-css is a side-effect-only module
    await import('prismjs/components/prism-css');
  }
  return _Prism;
};
// Eagerly start loading when module is imported
loadPrism();

function highlightCSS(code: string): string {
  if (_Prism?.languages?.css) {
    return _Prism.highlight(code, _Prism.languages.css, 'css');
  }
  return code;
}

interface VariablesCodeViewProps {
  collection: VariableCollection;
  onParsed: (collection: VariableCollection) => void;
}

export const VariablesCodeView = memo(function VariablesCodeView({ collection, onParsed }: VariablesCodeViewProps) {
  const [code, setCode] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const collectionRef = useRef(collection);
  collectionRef.current = collection;

  // Generate CSS from collection
  useEffect(() => {
    setCode(generateCSS(collection));
    setParseError(null);
  }, [collection]);

  const handleBlur = useCallback(() => {
    try {
      const parsed = parseCSS(code, collectionRef.current);
      setParseError(null);
      onParsed(parsed);
    } catch (err) {
      setParseError((err as Error).message);
    }
  }, [code, onParsed]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleBlur();
    }
  }, [handleBlur]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {parseError && (
        <div className="px-3 py-1.5 bg-error-subtle border-b border-error/30 text-xs text-error">
          Parse error: {parseError}
        </div>
      )}
      <div className="flex-1 overflow-auto" onKeyDown={handleKeyDown}>
        <Editor
          value={code}
          onValueChange={setCode}
          highlight={highlightCSS}
          onBlur={handleBlur}
          padding={16}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 12,
            lineHeight: 1.6,
            minHeight: '100%',
            color: 'var(--color-text)',
            backgroundColor: 'transparent',
          }}
        />
      </div>
    </div>
  );
});
