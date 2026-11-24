// src/hooks/useComponentsModal.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { getModifierKey } from '@/utils/platform';
import { shortcutKey } from '@/bridge/shortcutKey';

/**
 * Hook to manage the component picker modal.
 * Opens on Cmd+K (Mac) or Ctrl+K (Windows/Linux).
 */
export function useComponentsModal() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Use ref to track modal state without causing effect re-runs
  const isModalOpenRef = useRef(isModalOpen);
  isModalOpenRef.current = isModalOpen;

  const handleOpenModal = useCallback(() => setIsModalOpen(true), []);
  const handleCloseModal = useCallback(() => setIsModalOpen(false), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focused on editable input/textarea (but allow read-only inputs)
      if (
        (e.target instanceof HTMLInputElement && !e.target.readOnly) ||
        (e.target instanceof HTMLTextAreaElement && !e.target.readOnly) ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if (getModifierKey(e) && shortcutKey(e) === 'k') {
        e.preventDefault();
        handleOpenModal();
      }

      // Close on Escape (use ref to avoid re-registering listener on modal state change)
      if (e.key === 'Escape' && isModalOpenRef.current) {
        e.preventDefault();
        handleCloseModal();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Allow programmatic open via custom event (e.g. from slot placeholder click)
    const handleCustomOpen = () => handleOpenModal();
    window.addEventListener('sq:open-component-picker', handleCustomOpen);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('sq:open-component-picker', handleCustomOpen);
    };
  }, [handleOpenModal, handleCloseModal]); // Removed isModalOpen - using ref

  return {
    isModalOpen,
    onOpenModal: handleOpenModal,
    onCloseModal: handleCloseModal,
  };
}
