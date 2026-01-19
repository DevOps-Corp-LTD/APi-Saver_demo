import { X } from 'lucide-react';

export default function FilterChips({ filters, onRemove, onClearAll }) {
  if (!filters || Object.keys(filters).length === 0) return null;

  const filterEntries = Object.entries(filters).filter(([_, value]) => {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (typeof value === 'object') {
      // Check if it's a date range object
      if (value.start !== undefined || value.end !== undefined) {
        return !!(value.start || value.end);
      }
      // Otherwise check if object has any keys
      return Object.keys(value).length > 0;
    }
    return true;
  });

  if (filterEntries.length === 0) return null;

  const formatValue = (key, value) => {
    if (Array.isArray(value)) {
      return value.length > 2 ? `${value.length} items` : value.join(', ');
    }
    if (typeof value === 'object' && (value.start !== undefined || value.end !== undefined)) {
      if (value.start && value.end) {
        return `${value.start} - ${value.end}`;
      } else if (value.start) {
        return `From ${value.start}`;
      } else if (value.end) {
        return `Until ${value.end}`;
      }
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    return String(value);
  };

  const formatLabel = (key) => {
    const labels = {
      search: 'Search',
      source_id: 'Source',
      storage_pool_id: 'Pool',
      status_code: 'Status',
      method: 'Method',
      content_type: 'Content Type',
      date_range: 'Date Range',
      hit_count_min: 'Min Hits',
      hit_count_max: 'Max Hits',
      expired: 'Expired',
    };
    return labels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filterEntries.map(([key, value]) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm"
        >
          <span className="font-medium">{formatLabel(key)}:</span>
          <span>{formatValue(key, value)}</span>
          {onRemove && (
            <button
              onClick={() => onRemove(key)}
              className="ml-1 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      {onClearAll && filterEntries.length > 1 && (
        <button
          onClick={onClearAll}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

