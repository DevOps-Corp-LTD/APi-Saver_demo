import { Search, Filter, X, ChevronDown, ChevronUp } from 'lucide-react';
import DateRangePicker from './DateRangePicker';
import FilterChips from './FilterChips';

export default function CacheFilters({
  searchQuery,
  onSearchChange,
  showExpired,
  onExpiredChange,
  poolFilter,
  selectedPoolId,
  poolsData,
  onPoolChange,
  selectedSourceId,
  sourcesData,
  onSourceChange,
  advancedFilters,
  onAdvancedFiltersChange,
  showAdvancedFilters,
  onToggleAdvancedFilters,
  onClearFilters,
}) {
  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder="Search by URL, method, status..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="input pl-10 w-full"
            />
          </div>
        </div>

        {/* Expired filter */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="showExpired"
            checked={showExpired}
            onChange={(e) => onExpiredChange(e.target.checked)}
            className="w-4 h-4 rounded border-[var(--color-border)] text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="showExpired" className="text-sm text-[var(--color-text)]">
            Include expired
          </label>
        </div>

        {/* Pool filter - Only show when not filtered to a specific pool */}
        {!poolFilter && (
          <div className="flex items-center gap-2">
            <label htmlFor="poolFilter" className="text-sm text-[var(--color-text)]">
              Pool:
            </label>
            <select
              id="poolFilter"
              value={selectedPoolId}
              onChange={(e) => onPoolChange(e.target.value)}
              className="input text-sm"
            >
              <option value="">All</option>
              {poolsData?.pools?.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name} {pool.cache_entry_count > 0 ? `(${pool.cache_entry_count})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Source filter */}
        {sourcesData && (
          <div className="flex items-center gap-2">
            <label htmlFor="sourceFilter" className="text-sm text-[var(--color-text)]">
              Source:
            </label>
            <select
              id="sourceFilter"
              value={selectedSourceId || ''}
              onChange={(e) => onSourceChange(e.target.value)}
              className="input text-sm"
            >
              <option value="">All</option>
              {sourcesData?.sources?.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Advanced filters toggle */}
        <button
          onClick={onToggleAdvancedFilters}
          className={`btn-secondary flex items-center gap-2 ${showAdvancedFilters ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
        >
          <Filter className="w-4 h-4" />
          <span>Filters</span>
        </button>

        {/* Clear filters */}
        {(searchQuery || showExpired || selectedPoolId || Object.values(advancedFilters).some(v => v !== null && v !== '' && (Array.isArray(v) ? v.length > 0 : true))) && (
          <button
            onClick={onClearFilters}
            className="btn-secondary flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Advanced Filters */}
      {showAdvancedFilters && (
        <div className="border-t border-[var(--color-border)] pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Status Code */}
            <div>
              <label className="label">Status Code</label>
              <input
                type="text"
                value={advancedFilters.statusCode || ''}
                onChange={(e) => onAdvancedFiltersChange({ ...advancedFilters, statusCode: e.target.value })}
                className="input"
                placeholder="200 or 200-299"
              />
            </div>

            {/* HTTP Method */}
            <div>
              <label className="label">HTTP Method</label>
              <div className="flex flex-wrap gap-2">
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                  <label key={method} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={advancedFilters.method?.includes(method) || false}
                      onChange={(e) => {
                        const currentMethods = advancedFilters.method || [];
                        const newMethods = e.target.checked
                          ? [...currentMethods, method]
                          : currentMethods.filter(m => m !== method);
                        onAdvancedFiltersChange({ ...advancedFilters, method: newMethods });
                      }}
                      className="w-4 h-4 rounded border-[var(--color-border)] text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm">{method}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Content Type */}
            <div>
              <label className="label">Content Type</label>
              <input
                type="text"
                value={advancedFilters.contentType || ''}
                onChange={(e) => onAdvancedFiltersChange({ ...advancedFilters, contentType: e.target.value })}
                className="input"
                placeholder="application/json"
              />
            </div>

            {/* Hit Count Range */}
            <div>
              <label className="label">Min Hits</label>
              <input
                type="number"
                value={advancedFilters.hitCountMin || ''}
                onChange={(e) => onAdvancedFiltersChange({ ...advancedFilters, hitCountMin: e.target.value })}
                className="input"
                placeholder="0"
                min="0"
              />
            </div>
            <div>
              <label className="label">Max Hits</label>
              <input
                type="number"
                value={advancedFilters.hitCountMax || ''}
                onChange={(e) => onAdvancedFiltersChange({ ...advancedFilters, hitCountMax: e.target.value })}
                className="input"
                placeholder="1000"
                min="0"
              />
            </div>

            {/* Date Range */}
            <div>
              <label className="label">Date Range</label>
              <DateRangePicker
                startDate={advancedFilters.dateRange?.start || null}
                endDate={advancedFilters.dateRange?.end || null}
                onChange={(start, end) => onAdvancedFiltersChange({ 
                  ...advancedFilters, 
                  dateRange: { start, end } 
                })}
              />
            </div>
          </div>

          {/* Active Filter Chips */}
          <FilterChips
            filters={advancedFilters}
            onRemoveFilter={(key) => {
              const newFilters = { ...advancedFilters };
              if (key === 'dateRange') {
                newFilters.dateRange = { start: null, end: null };
              } else {
                newFilters[key] = null;
              }
              onAdvancedFiltersChange(newFilters);
            }}
          />
        </div>
      )}
    </div>
  );
}
