import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { costSavingsApi, sourcesApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  Database,
  Zap,
  Download,
  Loader2,
  XCircle,
  Edit2,
  Save,
  X,
} from 'lucide-react';

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

const TIME_RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

export default function CostSavings() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [timeRange, setTimeRange] = useState('all');
  const [granularity, setGranularity] = useState('day');
  const [showTimeSeries, setShowTimeSeries] = useState(false);
  const [editingCost, setEditingCost] = useState(null);
  const [editValue, setEditValue] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cost-savings', timeRange],
    queryFn: () => costSavingsApi.get(timeRange).then((r) => r.data),
    refetchInterval: 60000, // Refetch every minute
  });

  // For time series, use a reasonable default range if "all" is selected
  const effectiveTimeRange = showTimeSeries && timeRange === 'all' ? '90d' : timeRange;
  
  const { data: timeSeriesData, isLoading: timeSeriesLoading } = useQuery({
    queryKey: ['cost-savings-time-series', granularity, effectiveTimeRange],
    queryFn: () => costSavingsApi.getTimeSeries(granularity, effectiveTimeRange).then((r) => r.data),
    enabled: showTimeSeries,
    refetchInterval: 60000,
  });

  const { data: sourcesData } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.list().then((r) => r.data),
  });

  const handleExport = async (format) => {
    try {
      const response = await costSavingsApi.export(format, timeRange);
      if (format === 'csv') {
        const blob = new Blob([response.data], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cost-savings-${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cost-savings-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export report');
    }
  };

  const handleEditCost = (source) => {
    setEditingCost(source.source_id);
    setEditValue(source.cost_per_request?.toString() || '');
  };

  const handleSaveCost = async (sourceId) => {
    try {
      const costValue = editValue ? parseFloat(editValue) : null;
      if (costValue !== null && (costValue < 0 || costValue > 9999.9999)) {
        alert('Cost must be between 0 and 9999.9999');
        return;
      }
      
      await sourcesApi.update(sourceId, { cost_per_request: costValue });
      setEditingCost(null);
      refetch();
      // Invalidate sources query to refresh the list
      queryClient.invalidateQueries(['sources']);
    } catch (err) {
      console.error('Failed to update cost:', err);
      alert('Failed to update cost per request');
    }
  };

  const handleCancelEdit = () => {
    setEditingCost(null);
    setEditValue('');
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
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

  if (error) {
    return (
      <div className="card p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <XCircle className="w-5 h-5" />
          <span className="font-medium">Failed to load cost savings data</span>
        </div>
        <p className="text-sm text-red-600 dark:text-red-400 mt-1">
          {error.message || 'Please try refreshing the page'}
        </p>
      </div>
    );
  }

  const summary = data?.summary || {};
  const breakdown = data?.breakdown || [];

  // Prepare chart data
  const barChartData = breakdown
    .filter(b => b.total_saved > 0)
    .sort((a, b) => b.total_saved - a.total_saved)
    .slice(0, 10)
    .map(b => ({
      name: b.source_name.length > 12 ? b.source_name.substring(0, 12) + '...' : b.source_name,
      fullName: b.source_name,
      saved: parseFloat(b.total_saved.toFixed(2)),
      wouldHaveCost: parseFloat(b.would_have_cost.toFixed(2)),
    }));

  const pieChartData = breakdown
    .filter(b => b.total_saved > 0)
    .sort((a, b) => b.total_saved - a.total_saved)
    .slice(0, 7)
    .map(b => ({
      name: b.source_name,
      value: parseFloat(b.total_saved.toFixed(2)),
    }));

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text)]">Cost Savings</h1>
          <p className="text-[var(--color-text-muted)] mt-1">
            Track how much money API-Saver is saving through intelligent caching
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="input"
          >
            {TIME_RANGE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowTimeSeries(!showTimeSeries)}
            className={`btn-secondary flex items-center gap-2 ${showTimeSeries ? 'bg-primary-100 dark:bg-primary-900/30' : ''}`}
          >
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">{showTimeSeries ? 'Hide' : 'Show'} Time Series</span>
            <span className="sm:hidden">{showTimeSeries ? 'Hide' : 'Trends'}</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExport('csv')}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">CSV</span>
            </button>
            <button
              onClick={() => handleExport('json')}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export JSON</span>
              <span className="sm:hidden">JSON</span>
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={DollarSign}
          label="Total Savings"
          value={formatCurrency(summary.total_saved || 0)}
          color="accent"
          trend="up"
        />
        <StatCard
          icon={Database}
          label="Cache Hits"
          value={summary.total_cached_requests?.toLocaleString() || '0'}
          color="primary"
          tooltip="Total requests served from cache (SUM of hit_count)"
        />
        <StatCard
          icon={Zap}
          label="Initial API Calls"
          value={summary.total_api_calls?.toLocaleString() || '0'}
          color="amber"
          tooltip="Number of cache entries created (initial API calls that populated the cache)"
        />
        <StatCard
          icon={TrendingUp}
          label="Savings %"
          value={`${(summary.overall_savings_percent || 0).toFixed(1)}%`}
          color="accent"
        />
      </div>

      {/* Additional Summary Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Cost Overview
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Total Would Have Cost:</span>
              <span className="font-semibold text-[var(--color-text)]">
                {formatCurrency(summary.total_would_have_cost || 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Average Cost Per Request:</span>
              <span className="font-semibold text-[var(--color-text)]">
                {formatCurrency(summary.avg_cost_per_request || 0)}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-[var(--color-border)]">
              <span className="text-lg font-semibold text-accent-600 dark:text-accent-400">
                Net Savings:
              </span>
              <span className="text-lg font-bold text-accent-600 dark:text-accent-400">
                {formatCurrency(summary.total_saved || 0)}
              </span>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Performance Metrics
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Cache Hit Ratio:</span>
              <span className="font-semibold text-[var(--color-text)]" title="Cache hits / (Cache hits + Initial API calls)">
                {summary.total_cached_requests && summary.total_api_calls
                  ? `${((summary.total_cached_requests / (summary.total_cached_requests + summary.total_api_calls)) * 100).toFixed(1)}%`
                  : '0%'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Total Requests (Cache-based):</span>
              <span className="font-semibold text-[var(--color-text)]" title="Cache hits + Initial API calls. Note: Dashboard may show different total if circuit breakers are used.">
                {((summary.total_cached_requests || 0) + (summary.total_api_calls || 0)).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Sources with Cost Configured:</span>
              <span className="font-semibold text-[var(--color-text)]">
                {breakdown.filter(b => b.cost_per_request > 0).length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Time Series Chart */}
      {showTimeSeries && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">
              Cost Savings Over Time
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--color-text-muted)]">View:</span>
              <select
                value={granularity}
                onChange={(e) => setGranularity(e.target.value)}
                className="input text-sm"
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </div>
          </div>
          <div className="w-full" style={{ minHeight: '400px', height: '400px' }}>
            {timeSeriesLoading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
              </div>
            ) : timeSeriesData?.time_series?.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={timeSeriesData.time_series}
                  margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="period"
                    stroke="var(--color-text-muted)"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => {
                      if (granularity === 'month') {
                        // Value is in "YYYY-MM" format
                        const [year, month] = value.split('-');
                        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        const monthIndex = parseInt(month, 10) - 1;
                        return `${monthNames[monthIndex]} ${year}`;
                      } else if (granularity === 'week') {
                        // Value is in "YYYY-MM-DD" format (start of week) - UTC
                        const date = new Date(value + 'T00:00:00Z');
                        if (isNaN(date.getTime())) {
                          return value;
                        }
                        // Use UTC methods to avoid timezone shifts
                        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        return `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`;
                      } else {
                        // Value is in "YYYY-MM-DD" format - UTC
                        const date = new Date(value + 'T00:00:00Z');
                        if (isNaN(date.getTime())) {
                          return value;
                        }
                        // Use UTC methods to avoid timezone shifts
                        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        return `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`;
                      }
                    }}
                  />
                  <YAxis
                    stroke="var(--color-text-muted)"
                    tickFormatter={(value) => {
                      if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
                      return `$${value.toFixed(0)}`;
                    }}
                  />
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
                      fontWeight: 'bold',
                    }}
                    formatter={(value, name) => {
                      if (name === 'total_saved') return [formatCurrency(value), 'Total Saved'];
                      if (name === 'total_would_have_cost') return [formatCurrency(value), 'Would Have Cost'];
                      return [formatCurrency(value), name];
                    }}
                    labelFormatter={(label) => {
                      if (granularity === 'month') {
                        // Label is in "YYYY-MM" format
                        const [year, month] = label.split('-');
                        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                        const monthIndex = parseInt(month, 10) - 1;
                        return `${monthNames[monthIndex]} ${year}`;
                      } else if (granularity === 'week') {
                        // Label is in "YYYY-MM-DD" format (start of week) - UTC
                        const date = new Date(label + 'T00:00:00Z');
                        if (isNaN(date.getTime())) {
                          return `Week of ${label}`;
                        }
                        // Use UTC methods to avoid timezone shifts
                        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                        const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                        return `Week of ${weekdayNames[date.getUTCDay()]}, ${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
                      } else {
                        // Label is in "YYYY-MM-DD" format - UTC
                        const date = new Date(label + 'T00:00:00Z');
                        if (isNaN(date.getTime())) {
                          return label;
                        }
                        // Use UTC methods to avoid timezone shifts
                        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                        const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                        return `${weekdayNames[date.getUTCDay()]}, ${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
                      }
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total_saved"
                    stroke="#22c55e"
                    strokeWidth={2}
                    name="Total Saved"
                    dot={{ fill: '#22c55e', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total_would_have_cost"
                    stroke="#ef4444"
                    strokeWidth={2}
                    name="Would Have Cost"
                    dot={{ fill: '#ef4444', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--color-text-muted)]">
                <div className="text-center">
                  <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p>No time-series data available</p>
                  <p className="text-sm mt-1">Configure cost per request for sources to see trends</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Savings by Source
          </h3>
          <div className="w-full" style={{ minHeight: '400px', height: '400px' }}>
            {barChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={barChartData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 100 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis 
                    dataKey="name" 
                    stroke="var(--color-text-muted)"
                    angle={-45}
                    textAnchor="end"
                    height={100}
                    interval={0}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    stroke="var(--color-text-muted)"
                    tickFormatter={(value) => {
                      if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
                      return `$${value.toFixed(0)}`;
                    }}
                  />
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
                      fontWeight: 'bold',
                    }}
                    formatter={(value, name) => {
                      if (name === 'saved') return [formatCurrency(value), 'Saved'];
                      if (name === 'wouldHaveCost') return [formatCurrency(value), 'Would Have Cost'];
                      return [formatCurrency(value), name];
                    }}
                    labelFormatter={(label) => {
                      const item = barChartData.find(d => d.name === label);
                      return item?.fullName || label;
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                  />
                  <Bar dataKey="saved" fill="#22c55e" name="Saved" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="wouldHaveCost" fill="#ef4444" name="Would Have Cost" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--color-text-muted)]">
                <div className="text-center">
                  <Database className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p>No data available</p>
                  <p className="text-sm mt-1">Configure cost per request for sources to see savings</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pie Chart */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Savings Distribution
          </h3>
          <div className="w-full" style={{ minHeight: '400px', height: '400px' }}>
            {pieChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) => {
                      const shortName = name.length > 12 ? name.substring(0, 12) + '...' : name;
                      return `${shortName} ${(percent * 100).toFixed(0)}%`;
                    }}
                    labelLine={false}
                  >
                    {pieChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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
                      fontWeight: 'bold',
                    }}
                    formatter={(value) => formatCurrency(value)}
                  />
                  <Legend 
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value, entry) => {
                      const item = pieChartData.find(d => d.name === value);
                      const shortName = value.length > 20 ? value.substring(0, 20) + '...' : value;
                      return shortName;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--color-text-muted)]">
                <div className="text-center">
                  <Database className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p>No data available</p>
                  <p className="text-sm mt-1">Configure cost per request for sources to see savings</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">
          Detailed Breakdown by Source
        </h3>
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-3 px-4 font-semibold text-[var(--color-text)]">Source Name</th>
                <th className="text-right py-3 px-4 font-semibold text-[var(--color-text)]">Cost Per Request</th>
                <th className="text-right py-3 px-4 font-semibold text-[var(--color-text)]" title="Total requests served from cache (SUM of hit_count)">
                  Cache Hits
                </th>
                <th className="text-right py-3 px-4 font-semibold text-[var(--color-text)]" title="Number of cache entries created (initial API calls)">
                  Initial API Calls
                </th>
                <th className="text-right py-3 px-4 font-semibold text-[var(--color-text)]">Total Saved</th>
                <th className="text-right py-3 px-4 font-semibold text-[var(--color-text)]">Would Have Cost</th>
                <th className="text-right py-3 px-4 font-semibold text-[var(--color-text)]">Savings %</th>
                {isAdmin && <th className="text-center py-3 px-4 font-semibold text-[var(--color-text)]">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {breakdown.length > 0 ? (
                breakdown.map((source) => (
                  <tr
                    key={source.source_id}
                    className="border-b border-[var(--color-border)] hover:bg-surface-50 dark:hover:bg-surface-800/30"
                  >
                    <td className="py-3 px-4 text-[var(--color-text)] font-medium">
                      {source.source_name}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {editingCost === source.source_id ? (
                        <div className="flex items-center justify-end gap-2">
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            max="9999.9999"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="input w-32 text-right"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveCost(source.source_id)}
                            className="p-1 text-accent-600 hover:text-accent-700"
                            title="Save"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="p-1 text-red-600 hover:text-red-700"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[var(--color-text)]">
                          {source.cost_per_request > 0
                            ? formatCurrency(source.cost_per_request)
                            : 'Not configured'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right text-[var(--color-text)]" title="Total requests served from cache (SUM of hit_count)">
                      {source.cached_requests.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right text-[var(--color-text)]" title="Number of cache entries created (initial API calls)">
                      {source.api_calls_made.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-accent-600 dark:text-accent-400">
                      {formatCurrency(source.total_saved)}
                    </td>
                    <td className="py-3 px-4 text-right text-[var(--color-text)]">
                      {formatCurrency(source.would_have_cost)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span
                        className={`font-semibold ${
                          source.savings_percent >= 50
                            ? 'text-accent-600 dark:text-accent-400'
                            : source.savings_percent >= 25
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-[var(--color-text-muted)]'
                        }`}
                      >
                        {source.savings_percent.toFixed(1)}%
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-4 text-center">
                        {editingCost !== source.source_id && (
                          <button
                            onClick={() => handleEditCost(source)}
                            className="p-1 text-[var(--color-text-muted)] hover:text-primary-600"
                            title="Edit cost per request"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="py-8 text-center text-[var(--color-text-muted)]">
                    No cost data available. Configure cost per request for sources to see savings.
                  </td>
                </tr>
              )}
            </tbody>
            {breakdown.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--color-border)] font-semibold">
                  <td className="py-3 px-4 text-[var(--color-text)]">Total</td>
                  <td className="py-3 px-4 text-right text-[var(--color-text-muted)]">-</td>
                  <td className="py-3 px-4 text-right text-[var(--color-text)]">
                    {summary.total_cached_requests?.toLocaleString() || '0'}
                  </td>
                  <td className="py-3 px-4 text-right text-[var(--color-text)]">
                    {summary.total_api_calls?.toLocaleString() || '0'}
                  </td>
                  <td className="py-3 px-4 text-right text-accent-600 dark:text-accent-400">
                    {formatCurrency(summary.total_saved || 0)}
                  </td>
                  <td className="py-3 px-4 text-right text-[var(--color-text)]">
                    {formatCurrency(summary.total_would_have_cost || 0)}
                  </td>
                  <td className="py-3 px-4 text-right text-accent-600 dark:text-accent-400">
                    {summary.overall_savings_percent?.toFixed(1) || '0.0'}%
                  </td>
                  {isAdmin && <td></td>}
                </tr>
              </tfoot>
            )}
          </table>
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
          <div className="flex items-center gap-1 text-sm text-accent-500">
            <TrendingUp className="w-4 h-4" />
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

