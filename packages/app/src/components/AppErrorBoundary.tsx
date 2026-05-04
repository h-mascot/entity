import React from 'react';

interface AppErrorBoundaryState {
  hasError: boolean;
}

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.error('[App] Render error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Entity encountered an unexpected UI error.</h1>
          <p style={{ marginTop: 10, color: '#666' }}>Refresh the page to recover.</p>
        </div>
      );
    }

    return this.props.children;
  }
}
