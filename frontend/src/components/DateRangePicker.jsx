import { useState } from 'react';
import { Calendar } from 'lucide-react';

export default function DateRangePicker({ value, onChange, label }) {
  const [startDate, setStartDate] = useState(value?.start || '');
  const [endDate, setEndDate] = useState(value?.end || '');

  const handleStartChange = (e) => {
    const newStart = e.target.value;
    setStartDate(newStart);
    onChange({ start: newStart, end: endDate });
  };

  const handleEndChange = (e) => {
    const newEnd = e.target.value;
    setEndDate(newEnd);
    onChange({ start: startDate, end: newEnd });
  };

  const handleClear = () => {
    setStartDate('');
    setEndDate('');
    onChange({ start: '', end: '' });
  };

  return (
    <div className="space-y-2">
      {label && <label className="label">{label}</label>}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <input
            type="date"
            value={startDate}
            onChange={handleStartChange}
            className="input text-sm"
            placeholder="Start date"
          />
        </div>
        <span className="text-[var(--color-text-muted)]">to</span>
        <div className="flex-1">
          <input
            type="date"
            value={endDate}
            onChange={handleEndChange}
            className="input text-sm"
            placeholder="End date"
          />
        </div>
        {(startDate || endDate) && (
          <button
            onClick={handleClear}
            className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg transition-colors"
            title="Clear dates"
          >
            <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
          </button>
        )}
      </div>
    </div>
  );
}

