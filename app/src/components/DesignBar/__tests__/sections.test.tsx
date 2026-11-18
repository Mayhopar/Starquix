/** Section headers are kit Rows: the row click toggles, the +/– button adds/removes, and one click fires one handler. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OptionalSection, EffectsSection } from '../sections';

describe('section headers', () => {
  it('OptionalSection: title click adds + opens, +/– button adds then removes, each click fires once', () => {
    const onAdd = vi.fn(); const onRemove = vi.fn();
    render(<OptionalSection title="Fill" hasClasses={false} onAdd={onAdd} onRemove={onRemove}><div>body</div></OptionalSection>);
    fireEvent.click(screen.getByText('Fill'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByText('body')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove fill' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('body')).toBeNull();
  });

  it('EffectsSection: title click and + click each call onAdd once', () => {
    const onAdd = vi.fn();
    render(<EffectsSection title="Effects" hasEffects={false} onAdd={onAdd}><div /></EffectsSection>);
    fireEvent.click(screen.getByText('Effects'));
    fireEvent.click(screen.getByTitle('Add effect'));
    expect(onAdd).toHaveBeenCalledTimes(2);
  });
});
