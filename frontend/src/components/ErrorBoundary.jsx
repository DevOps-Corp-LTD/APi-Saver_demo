import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      const { fallback: Fallback } = this.props;
      
      if (Fallback) {
        return <Fallback error={this.state.error} resetError={this.handleReset} />;
      }

      return <DefaultErrorFallback error={this.state.error} resetError={this.handleReset} />;
    }

    return this.props.children;
  }
}

function DefaultErrorFallback({ error, resetError }) {
  const navigate = useNavigate();
  const isDevelopment = import.meta.env.DEV;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--color-surface)]">
      <div className="card max-w-2xl w-full p-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
            <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">Something went wrong</h1>
            <p className="text-[var(--color-text-muted)] mt-1">
              An unexpected error occurred. Please try again.
            </p>
          </div>
        </div>

        {isDevelopment && error && (
          <div className="mb-6 p-4 bg-surface-50 dark:bg-surface-800 rounded-lg border border-[var(--color-border)]">
            <p className="text-sm font-mono text-red-600 dark:text-red-400 break-all">
              {error.toString()}
            </p>
            {error.stack && (
              <details className="mt-2">
                <summary className="text-sm text-[var(--color-text-muted)] cursor-pointer">
                  Stack trace
                </summary>
                <pre className="mt-2 text-xs font-mono text-[var(--color-text-muted)] overflow-auto max-h-64">
                  {error.stack}
                </pre>
              </details>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={resetError}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Try Again</span>
          </button>
          <button
            onClick={() => navigate('/')}
            className="btn-secondary flex items-center gap-2"
          >
            <Home className="w-4 h-4" />
            <span>Go Home</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorBoundary;
