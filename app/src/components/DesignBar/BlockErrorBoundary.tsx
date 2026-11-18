/**
 * BlockErrorBoundary
 *
 * Catches errors in individual DesignBar blocks so one broken block
 * doesn't crash the entire DesignBar.
 *
 * Pass a `resetKey` prop (e.g., selected element key) to automatically
 * reset the error state when the key changes.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { OperationNotice } from '@/components/ui';

interface Props {
  children: ReactNode;
  blockName: string;
  /** When this key changes, the error state resets */
  resetKey?: string | null;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class BlockErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Design controls failed:', this.props.blockName, error, info);
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when resetKey changes (e.g., different element selected)
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return <OperationNotice title="These controls are unavailable." />;
    }

    return this.props.children;
  }
}
