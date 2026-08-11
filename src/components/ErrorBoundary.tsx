// 根组件错误边界：单点渲染崩溃不再拖垮全窗口（黑屏兜底）
import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace' }}>
          <h3>Something went wrong / 界面出错了</h3>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#888' }}>
            {String(this.state.error)}
          </pre>
          <button onClick={() => this.setState({ error: null })}>Retry / 重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}
