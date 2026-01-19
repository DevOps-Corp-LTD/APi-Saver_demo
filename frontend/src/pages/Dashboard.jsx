import { useQuery } from '@tanstack/react-query';
import { metricsApi, sourcesApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Zap,
  Database,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Activity,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

const COLORS = ['#22c55e', '#ef4444', '#f59e0b'];

export default function Dashboard() {
  const { user } = useAuth();
  
  const { data: metrics, isLoading: metricsLoading, error: metricsError } = useQuery({
    queryKey: ['metrics'],
    queryFn: async () => {
      const response = await metricsApi.get();
      return response.data;
    },
    refetchInterval: 30000,
    retry: 2,
  });

  const { data: sourcesData, error: sourcesError } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.list().then((r) => r.data),
    retry: 2,
  });

  if (metricsLoading) {
    return (
      <div className="space-y-6 animate-stagger">
        <div className="h-8 w-48 skeleton" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="stat-card">
              <div className="h-8 w-24 skeleton" />
              <div className="h-5 w-32 skeleton" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const cacheHitRatio = metrics?.requests?.hit_ratio || 0;
  const pieData = [
    { name: 'Hits', value: metrics?.requests?.cache_hits || 0 },
    { name: 'Misses', value: metrics?.requests?.cache_misses || 0 },
    { name: 'Errors', value: metrics?.requests?.errors || 0 },
  ].filter((d) => d.value > 0);

  const circuitBreakerStatuses = Object.entries(metrics?.circuit_breakers || {}).map(
    ([id, data]) => ({
      id,
      state: data.state,
    })
  );

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text)]">Dashboard</h1>
        <p className="text-[var(--color-text-muted)] mt-1">
          Overview of your API caching performance
        </p>
      </div>

      {/* Error states */}
      {metricsError && (
        <div className="card p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <XCircle className="w-5 h-5" />
            <span className="font-medium">Failed to load metrics</span>
          </div>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            {metricsError.message || 'Please try refreshing the page'}
          </p>
        </div>
      )}
      {sourcesError && (
        <div className="card p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
          <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
            <XCircle className="w-5 h-5" />
            <span className="font-medium">Failed to load sources</span>
          </div>
          <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
            {sourcesError.message || 'Some features may be unavailable'}
          </p>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-stagger">
        <StatCard
          icon={Zap}
          label="Total Requests"
          value={metrics?.requests?.total || 0}
          color="primary"
          tooltip="Total requests tracked via circuit breakers (when available) or cache-based calculation. May differ from Cost Savings which uses cache-based only."
        />
        <StatCard
          icon={CheckCircle2}
          label="Cache Hit Ratio"
          value={`${(cacheHitRatio * 100).toFixed(1)}%`}
          trend={cacheHitRatio > 0.7 ? 'up' : 'down'}
          color="accent"
          tooltip="Cache hits / Total requests"
        />
        <StatCard
          icon={Database}
          label="Cached Entries"
          value={metrics?.cache?.active_entries || 0}
          color="primary"
          tooltip="Active cache entries (non-expired). Total entries may be higher if expired entries exist."
        />
        <StatCard
          icon={XCircle}
          label="Errors"
          value={metrics?.requests?.errors || 0}
          color="amber"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hit/Miss pie chart */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Cache Performance
          </h3>
          <div className="h-64">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {pieData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      color: 'var(--color-text)',
                    }}
                    itemStyle={{
                      color: 'var(--color-text)',
                    }}
                    labelStyle={{
                      color: 'var(--color-text)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--color-text-muted)]">
                No data yet
              </div>
            )}
          </div>
        </div>

        {/* Sources status */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Sources Status
          </h3>
          <div className="space-y-3">
            {sourcesData?.sources?.length > 0 ? (
              sourcesData.sources.map((source) => {
                const cbStatus = circuitBreakerStatuses.find(
                  (cb) => cb.id === source.id
                );
                return (
                  <div
                    key={source.id}
                    className="flex items-center justify-between p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          source.is_active
                            ? 'bg-accent-500'
                            : 'bg-surface-400'
                        }`}
                      />
                      <div>
                        <p className="font-medium text-[var(--color-text)]">
                          {source.name}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate max-w-xs">
                          {source.base_url}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {cbStatus && (
                        <span
                          className={`badge ${
                            cbStatus.state === 'closed'
                              ? 'badge-success'
                              : cbStatus.state === 'half-open'
                              ? 'badge-warning'
                              : 'badge-danger'
                          }`}
                        >
                          {cbStatus.state}
                        </span>
                      )}
                      <span
                        className={`badge ${
                          source.is_active ? 'badge-success' : 'badge-danger'
                        }`}
                      >
                        {source.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8 text-[var(--color-text-muted)]">
                No sources configured yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cache stats */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">
          Cache Statistics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p className="text-2xl font-bold text-[var(--color-text)]">
              {metrics?.cache?.total_entries || 0}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">Total Entries</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-accent-500">
              {metrics?.cache?.active_entries || 0}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">Active Entries</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-amber-500">
              {metrics?.cache?.expired_entries || 0}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">Expired Entries</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary-500">
              {metrics?.cache?.total_hits || 0}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">Total Hits</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, trend, color = 'primary', tooltip }) {
  const colorClasses = {
    primary: 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400',
    accent: 'bg-accent-100 text-accent-600 dark:bg-accent-900/30 dark:text-accent-400',
    amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  };

  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <div
            className={`flex items-center gap-1 text-sm ${
              trend === 'up' ? 'text-accent-500' : 'text-red-500'
            }`}
          >
            {trend === 'up' ? (
              <ArrowUp className="w-4 h-4" />
            ) : (
              <ArrowDown className="w-4 h-4" />
            )}
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="stat-value">{value}</p>
        <p className="stat-label" title={tooltip}>
          {label}
        </p>
      </div>
    </div>
  );
}

