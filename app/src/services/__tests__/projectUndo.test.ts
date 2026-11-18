import { beforeEach, expect, it } from 'vitest';
import { projectUndo, _resetProjectUndoForTests, type DeletedProject } from '../projectUndo';

const entry = (id: string) => ({ id, name: id }) as DeletedProject;
beforeEach(() => _resetProjectUndoForTests());

it('keeps the last 10 deletions (a project can be MBs); older ones become permanent', () => {
  for (let i = 0; i < 12; i++) projectUndo.deleted(entry(`p${i}`));
  const order: string[] = [];
  for (let next = projectUndo.nextUndo(); next; next = projectUndo.nextUndo()) { order.push(next.id); projectUndo.restored(next); }
  expect(order).toEqual(['p11', 'p10', 'p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3', 'p2']);
});

it('⇧⌘Z re-deletes in reverse restore order; a fresh delete forgets it, a redo does not', () => {
  const a = entry('a'), b = entry('b');
  projectUndo.deleted(a); projectUndo.deleted(b);
  projectUndo.restored(b); projectUndo.restored(a);
  expect(projectUndo.nextRedo()).toBe(a);
  projectUndo.redoing(a); projectUndo.deleted(entry('a'), true);
  expect(projectUndo.nextRedo()).toBe(b); // the redo kept the rest
  projectUndo.deleted(entry('c'));
  expect(projectUndo.nextRedo()).toBeUndefined(); // a fresh delete forgets it
});
