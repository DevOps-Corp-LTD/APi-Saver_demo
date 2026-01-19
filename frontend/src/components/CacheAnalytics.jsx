import { Loader2 } from 'lucide-react';
import { HitRateChart, StatusCodeChart, TopUrlsChart, CacheSizeTrendChart, SourceContributionChart } from './AnalyticsChart';

export default function CacheAnalytics({ 
  analyticsData, 
  analyticsLoading, 
  analyticsTimeRange, 
  onTimeRangeChange 
}) {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-[var(--color-text)]">Analytics Dashboard</h2>
          <select
            value={analyticsTimeRange}
            onChange={(e) => onTimeRangeChange(e.target.value)}
            className="input text-sm"
          >
            <option value="1h">Last Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
        </div>
        
        {analyticsLoading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : analyticsData ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Hit Rate Over Time */}
            {analyticsData.hit_rate && analyticsData.hit_rate.length > 0 && (
              <div>
                <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">Hit Rate Over Time</h3>
                <HitRateChart data={analyticsData.hit_rate} />
              </div>
            )}

            {/* Status Code Distribution */}
            {analyticsData.status_distribution && analyticsData.status_distribution.length > 0 && (
              <div>
                <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">Status Code Distribution</h3>
                <StatusCodeChart data={analyticsData.status_distribution.map(s => ({ name: s.status, value: s.value }))} />
              </div>
            )}

            {/* Top URLs */}
            {analyticsData.top_urls && analyticsData.top_urls.length > 0 && (
              <div>
                <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">Top URLs by Hits</h3>
                <TopUrlsChart data={analyticsData.top_urls.map(u => ({ url: u.url.substring(0, 50), hits: u.hits }))} />
              </div>
            )}

            {/* Cache Size Trend */}
            {analyticsData.size_trend && analyticsData.size_trend.length > 0 && (
              <div>
                <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">Cache Size Trend</h3>
                <CacheSizeTrendChart data={analyticsData.size_trend.map(s => ({ time: s.time, size: s.size }))} />
              </div>
            )}

            {/* Source Contribution */}
            {analyticsData.source_contribution && analyticsData.source_contribution.length > 0 && (
              <div className="lg:col-span-2">
                <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">Source Contribution</h3>
                <SourceContributionChart data={analyticsData.source_contribution} />
              </div>
            )}
          </div>
        ) : (
          <div className="text-center p-12 text-[var(--color-text-muted)]">
            No analytics data available
          </div>
        )}
      </div>
    </div>
  );
}
