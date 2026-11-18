import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SortableTreeProvider, useTreeNodeDnd } from '../SortableTree';

let seen: ReturnType<typeof useTreeNodeDnd> | null = null;
function Node({ disabled }: { disabled?: Parameters<typeof useTreeNodeDnd>[2] }) {
  seen = useTreeNodeDnd('n1', 't', disabled);
  return <div ref={seen.setNodeRef}>n1</div>;
}
const tree = (disabled?: Parameters<typeof useTreeNodeDnd>[2]) => (
  <SortableTreeProvider items={[{ id: 'n1', children: [] }]} rootIds={['n1']} dragType="t" onMove={() => {}}>
    <Node disabled={disabled} />
  </SortableTreeProvider>
);

describe('useTreeNodeDnd', () => {
  it('a normal node can be dragged', () => {
    render(tree());
    expect(seen!.listeners).toBeTruthy();
  });
  it('{ draggable: true } = a drop target that cannot move (virtual folders)', () => {
    render(tree({ draggable: true }));
    expect(seen!.listeners).toBeFalsy();
    expect(seen!.attributes['aria-disabled']).toBe(true);
  });
});
