/**
 * Regression test — layers-panel rows show the instance name ONLY on the
 * instance root row. Instance children (the keyed `<section>`, `<div>`,
 * `<slot>`, `<h2>`, `<img>` pieces of an instance's static markup) show
 * their own tag name.
 *
 * Before fix: `componentTypeById[node.elementId]` was looked up for every
 * row. Since every keyed child of an instance shares the instance's
 * elementId (data-key prefix), they all inherited the parent's
 * componentType label — producing "BlogSlot → BlogSlot → BlogSlot →
 * BlogCard → BlogCard …" ladders for a single BlogSlot/BlogCard pair.
 */
import { describe, it, expect } from 'vitest';
import { resolveLayerLabel } from '../resolveLabel';

const componentTypeById: Record<string, string> = {
  'el-slot': 'BlogSlot',
  'el-card': 'BlogCard',
  'el-post': 'BlogPost',
};

const noPostRoots = new Set<string>();
const noPostLabels: Record<string, string> = {};

function call(
  nodeKey: string,
  nodeElementId: string,
  nodeDisplayName: string,
  nodeComponentName: string | undefined = undefined,
) {
  return resolveLayerLabel({
    nodeKey,
    nodeElementId,
    nodeDisplayName,
    nodeComponentName,
    componentTypeById,
    postRootKeys: noPostRoots,
    postRootLabels: noPostLabels,
    blogCardComponentName: 'BlogCard',
  });
}

describe('resolveLayerLabel — component name only on instance root', () => {
  it('instance root shows componentType', () => {
    expect(call('el-slot', 'el-slot', 'section').displayLabel).toBe('BlogSlot');
    expect(call('el-card', 'el-card', 'article').displayLabel).toBe('BlogCard');
  });

  it('instance children show their own tag name, not the parent componentType', () => {
    // BlogSlot's internal markup: section, div wrapper, named slot
    expect(call('el-slot:section-0', 'el-slot', 'section').displayLabel).toBe('section');
    expect(call('el-slot:div-0', 'el-slot', 'div').displayLabel).toBe('div');
    expect(call('el-slot:slot-0', 'el-slot', 'slot').displayLabel).toBe('slot');
    // BlogCard's internal markup: heading, image, time
    expect(call('el-card:h2-0', 'el-card', 'h2').displayLabel).toBe('h2');
    expect(call('el-card:img-0', 'el-card', 'img').displayLabel).toBe('img');
    expect(call('el-card:time-0', 'el-card', 'time').displayLabel).toBe('time');
  });

  it('isInstanceRoot flag is true only for the root row', () => {
    expect(call('el-slot', 'el-slot', 'section').isInstanceRoot).toBe(true);
    expect(call('el-slot:div-0', 'el-slot', 'div').isInstanceRoot).toBe(false);
    expect(call('el-card', 'el-card', 'article').isInstanceRoot).toBe(true);
    expect(call('el-card:h2-0', 'el-card', 'h2').isInstanceRoot).toBe(false);
  });

  it('post-root rows still show BlogCard label (clone path)', () => {
    const postRoots = new Set(['post-2', 'post-3']);
    const postLabels: Record<string, string> = { 'post-2': 'BlogCard', 'post-3': 'BlogCard' };
    const out = resolveLayerLabel({
      nodeKey: 'post-2',
      nodeElementId: 'post-2',
      nodeDisplayName: 'article',
      nodeComponentName: undefined,
      componentTypeById: {},
      postRootKeys: postRoots,
      postRootLabels: postLabels,
      blogCardComponentName: 'BlogCard',
    });
    expect(out.displayLabel).toBe('BlogCard');
  });

  it('bridge-provided componentName overrides tag name on non-root rows', () => {
    // Filled drawn-slot first child surfaces with componentName set by the
    // bridge — preserve that signal (it predates the instance-root rule).
    expect(call('drawn-1:article-0', 'drawn-1', 'article', 'FeatureCard').displayLabel).toBe('FeatureCard');
  });

  it('falls back to displayName when no componentType, componentName, or post-root match', () => {
    // Plain HTML node not part of any component instance.
    expect(call('plain-1', 'plain-1', 'p').displayLabel).toBe('p');
  });
});


describe('mother-entity rows label as their instance (C4 labeling, 2026-08-26)', () => {
  // The inserted BlogPost renders its markup ROOT — an outermost <Layout>
  // tag — as the instance's one visible row. Labeling it by tag showed a
  // bare "layout" row in page Layers, inviting confusion with the actual
  // Layout chrome node. The mother-entity row (already the row the dynamic
  // color treats as the instance) displays the componentType.
  it("the instance's rendered ROOT row shows componentType", () => {
    const r = resolveLayerLabel({
      nodeKey: 'el-post:layout-0',
      nodeElementId: 'el-post',
      nodeDisplayName: 'layout',
      nodeComponentName: undefined,
      componentTypeById,
      postRootKeys: noPostRoots,
      postRootLabels: noPostLabels,
      blogCardComponentName: 'BlogCard',
      isMotherEntity: true,
    });
    expect(r.displayLabel).toBe('BlogPost');
  });

  it('non-mother instance children keep their tag name', () => {
    const r = resolveLayerLabel({
      nodeKey: 'el-post:section-0',
      nodeElementId: 'el-post',
      nodeDisplayName: 'section',
      nodeComponentName: undefined,
      componentTypeById,
      postRootKeys: noPostRoots,
      postRootLabels: noPostLabels,
      blogCardComponentName: 'BlogCard',
      isMotherEntity: false,
    });
    expect(r.displayLabel).toBe('section');
  });
});

describe('layout-chrome rows never take the mother-entity label', () => {
  it('a chrome slot row keeps its tag even when flagged mother entity upstream', () => {
    // ElementsTree guards this by never passing isMotherEntity for
    // layoutchrome-* elementIds; this pins the resolver contract with it off.
    const r = resolveLayerLabel({
      nodeKey: 'layoutchrome-p1:slot-0',
      nodeElementId: 'layoutchrome-p1',
      nodeDisplayName: 'slot',
      nodeComponentName: undefined,
      componentTypeById: { 'layoutchrome-p1': 'Layout1' },
      postRootKeys: noPostRoots,
      postRootLabels: noPostLabels,
      blogCardComponentName: 'BlogCard',
      isMotherEntity: false,
    });
    expect(r.displayLabel).toBe('slot');
  });
});

describe('a slot never wears the owner component name (2026-08-27)', () => {
  // In a layout master the <slot> is a mother-entity child, so it took the
  // layout's componentType and the panel read "Layout ▸ Layout" — a level that
  // does not exist in the .astro, where <slot /> is a plain child of the body.
  const base = {
    nodeElementId: 'el-1',
    nodeComponentName: undefined,
    componentTypeById: { 'el-1': 'Layout1' },
    postRootKeys: new Set<string>(),
    postRootLabels: {},
    blogCardComponentName: 'BlogCard',
  };

  it('labels a mother-entity slot child "slot"', () => {
    const r = resolveLayerLabel({
      ...base, nodeKey: 'el-1:slot-0', nodeDisplayName: 'slot', nodeTagName: 'slot', isMotherEntity: true,
    });
    expect(r.displayLabel).toBe('slot');
  });

  it('still labels a non-slot mother-entity row with the component name', () => {
    const r = resolveLayerLabel({
      ...base, nodeKey: 'el-1:section-0', nodeDisplayName: 'section', nodeTagName: 'section', isMotherEntity: true,
    });
    expect(r.displayLabel).toBe('Layout1');
  });
});
