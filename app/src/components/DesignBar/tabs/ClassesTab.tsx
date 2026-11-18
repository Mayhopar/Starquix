/**
 * Classes Tab Component
 *
 * Raw Tailwind class string editor with syntax highlighting.
 * Allows direct editing of the class attribute.
 */

import { useState, useCallback, useEffect } from 'react';
import Editor from 'react-simple-code-editor';
import './ClassesTab.css';
import { useVerticalResize } from '@/hooks';
import { ResizeHandle } from '@/components/shared';
import { Button } from '@/components/ui';
import { escapeHtml } from '@/utils/escapeHtml';

interface ClassesTabProps {
  classes: string;
  onClassesChange: (classes: string) => void;
}

// The editor renders this as innerHTML, and class strings come from imported
// third-party templates: every token is escaped before it is wrapped.
function highlightClasses(code: string): string {
  return code
    .split(/(\s+)/)
    .map(part => {
      if (/^\s+$/.test(part)) return part;
      if (!part) return '';

      const match = part.match(/^((?:[a-z0-9]+:)*)(.+)$/i);
      if (match) {
        const [, prefixes, utility] = match;
        let result = '';
        if (prefixes) {
          result += `<span class="token prefix">${escapeHtml(prefixes)}</span>`;
        }
        result += `<span class="token class-name">${escapeHtml(utility)}</span>`;
        return result;
      }
      return `<span class="token class-name">${escapeHtml(part)}</span>`;
    })
    .join('');
}

export function ClassesTab({ classes, onClassesChange }: ClassesTabProps): React.ReactElement {
  const [text, setText] = useState(classes);
  const [isDirty, setIsDirty] = useState(false);

  const { height: editorHeight, isDragging, handleResizeStart } = useVerticalResize({
    initialHeight: 160,
    minHeight: 80,
    maxHeight: 400,
  });

  useEffect(() => {
    if (!isDirty) {
      setText(classes);
    }
  }, [classes, isDirty]);

  const handleTextChange = useCallback((code: string) => {
    setText(code);
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    onClassesChange(text.trim());
    setIsDirty(false);
  }, [text, onClassesChange]);

  const handleReset = useCallback(() => {
    setText(classes);
    setIsDirty(false);
  }, [classes]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <div
          className="code-editor classes-editor w-full overflow-auto border border-input-stroke rounded-sm bg-input-fill focus-within:border-stroke-active"
          style={{ height: editorHeight }}
        >
          <Editor
            value={text}
            onValueChange={handleTextChange}
            highlight={highlightClasses}
            padding={8}
            placeholder="Enter Tailwind classes..."
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 12,
              minHeight: '100%',
            }}
            textareaClassName="focus:outline-none"
          />
        </div>
        <ResizeHandle isDragging={isDragging} onMouseDown={handleResizeStart} />
      </div>

      {isDragging && <div className="fixed inset-0 z-50 cursor-ns-resize" />}

      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          label="Apply"
          onClick={handleSave}
          disabled={!isDirty}
          className="flex-1"
        />
        <Button
          variant="secondary"
          size="sm"
          label="Reset"
          onClick={handleReset}
          disabled={!isDirty}
        />
      </div>
    </div>
  );
}

export default ClassesTab;
