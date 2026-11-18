/**
 * Modal - THE overlay. One dim layer (bg-black/50, z-modal), one panel style
 * (rounded-outer, shadow-modal), sizes sm|md|lg (or 'auto' for legacy
 * self-sized content).
 *
 * Popovers/Menus inside it (portaled to body) register with it like nested
 * popovers do: a click inside one is inside the modal, Escape closes the
 * popover first, and they stack above the modal.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { cx } from './cx';
import { PopoverLayer, PopoverNesting, type RegisterPanel } from './Popover';

const ABOVE_MODAL = 'calc(var(--z-modal) + 1)';

export type ModalSize = 'sm' | 'md' | 'lg' | 'picker' | 'auto';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: ModalSize;
  className?: string;
}

const sizes: Record<ModalSize, string> = {
  sm: 'w-[400px] max-w-[90vw]',
  md: 'w-[560px] max-w-[90vw]',
  lg: 'w-[800px] max-w-[90vw]',
  // ⌘K-family pickers (ComponentPickerModal, StylePickerModal) share this shell
  picker: 'w-[602px] h-[500px] max-w-[90vw] flex flex-col',
  auto: '',
};

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, children, size = 'auto', className = '' }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const panels = useRef(new Set<HTMLElement>());
  const register = useCallback<RegisterPanel>((el) => { panels.current.add(el); return () => { panels.current.delete(el); }; }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (modalRef.current && !modalRef.current.contains(target) && ![...panels.current].some((el) => el.contains(target))) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !panels.current.size) onClose(); // an open popover closes first (its own Escape)
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 pointer-events-auto">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        className={cx(
          'bg-bg rounded-outer shadow-modal max-h-[90vh] overflow-y-auto transition-all duration-300',
          sizes[size],
          className,
        )}
      >
        <PopoverNesting.Provider value={register}>
          <PopoverLayer.Provider value={ABOVE_MODAL}>{children}</PopoverLayer.Provider>
        </PopoverNesting.Provider>
      </div>
    </div>
  );
};

export default Modal;
