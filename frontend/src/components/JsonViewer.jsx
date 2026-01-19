/**
 * Simple JSON viewer component with syntax highlighting
 */
export default function JsonViewer({ data, className = '' }) {
  // Handle null, undefined, and empty string cases
  if (data === null || data === undefined) {
    return (
      <pre className={`text-xs font-mono overflow-auto ${className}`}>
        <code className="text-[var(--color-text-muted)]">null</code>
      </pre>
    );
  }

  // Handle empty string
  if (typeof data === 'string' && data.trim() === '') {
    return (
      <pre className={`text-xs font-mono overflow-auto ${className}`}>
        <code className="text-[var(--color-text-muted)]">(empty string)</code>
      </pre>
    );
  }

  const formatJson = (obj) => {
    try {
      // If it's already a string, try to parse it first
      if (typeof obj === 'string') {
        try {
          const parsed = JSON.parse(obj);
          return JSON.stringify(parsed, null, 2);
        } catch {
          // If parsing fails, return the string as-is
          return obj;
        }
      }
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  const jsonString = formatJson(data);

  return (
    <pre className={`text-xs font-mono overflow-auto ${className}`}>
      <code className="json-viewer">{jsonString}</code>
    </pre>
  );
}
