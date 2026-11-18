/**
 * Source Tab Component
 *
 * Shows the full source code of the selected element.
 * Supports both:
 * - Source-tracked elements (from .astro files) - uses HTTP endpoints
 * - Component instances - uses Yjs staticMarkup
 */

import { useCallback } from 'react';
import Editor from 'react-simple-code-editor';
import './SourceTab.css';

// Lazy-loaded Prism — only loaded when SourceTab is first rendered
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Prism: any = null;
const loadPrism = async () => {
  if (!_Prism) {
    const mod = await import('prismjs');
    _Prism = mod.default;
    // @ts-expect-error — prism-markup is a side-effect-only module
    await import('prismjs/components/prism-markup');
  }
  return _Prism;
};
// Eagerly start loading when module is imported (not blocking render)
loadPrism();
import type { SourceLocation } from '@/core/state/types';
import { useUndoContext } from '@/context/UndoContext';
import { useDispatch, useYjsValue } from '@/store/hooks';
import { selectProjectId, selectCurrentPageId } from '@/store/selectors';
import { useVerticalResize } from '@/hooks';
import { writeLocalElementSource } from '@/utils/localElementSource';
import { ResizeHandle } from '@/components/shared';
import { useSourceLoader } from './useSourceLoader';
// Note: ALL_COMPONENTS was removed (replaced by dynamic scanner pipeline)
import { Button, OperationNotice } from '@/components/ui';
import { issueCopy, type OperationIssue } from '@/utils/operationIssue';

interface SourceTabProps {
  elementKey: string | null;
  sourceLocation: SourceLocation | null;
}

function highlightCode(code: string): string {
  if (_Prism?.languages?.markup) {
    return _Prism.highlight(code, _Prism.languages.markup, 'markup');
  }
  // Fallback: plain text until Prism loads (typically instant since we preload)
  return code.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

export function SourceTab({ elementKey, sourceLocation }: SourceTabProps): React.ReactElement {
  const { state, setState, isComponentInstance, instanceId, forceReload, loadedElementKey } = useSourceLoader({
    elementKey,
    sourceLocation,
  });

  // Buffer is stale when the user dirtied it against one selection then
  // switched to another. Applying now would write the old buffer to the
  // new selection's identity (instance id OR source-file:line range).
  const isStaleBuffer = state.isDirty && loadedElementKey !== null && loadedElementKey !== elementKey;

  // TODO: Fetch default HTML from /__component-preview/ endpoint using astroSource
  const defaultHtml: string | null = null;

  const { height: editorHeight, isDragging, handleResizeStart } = useVerticalResize({
    initialHeight: 192,
    minHeight: 100,
    maxHeight: 600,
  });

  const dispatch = useDispatch();
  const { takeSnapshot } = useUndoContext();
  const projectId = useYjsValue(selectProjectId);
  const currentPageId = useYjsValue(selectCurrentPageId);

  const handleTextChange = useCallback((code: string) => {
    setState(prev => ({
      ...prev,
      text: code,
      isDirty: true,
      error: prev.error === 'write-unconfirmed' ? prev.error : null,
    }));
  }, [setState]);

  const handleSave = useCallback(async () => {
    // Refuse to write a dirty buffer against a different selection than
    // the one it was edited against — prevents cross-element / cross-file
    // corruption.
    if (loadedElementKey !== null && loadedElementKey !== elementKey) {
      setState(prev => ({
        ...prev,
        error: 'selection-changed',
      }));
      return;
    }

    // Component instance - save to Yjs
    if (isComponentInstance && instanceId) {
      takeSnapshot();
      dispatch({
        type: 'UPDATE_STATIC_MARKUP',
        elementId: instanceId,
        staticMarkup: state.text,
      });
      setState(prev => ({ ...prev, isDirty: false }));
      return;
    }

    // Source-tracked element - save to file
    if (sourceLocation && state.startLine !== null && state.endLine !== null) {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        await writeLocalElementSource(sourceLocation.file, state.startLine, state.endLine, state.text);
        setState(prev => ({
          ...prev,
          isDirty: false,
          isLoading: false,
        }));
      } catch (error) {
        console.error('[Source] Write failed', error);
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'write-unconfirmed',
        }));
      }
    }
  }, [isComponentInstance, instanceId, sourceLocation, state.startLine, state.endLine, state.text, dispatch, setState, takeSnapshot, loadedElementKey, elementKey]);

  const handleReset = useCallback(() => {
    if (!elementKey || !defaultHtml) return;
    takeSnapshot();
    if (isComponentInstance && instanceId) {
      dispatch({
        type: 'UPDATE_STATIC_MARKUP',
        elementId: instanceId,
        staticMarkup: defaultHtml,
      });
    }
    // Clear all drawn elements for this page (Yjs observer handles iframe sync)
    if (currentPageId) {
      dispatch({ type: 'CLEAR_PAGE_DRAWN_ELEMENTS', pageId: currentPageId });
    }
    forceReload();
  }, [elementKey, isComponentInstance, instanceId, defaultHtml, dispatch, forceReload, currentPageId, projectId, takeSnapshot]);

  if (state.isLoading) {
    return (
      <div className="h-40 flex items-center justify-center text-text-secondary text-xs">
        Loading source...
      </div>
    );
  }

  if (!elementKey || (!sourceLocation && !isComponentInstance)) {
    return (
      <div className="h-40 flex items-center justify-center text-text-secondary text-xs text-center px-4">
        Select an element to view its source
      </div>
    );
  }

  const sourceIssue: OperationIssue | null = state.error === 'read-unavailable' || state.error === 'write-unconfirmed' ? {
    code: state.error === 'read-unavailable' ? 'read-unavailable' : 'outcome-unknown',
    operation: state.error === 'read-unavailable' ? 'source-read' : 'source-write',
    outcome: state.error === 'read-unavailable' ? 'not-applicable' : 'unknown',
    owner: { projectId, entityKey: loadedElementKey ?? elementKey, visit: 0 }, episode: 0,
    recover: state.error === 'read-unavailable' && !state.isDirty ? 'read-again' : 'none',
    fallbackUsable: false,
  } : null;
  const copy = sourceIssue ? issueCopy(sourceIssue) : null;
  if (state.error === 'read-unavailable' && !state.isDirty && copy) {
    return <OperationNotice title={copy.title} action={{ label: 'Retry', onClick: forceReload }} />;
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <div
          className="code-editor source-editor w-full overflow-auto border border-input-stroke rounded-sm bg-input-fill focus-within:border-stroke-active"
          style={{ height: editorHeight }}
        >
          <Editor
            value={state.text}
            onValueChange={handleTextChange}
            highlight={highlightCode}
            padding={8}
            placeholder="Element source code..."
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 12,
              minHeight: '100%',
            }}
            textareaClassName="focus:outline-none"
            className="source-editor-inner"
          />
        </div>
        <ResizeHandle isDragging={isDragging} onMouseDown={handleResizeStart} />
      </div>

      {isDragging && <div className="fixed inset-0 z-50 cursor-ns-resize" />}

      {copy && (
        <OperationNotice title={copy.title} detail="Your source draft is still here. Check the source before applying it again." />
      )}
      {(isStaleBuffer || state.error === 'selection-changed') && (
        <OperationNotice title="Buffer was edited against a different element." detail="Select the original element to continue editing this draft." />
      )}

      <div className="flex gap-2 justify-end">
        <Button
          variant="secondary"
          size="sm"
          label="Reset"
          onClick={handleReset}
          disabled={!defaultHtml}
          title="Restore default component code"
        />
        <Button
          variant="primary"
          size="sm"
          label="Apply"
          onClick={handleSave}
          disabled={!state.isDirty || isStaleBuffer}
        />
      </div>
    </div>
  );
}

export default SourceTab;
