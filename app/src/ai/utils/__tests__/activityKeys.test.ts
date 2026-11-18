/**
 * AI activity keys — complete tool→badge-key mapping.
 *
 * The sparkle badges (Layers, PagesPanel, VariablesTable, canvas overlay) are
 * fed by these extractors. The old switch covered 4 fossil tool names, so
 * fully-AI-created sections (add_page_content — id only exists in the RESULT)
 * never got a badge. Contract:
 *   - element-mutating tools → the element key from args (sourceKey/key/
 *     elementKey/elementId/instanceId/slotKey; parentKey NEVER marks)
 *   - creates → the new id from result.data (elementId/key/instanceId)
 *   - page-object tools → `page:<id>`; variable tools → `variable:<id>`
 *   - read-only tools, verify_layout, undo/redo → null
 */
import { describe, it, expect } from 'vitest';
import { extractAffectedKey, extractTouchedKey } from '../activityKeys';

const ok = (data?: Record<string, unknown>) => ({ success: true, message: 'ok', ...(data ? { data } : {}) });

describe('extractAffectedKey (args-time)', () => {
  it('maps element-key args across mutating tools', () => {
    expect(extractAffectedKey('update_element_by_key', { sourceKey: 'el-1:h2-0' })).toBe('el-1:h2-0');
    expect(extractAffectedKey('delete_element', { elementId: 'el-2' })).toBe('el-2');
    expect(extractAffectedKey('move_element', { elementKey: 'drawn-3', newParentKey: 'el-9', pageId: 'p' })).toBe('drawn-3');
    expect(extractAffectedKey('set_grid_placement', { key: 'el-4:div-0' })).toBe('el-4:div-0');
    expect(extractAffectedKey('make_component', { key: 'el-5:section-0', pageId: 'p' })).toBe('el-5:section-0');
    expect(extractAffectedKey('reset_instance', { instanceId: 'el-6' })).toBe('el-6');
    expect(extractAffectedKey('update_blog_settings', { slotKey: 'el-7', columns: 3 })).toBe('el-7');
    expect(extractAffectedKey('unwrap_link', { elementId: 'el-8' })).toBe('el-8');
  });

  it('elementKey outranks slotKey (bind_content_field marks the bound child)', () => {
    expect(extractAffectedKey('bind_content_field', { slotKey: 'el-7', elementKey: 'el-7:h3-0', fieldName: 'title' })).toBe('el-7:h3-0');
  });

  it('parentKey/parentId never mark the container', () => {
    expect(extractAffectedKey('add_drawn_element', { tag: 'div', parentKey: 'el-parent', pageId: 'p' })).toBeNull();
    expect(extractAffectedKey('add_page_content', { pageId: 'p', parentId: 'el-parent', staticMarkup: '<section/>' })).toBeNull();
    expect(extractAffectedKey('set_child_order', { parentKey: 'el-parent', childKeys: [], pageId: 'p' })).toBeNull();
  });

  it('page-object tools mark the page row', () => {
    expect(extractAffectedKey('update_page', { pageId: 'page-1', name: 'X' })).toBe('page:page-1');
    expect(extractAffectedKey('remove_page', { pageId: 'page-1' })).toBe('page:page-1');
    expect(extractAffectedKey('set_home_page', { pageId: 'page-1' })).toBe('page:page-1');
    expect(extractAffectedKey('apply_layout', { pageId: 'page-1', layoutName: 'Main' })).toBe('page:page-1');
    expect(extractAffectedKey('add_page', { page: { id: 'page-2', name: 'About' } })).toBe('page:page-2');
  });

  it('element tools do NOT badge their context page', () => {
    expect(extractAffectedKey('reorder_page_elements', { pageId: 'page-1', elementIds: ['a'] })).toBeNull();
    expect(extractAffectedKey('place_component_instance', { pageId: 'page-1', componentPath: 'Hero.astro' })).toBeNull();
  });

  it('variable tools mark variable rows', () => {
    expect(extractAffectedKey('update_variable_value', { collectionId: 'c', variableId: 'v1', modeId: 'm' })).toBe('variable:v1');
    expect(extractAffectedKey('rename_variable', { collectionId: 'c', variableId: 'v2', name: 'x' })).toBe('variable:v2');
  });

  it('read-only tools, verify_layout, undo/redo, posts and project ops mark nothing', () => {
    expect(extractAffectedKey('read_element_html', { sourceKey: 'el-1:h2-0' })).toBeNull();
    expect(extractAffectedKey('read_component_content', { elementId: 'el-2' })).toBeNull();
    expect(extractAffectedKey('verify_layout', { keys: ['el-1'] })).toBeNull();
    expect(extractAffectedKey('undo', {})).toBeNull();
    expect(extractAffectedKey('redo', {})).toBeNull();
    expect(extractAffectedKey('create_post', { collectionName: 'posts', slug: 's', frontmatter: {}, body: 'b' })).toBeNull();
    expect(extractAffectedKey('update_post', { collectionName: 'posts', slug: 's' })).toBeNull();
    expect(extractAffectedKey('deploy_project', { provider: 'netlify' })).toBeNull();
    expect(extractAffectedKey('rename_project', { name: 'X' })).toBeNull();
  });
});

describe('extractTouchedKey (result-time — creates)', () => {
  it('add_page_content records the CREATED element id from the result', () => {
    expect(extractTouchedKey('add_page_content', { pageId: 'p' }, ok({ elementId: 'element-123-abc' }))).toBe('element-123-abc');
  });

  it('add_drawn_element records the created drawn key', () => {
    expect(extractTouchedKey('add_drawn_element', { tag: 'div', pageId: 'p' }, ok({ key: 'drawn-9' }))).toBe('drawn-9');
  });

  it('place_component_instance / make_component record the new instance', () => {
    expect(extractTouchedKey('place_component_instance', { pageId: 'p', componentPath: 'H.astro' }, ok({ elementId: 'el-10' }))).toBe('el-10');
    expect(extractTouchedKey('make_component', { key: 'el-5:section-0', pageId: 'p' }, ok({ componentName: 'Hero', instanceId: 'el-11' }))).toBe('el-11');
  });

  it('create_variable records the variable badge key', () => {
    expect(extractTouchedKey('create_variable', { collectionId: 'c', name: 'x', type: 'color' }, ok({ variableId: 'v9' }))).toBe('variable:v9');
  });

  it('falls back to the args key when the result has no id', () => {
    expect(extractTouchedKey('update_element_by_key', { sourceKey: 'el-1:h2-0' }, ok())).toBe('el-1:h2-0');
  });

  it('non-element result ids are not mistaken for element keys', () => {
    expect(extractTouchedKey('create_collection', { name: 'posts', type: 'blog' }, ok({ collectionId: 'c1' }))).toBeNull();
    expect(extractTouchedKey('deploy_project', { provider: 'netlify' }, ok({ url: 'https://x' }))).toBeNull();
    expect(extractTouchedKey('add_variable_mode', { collectionId: 'c', name: 'dark' }, ok({ modeId: 'm1' }))).toBeNull();
  });
});
