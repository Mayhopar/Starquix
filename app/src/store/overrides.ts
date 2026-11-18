// src/store/overrides.ts
/**
 * Unified Override API
 *
 * Provides a single interface for managing element overrides.
 * Replaces the fragmented 5-map system (overrides, classOverrides,
 * textOverrides, markupOverrides, hrefOverrides).
 */
import * as Y from 'yjs';
import type { ElementOverride, ClassData, SerializedOverrides } from './types';
import { emptyClassData } from './types';

type OverrideType = 'styles' | 'classes' | 'content' | 'href';

export interface OverrideAPI {
  /** Get all overrides for a selector */
  getOverride(selector: string): ElementOverride | undefined;

  /** Set/merge overrides for a selector */
  setOverride(selector: string, override: Partial<ElementOverride>): void;

  /** Clear overrides for a selector (all or specific types) */
  clearOverride(selector: string, types?: OverrideType[]): void;

  /** Check if selector has overrides (all or specific types) */
  hasOverride(selector: string, types?: OverrideType[]): boolean;

  /** Set text or markup content (convenience method) */
  setContent(selector: string, value: string, type: 'text' | 'markup'): void;

  /** Set href override (convenience method) */
  setHref(selector: string, href: string, target?: '_blank' | '_self'): void;

  /** Get all selectors with overrides */
  getAllSelectors(): string[];

  /** Check if any overrides exist */
  isEmpty(): boolean;

  /** Clear all overrides */
  resetAll(): void;

  /** Get serializable snapshot for undo */
  getSnapshot(): SerializedOverrides;

  /** Restore from snapshot (atomic - clears and replaces) */
  restoreSnapshot(snapshot: SerializedOverrides): void;
}

/**
 * Convert Y.Map override entry to plain object
 */
function yMapToOverride(yEntry: Y.Map<unknown>): ElementOverride {
  const result: ElementOverride = {};

  const styles = yEntry.get('styles') as Y.Map<string> | undefined;
  if (styles && styles.size > 0) {
    result.styles = Object.fromEntries(styles.entries());
  }

  const classes = yEntry.get('classes') as Y.Map<Y.Array<string>> | undefined;
  if (classes && classes.size > 0) {
    const classData: ClassData = emptyClassData();
    classes.forEach((arr, bp) => {
      if (bp in classData) {
        classData[bp as keyof ClassData] = arr.toArray();
      }
    });
    result.classes = classData;
  }

  const content = yEntry.get('content') as Y.Map<unknown> | undefined;
  if (content) {
    result.content = {
      type: content.get('type') as 'text' | 'markup',
      value: content.get('value') as string,
    };
  }

  const href = yEntry.get('href') as Y.Map<unknown> | undefined;
  if (href) {
    result.href = {
      href: href.get('href') as string,
      target: href.get('target') as '_blank' | '_self' | undefined,
    };
  }

  return result;
}

/**
 * Set a field on a Y.Map override entry
 */
function setOverrideField(
  yEntry: Y.Map<unknown>,
  field: keyof ElementOverride,
  value: ElementOverride[keyof ElementOverride]
): void {
  if (value === undefined) {
    yEntry.delete(field);
    return;
  }

  switch (field) {
    case 'styles': {
      let yStyles = yEntry.get('styles') as Y.Map<string> | undefined;
      if (!yStyles) {
        yStyles = new Y.Map();
        yEntry.set('styles', yStyles);
      }
      // Clear and set new values
      yStyles.forEach((_, k) => yStyles!.delete(k));
      Object.entries(value as Record<string, string>).forEach(([k, v]) => {
        yStyles!.set(k, v);
      });
      break;
    }

    case 'classes': {
      let yClasses = yEntry.get('classes') as Y.Map<Y.Array<string>> | undefined;
      if (!yClasses) {
        yClasses = new Y.Map();
        yEntry.set('classes', yClasses);
      }
      const classData = value as ClassData;
      Object.entries(classData).forEach(([bp, tokens]) => {
        let arr = yClasses!.get(bp) as Y.Array<string> | undefined;
        if (!arr) {
          arr = new Y.Array();
          yClasses!.set(bp, arr);
        }
        arr.delete(0, arr.length);
        arr.push(tokens);
      });
      break;
    }

    case 'content': {
      const contentValue = value as ElementOverride['content'];
      let yContent = yEntry.get('content') as Y.Map<unknown> | undefined;
      if (!yContent) {
        yContent = new Y.Map();
        yEntry.set('content', yContent);
      }
      yContent.set('type', contentValue!.type);
      yContent.set('value', contentValue!.value);
      break;
    }

    case 'href': {
      const hrefValue = value as ElementOverride['href'];
      let yHref = yEntry.get('href') as Y.Map<unknown> | undefined;
      if (!yHref) {
        yHref = new Y.Map();
        yEntry.set('href', yHref);
      }
      yHref.set('href', hrefValue!.href);
      if (hrefValue!.target) {
        yHref.set('target', hrefValue!.target);
      } else {
        yHref.delete('target');
      }
      break;
    }
  }
}

/**
 * Create an override API for a Y.Map
 */
export function createOverrideAPI(overrideMap: Y.Map<unknown>): OverrideAPI {
  return {
    getOverride(selector: string): ElementOverride | undefined {
      const yEntry = overrideMap.get(selector) as Y.Map<unknown> | undefined;
      if (!yEntry || yEntry.size === 0) return undefined;
      return yMapToOverride(yEntry);
    },

    setOverride(selector: string, override: Partial<ElementOverride>): void {
      let yEntry = overrideMap.get(selector) as Y.Map<unknown> | undefined;
      if (!yEntry) {
        yEntry = new Y.Map();
        overrideMap.set(selector, yEntry);
      }

      // Set each provided field
      const fields: (keyof ElementOverride)[] = ['styles', 'classes', 'content', 'href'];
      for (const field of fields) {
        if (field in override) {
          setOverrideField(yEntry, field, override[field]);
        }
      }
    },

    clearOverride(selector: string, types?: OverrideType[]): void {
      if (!types) {
        // Clear entire entry
        overrideMap.delete(selector);
        return;
      }

      const yEntry = overrideMap.get(selector) as Y.Map<unknown> | undefined;
      if (!yEntry) return;

      // Clear specific types
      for (const type of types) {
        yEntry.delete(type);
      }

      // Remove entry if empty
      if (yEntry.size === 0) {
        overrideMap.delete(selector);
      }
    },

    hasOverride(selector: string, types?: OverrideType[]): boolean {
      const yEntry = overrideMap.get(selector) as Y.Map<unknown> | undefined;
      if (!yEntry) return false;

      if (!types) {
        return yEntry.size > 0;
      }

      return types.some(type => yEntry.has(type));
    },

    setContent(selector: string, value: string, type: 'text' | 'markup'): void {
      this.setOverride(selector, { content: { type, value } });
    },

    setHref(selector: string, href: string, target?: '_blank' | '_self'): void {
      this.setOverride(selector, { href: { href, target } });
    },

    getAllSelectors(): string[] {
      const selectors: string[] = [];
      overrideMap.forEach((_, key) => selectors.push(key));
      return selectors;
    },

    isEmpty(): boolean {
      return overrideMap.size === 0;
    },

    resetAll(): void {
      // Collect keys first to avoid modifying map while iterating
      const keys = [...overrideMap.keys()];
      keys.forEach(key => overrideMap.delete(key));
    },

    getSnapshot(): SerializedOverrides {
      const entries: Record<string, ElementOverride> = {};

      overrideMap.forEach((value, selector) => {
        const yEntry = value as Y.Map<unknown>;
        entries[selector] = yMapToOverride(yEntry);
      });

      return { version: 2, entries };
    },

    restoreSnapshot(snapshot: SerializedOverrides): void {
      // Clear all existing entries (collect keys first to avoid modifying while iterating)
      const keys = [...overrideMap.keys()];
      keys.forEach(key => overrideMap.delete(key));

      // Restore from snapshot
      for (const [selector, override] of Object.entries(snapshot.entries)) {
        const yEntry = new Y.Map();
        overrideMap.set(selector, yEntry);

        if (override.styles) {
          setOverrideField(yEntry, 'styles', override.styles);
        }
        if (override.classes) {
          setOverrideField(yEntry, 'classes', override.classes);
        }
        if (override.content) {
          setOverrideField(yEntry, 'content', override.content);
        }
        if (override.href) {
          setOverrideField(yEntry, 'href', override.href);
        }
      }
    },
  };
}

/**
 * Get or create an OverrideAPI for an instance element.
 * Returns null if the instance doesn't exist.
 *
 * The override map is stored at instance.unifiedOverrides.
 * This is separate from the legacy maps during migration.
 */
export function getInstanceOverrideAPI(
  elements: Y.Map<unknown>,
  instanceId: string
): OverrideAPI | null {
  const instance = elements.get(instanceId) as Y.Map<unknown> | undefined;
  if (!instance) return null;

  // Get or create the unified override map
  let overrideMap = instance.get('unifiedOverrides') as Y.Map<unknown> | undefined;
  if (!overrideMap) {
    overrideMap = new Y.Map();
    instance.set('unifiedOverrides', overrideMap);
  }

  return createOverrideAPI(overrideMap);
}
