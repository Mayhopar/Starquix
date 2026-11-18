/**
 * Section-wrapper helpers shared by DesignBar and ElementDesignPanel. Extracted
 * verbatim from DesignBar.tsx (task-043) so both files can use them without a
 * circular import. Behavior unchanged — these are the same components, moved.
 *
 * - ExpandableRow: uncontrolled expandable Row wrapper (Position/Appearance/…).
 * - OptionalSection: +/– add-remove section (Fill, Stroke).
 * - EffectsSection: + add section that shows content when effects exist.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { Row, Button } from '@/components/ui';
import { PlusIcon, MinusIcon } from '@/assets/icons';

// ============================================================================
// ExpandableRow - Uncontrolled expandable Row wrapper
// ============================================================================

export const ExpandableRow: React.FC<{
  title: string;
  defaultExpanded?: boolean;
  className?: string;
  /** Override tags rendered below the header, left-aligned */
  tags?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, defaultExpanded = true, className, tags, children }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Sync with defaultExpanded when it changes (e.g., switching between text/non-text elements)
  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <div>
      <Row
        title={title}
        expandable
        expanded={expanded}
        onExpandChange={setExpanded}
        hover={false}
        className={`pl-1 pr-0 ${className || ''}`}
      />
      {tags}
      {expanded && children}
    </div>
  );
};

// ============================================================================
// OptionalSection Component (with +/– for Fill, Stroke)
// ============================================================================

interface OptionalSectionProps {
  title: string;
  hasClasses: boolean;
  children: React.ReactNode;
  /** Called when + is clicked to add default styles */
  onAdd: () => void;
  /** Called when – is clicked to remove all related classes */
  onRemove: () => void;
  /** Override tags rendered below the header */
  tags?: React.ReactNode;
}

export const OptionalSection: React.FC<OptionalSectionProps> = ({
  title,
  hasClasses,
  children,
  onAdd,
  onRemove,
  tags
}) => {
  const [isOpen, setIsOpen] = useState(hasClasses);

  // Auto-open when classes are added externally (e.g., undo/redo)
  useEffect(() => {
    if (hasClasses && !isOpen) {
      setIsOpen(true);
    }
  }, [hasClasses, isOpen]);

  // Click anywhere on row: add property and open (if closed), or just toggle (if open)
  const handleRowClick = useCallback(() => {
    if (!isOpen) {
      onAdd();
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [isOpen, onAdd]);

  // Click +/– button: same as row click but with stopPropagation
  const handleButtonClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen) {
      onAdd();
      setIsOpen(true);
    } else {
      onRemove();
      setIsOpen(false);
    }
  }, [isOpen, onAdd, onRemove]);

  return (
    <div>
      {/* Header = a kit Row (no chevron): the row click toggles, the +/– button adds/removes */}
      <Row
        title={title}
        hover={false}
        className="pl-1 pr-0"
        onClick={handleRowClick}
        right={
          <Button
            variant="ghost"
            size="md"
            iconOnly
            onClick={handleButtonClick}
            title={isOpen ? 'Remove and close' : 'Add and open'}
            aria-label={`${isOpen ? 'Remove' : 'Add'} ${title.toLowerCase()}`}
          >
            {isOpen ? <MinusIcon className="w-4 h-4" /> : <PlusIcon className="w-4 h-4" />}
          </Button>
        }
      />

      {tags}

      {/* Expanded content */}
      {isOpen && children}
    </div>
  );
};

// ============================================================================
// EffectsSection Component (shows content when hasEffects, + button to add)
// ============================================================================

interface EffectsSectionProps {
  title: string;
  hasEffects: boolean;
  children: React.ReactNode;
  /** Called when + is clicked to add a new effect */
  onAdd: () => void;
  /** Override tags rendered below the header */
  tags?: React.ReactNode;
}

export const EffectsSection: React.FC<EffectsSectionProps> = ({
  title,
  hasEffects,
  children,
  onAdd,
  tags
}) => {
  const handleButtonClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onAdd();
  }, [onAdd]);

  return (
    <div>
      {/* Header = a kit Row: always shows the + button */}
      <Row
        title={title}
        hover={false}
        className="pl-1 pr-0"
        onClick={onAdd}
        right={
          <Button variant="ghost" size="md" iconOnly onClick={handleButtonClick} title="Add effect">
            <PlusIcon className="w-4 h-4" />
          </Button>
        }
      />

      {tags}

      {/* Show content when effects exist */}
      {hasEffects && children}
    </div>
  );
};
