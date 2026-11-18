import { describe, it, expect } from 'vitest';
import { activityIconKind, formatActivitiesForModel } from '../activityFeed';
import { finalizeActivities, resolveActivity } from '../../hooks/useAIAgent';
import type { AIActivity } from '../../types';

describe('activityIconKind', () => {
  it('maps tool names to icon categories', () => {
    expect(activityIconKind('read_page_content')).toBe('read');
    expect(activityIconKind('verify_layout')).toBe('read');
    expect(activityIconKind('update_element_by_key')).toBe('edit');
    expect(activityIconKind('delete_element')).toBe('delete');
    expect(activityIconKind('remove_page')).toBe('delete');
    expect(activityIconKind('unbind_blog_slot')).toBe('delete');
    expect(activityIconKind('update_image_attribute')).toBe('image');
    expect(activityIconKind('add_drawn_element')).toBe('shape');
    expect(activityIconKind('apply_layout')).toBe('layout');
    expect(activityIconKind('create_variable')).toBe('variable');
    expect(activityIconKind('create_post')).toBe('blog');
    expect(activityIconKind('bind_content_field')).toBe('blog');
    expect(activityIconKind('make_component')).toBe('component');
    expect(activityIconKind('place_component_instance')).toBe('component');
    expect(activityIconKind('add_page')).toBe('page');
    expect(activityIconKind('deploy_project')).toBe('deploy');
    expect(activityIconKind('undo')).toBe('history');
    expect(activityIconKind('some_unknown_tool')).toBe('edit');
  });
});

describe('formatActivitiesForModel', () => {
  it('re-serializes activities as the blockquoted action log', () => {
    const acts: AIActivity[] = [
      { id: '1', toolName: 'read_page_content', label: 'Reading page elements', detail: '5 elements', status: 'done' },
      { id: '2', toolName: 'update_element_by_key', label: 'Updating classes on X', status: 'done' },
    ];
    expect(formatActivitiesForModel(acts)).toBe(
      '> Reading page elements — 5 elements\n> Updating classes on X'
    );
  });
});

describe('resolveActivity', () => {
  const base: AIActivity[] = [
    { id: '1', toolName: 'read_page_content', label: 'a', status: 'done' },
    { id: '2', toolName: 'update_element_by_key', label: 'b', status: 'running' },
    { id: '3', toolName: 'update_element_by_key', label: 'c', status: 'running' },
  ];

  it('resolves the FIRST running activity for the tool (FIFO)', () => {
    const next = resolveActivity(base, 'update_element_by_key', true, 'done');
    expect(next[1].status).toBe('done');
    expect(next[1].detail).toBe('done');
    expect(next[2].status).toBe('running');
  });

  it('marks failures as error', () => {
    const next = resolveActivity(base, 'update_element_by_key', false, 'failed: nope');
    expect(next[1].status).toBe('error');
  });

  it('no-ops when no running activity matches', () => {
    expect(resolveActivity(base, 'delete_element', true, '')).toBe(base);
  });

  it('drops empty detail', () => {
    const next = resolveActivity(base, 'update_element_by_key', true, '');
    expect(next[1].detail).toBeUndefined();
  });
});

describe('finalizeActivities', () => {
  it('settles only running activities', () => {
    const acts: AIActivity[] = [
      { id: '1', toolName: 't', label: 'a', status: 'error' },
      { id: '2', toolName: 't', label: 'b', status: 'running' },
    ];
    const next = finalizeActivities(acts, 'done');
    expect(next[0].status).toBe('error');
    expect(next[1].status).toBe('done');
  });
});
