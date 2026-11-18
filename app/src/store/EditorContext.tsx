// src/store/EditorContext.tsx
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { createEditorDoc } from './createEditorDoc';
import { stableContext } from '@/utils/stableContext';
import { probeDurableEditStorage } from '@/services/durableEdits/acceptance';
import { RecoveryActions } from '@/components/AppErrorBoundary';
import { storageFailureGuidance } from '@/services/browserStorage';

interface EditorContextValue {
  doc: Y.Doc;
}

const EditorContext = stableContext<EditorContextValue | null>('EditorContext', null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [storage, setStorage] = useState<'checking' | 'ready' | 'failed'>('checking');
  const [attempt, setAttempt] = useState(0);
  const value = useMemo(() => {
    const doc = createEditorDoc();
    return { doc };
  }, []);

  useEffect(() => {
    let active = true;
    void probeDurableEditStorage().then(
      () => { if (active) setStorage('ready'); },
      () => { if (active) setStorage('failed'); },
    );
    return () => { active = false; };
  }, [attempt]);

  if (storage === 'checking') return <div role="status">Checking browser storage…</div>;
  if (storage === 'failed') {
    return <RecoveryActions category="storage" detail={storageFailureGuidance('storage', 'load')}
      onRetry={() => { setStorage('checking'); setAttempt(current => current + 1); }} />;
  }

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}

function useEditorContext(): EditorContextValue {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditorContext must be used within EditorProvider');
  }
  return context;
}

export function useEditorDoc(): Y.Doc {
  return useEditorContext().doc;
}

/** The doc when inside an EditorProvider, else null (chrome rendered in tests without one). */
export function useOptionalEditorDoc(): Y.Doc | null {
  return useContext(EditorContext)?.doc ?? null;
}
