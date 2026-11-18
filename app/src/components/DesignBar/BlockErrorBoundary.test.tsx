import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockErrorBoundary } from './BlockErrorBoundary';
function Broken({ fail }: { fail: boolean }) { if (fail) throw new Error('PRIVATE_COMPILER /Users/private/site'); return <div>Recovered controls</div>; }
describe('BlockErrorBoundary scoped failure', () => {
  it('keeps sibling controls usable and renders finite copy until selection changes', () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const view = render(<><button>Other control</button><BlockErrorBoundary blockName="Layout" resetKey="first"><Broken fail /></BlockErrorBoundary></>);
      expect(screen.getByRole('button', { name: 'Other control' })).toBeEnabled();
      expect(screen.getByText('These controls are unavailable.')).toBeInTheDocument();
      expect(screen.queryByText(/PRIVATE_COMPILER|Users\/private/)).not.toBeInTheDocument();
      view.rerender(<><button>Other control</button><BlockErrorBoundary blockName="Layout" resetKey="first"><Broken fail={false} /></BlockErrorBoundary></>);
      expect(screen.getByText('These controls are unavailable.')).toBeInTheDocument();
      view.rerender(<><button>Other control</button><BlockErrorBoundary blockName="Layout" resetKey="second"><Broken fail={false} /></BlockErrorBoundary></>);
      expect(screen.getByText('Recovered controls')).toBeInTheDocument();
      expect(diagnostic).toHaveBeenCalled();
    } finally { diagnostic.mockRestore(); }
  });
});
