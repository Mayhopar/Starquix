// app/src/components/Canvas/DropIndicator.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DropIndicator } from './DropIndicator';

describe('DropIndicator', () => {
  it('renders nothing when not active', () => {
    const { container } = render(
      <DropIndicator
        isVisible={false}
        top={100}
        scale={1}
        viewportFrameLeft={200}
        viewportFrameTop={50}
        viewportWidth={800}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders indicator line when visible', () => {
    render(
      <DropIndicator
        isVisible={true}
        top={100}
        scale={1}
        viewportFrameLeft={200}
        viewportFrameTop={50}
        viewportWidth={800}
      />
    );

    expect(screen.getByTestId('drop-indicator')).toBeInTheDocument();
  });

  it('positions indicator based on viewport frame position and scale', () => {
    render(
      <DropIndicator
        isVisible={true}
        top={100}
        scale={0.5}
        viewportFrameLeft={200}
        viewportFrameTop={50}
        viewportWidth={800}
      />
    );

    const indicator = screen.getByTestId('drop-indicator');
    // lineTop = viewportFrameTop + top * scale = 50 + 100 * 0.5 = 100
    expect(indicator).toHaveStyle({ top: '100px' });
    // lineLeft = viewportFrameLeft = 200
    expect(indicator).toHaveStyle({ left: '200px' });
    // lineWidth = viewportWidth * scale = 800 * 0.5 = 400
    expect(indicator).toHaveStyle({ width: '400px' });
  });
});
