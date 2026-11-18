import type { EditorCommand, ElementData } from './types';
import { emptyClassData } from './types';
import {
  isThemeComponentTemplate,
  type ScannedComponent,
  type ThemeComponentTemplate,
} from '@/components/ComponentPickerModal';

/**
 * Build the right ADD command for a picker selection. Theme templates emit
 * `ADD_THEME_INSTANCE`; everything else is a local `ADD_ELEMENT` rooted in
 * `astroSource`. Centralized so picker-style call sites (Editor, LeftSidebar)
 * don't each re-implement the discriminator.
 *
 * If the component declares `@default-children` (see component-discovery.ts),
 * `resolveComponent` is called for each child name to look up its full
 * ScannedComponent so the children carry valid astroSource + staticMarkup
 * when materialised by the ADD_ELEMENT defaultChildren handler.
 */
export function buildAddCommand(args: {
  elementId: string;
  pageId: string;
  component: ScannedComponent | ThemeComponentTemplate;
  parentId: string | null;
  index: number;
  slotName?: string;
  staticMarkupOverride?: string;
  resolveComponent?: (name: string) => ScannedComponent | undefined;
}): EditorCommand {
  const { elementId, pageId, component, parentId, index, slotName, staticMarkupOverride, resolveComponent } = args;
  if (isThemeComponentTemplate(component)) {
    return {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: elementId, pageId, parentId, index,
        type: 'instance',
        slotName,
        themeId: component.themeId,
        componentPath: component.componentPath,
        classes: emptyClassData(),
        staticMarkup: staticMarkupOverride ?? component.html,
        classOverrides: {},
      },
    };
  }

  const defaultChildren = component.defaultChildren?.length && resolveComponent
    ? component.defaultChildren
        .map((entry): Partial<ElementData> & { componentType: string } | null => {
          const resolved = resolveComponent(entry.name);
          if (!resolved) return null;
          return {
            componentType: resolved.name,
            slotName: entry.slotName,
            astroSource: resolved.path,
            staticMarkup: resolved.html,
            type: 'component',
            instanceType: 'local',
          };
        })
        .filter((c): c is Partial<ElementData> & { componentType: string } => c !== null)
    : undefined;

  return {
    type: 'ADD_ELEMENT',
    element: {
      id: elementId, pageId, parentId, index,
      type: 'component', instanceType: 'local',
      slotName,
      componentType: component.name,
      classes: emptyClassData(),
      staticMarkup: staticMarkupOverride ?? component.html,
      astroSource: component.path,
      classOverrides: {},
      ...(defaultChildren?.length ? { defaultChildren } : {}),
    },
  };
}
