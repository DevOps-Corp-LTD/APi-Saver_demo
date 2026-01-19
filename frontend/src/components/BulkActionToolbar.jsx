import { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2, Calendar, Download, Loader2, X } from 'lucide-react';

export default function BulkActionToolbar({
  selectedCount,
  onInvalidate,
  onUpdateTTL,
  onExport,
  onClear,
  isProcessing = false,
}) {
  const [showTTLInput, setShowTTLInput] = useState(false);
  const [ttlValue, setTtlValue] = useState('3600');
  const [customTtlValue, setCustomTtlValue] = useState('');
  const formRef = useRef(null);

  const handleTTLCancel = useCallback(() => {
    setShowTTLInput(false);
    setTtlValue('3600');
    setCustomTtlValue('');
  }, []);

  // Close TTL input when clicking outside
  useEffect(() => {
    if (!showTTLInput) return;
    
    const handleClickOutside = (event) => {
      if (formRef.current && !formRef.current.contains(event.target)) {
        handleTTLCancel();
      }
    };
    
    // Add a small delay to avoid immediate close on button click
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTTLInput, handleTTLCancel]);

  if (selectedCount === 0) return null;

  const handleTTLSubmit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    let ttl;
    if (ttlValue === 'custom') {
      if (!customTtlValue || customTtlValue === '') {
        alert('Please enter a TTL value');
        return;
      }
      ttl = parseInt(customTtlValue, 10);
    } else {
      ttl = parseInt(ttlValue, 10);
    }
    if (!isNaN(ttl) && ttl >= 0) {
      onUpdateTTL(ttl);
      setShowTTLInput(false);
      setTtlValue('3600');
      setCustomTtlValue('');
    } else {
      alert('Please enter a valid TTL value (number >= 0)');
    }
  };

  const ttlPresets = [
    { label: '1 Hour', value: 3600 },
    { label: '6 Hours', value: 21600 },
    { label: '24 Hours', value: 86400 },
    { label: '7 Days', value: 604800 },
    { label: '30 Days', value: 2592000 },
    { label: 'Never Expire', value: 0 },
  ];

  return (
    <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[var(--color-text)]">
            {selectedCount} {selectedCount === 1 ? 'entry' : 'entries'} selected
          </span>
          <button
            onClick={onClear}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Clear selection
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {showTTLInput ? (
            <form 
              ref={formRef}
              onSubmit={handleTTLSubmit} 
              className="flex items-center gap-2" 
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="relative">
                <select
                  value={ttlValue}
                  onChange={(e) => {
                    setTtlValue(e.target.value);
                    if (e.target.value !== 'custom') {
                      setCustomTtlValue('');
                    }
                  }}
                  className="input text-sm pr-20"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      handleTTLCancel();
                    } else if (e.key === 'Enter' && ttlValue !== 'custom') {
                      e.preventDefault();
                      handleTTLSubmit(e);
                    }
                  }}
                >
                  {ttlPresets.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="custom">Custom...</option>
                </select>
              </div>
              {ttlValue === 'custom' && (
                <input
                  type="number"
                  min="0"
                  placeholder="Seconds"
                  value={customTtlValue}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || (!isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 0)) {
                      setCustomTtlValue(val);
                    }
                  }}
                  className="input text-sm w-32"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleTTLSubmit(e);
                    } else if (e.key === 'Escape') {
                      handleTTLCancel();
                    }
                  }}
                />
              )}
              <button
                type="submit"
                className="btn-primary text-sm"
                disabled={isProcessing || (ttlValue === 'custom' && (!customTtlValue || customTtlValue === ''))}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin inline mr-1" />
                    Updating...
                  </>
                ) : (
                  'Update'
                )}
              </button>
              <button
                type="button"
                onClick={handleTTLCancel}
                className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg"
                disabled={isProcessing}
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <>
              <button
                onClick={() => {
                  setShowTTLInput(true);
                  setTtlValue('3600');
                  setCustomTtlValue('');
                }}
                className="btn-secondary flex items-center gap-2 text-sm"
                disabled={isProcessing}
              >
                <Calendar className="w-4 h-4" />
                <span>Update TTL</span>
              </button>
              <button
                onClick={onInvalidate}
                className="btn-danger flex items-center gap-2 text-sm"
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>Invalidate</span>
              </button>
              <button
                onClick={onExport}
                className="btn-secondary flex items-center gap-2 text-sm"
                disabled={isProcessing}
              >
                <Download className="w-4 h-4" />
                <span>Export</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

