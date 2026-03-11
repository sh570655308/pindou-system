import React, { useState } from 'react';

interface FilterOption {
  label: string;
  value: string;
}

interface FilterConfig {
  value: string;
  options: FilterOption[];
  label?: string;
}

interface ReportFilterProps {
  filters: Record<string, FilterConfig>;
  onChange: (filters: Record<string, string>) => void;
  onRefresh?: () => void;
  loading?: boolean;
}

const ReportFilter: React.FC<ReportFilterProps> = ({
  filters,
  onChange,
  onRefresh,
  loading = false
}) => {
  const [localFilters, setLocalFilters] = useState<Record<string, string>>(
    Object.keys(filters).reduce((acc, key) => ({ ...acc, [key]: filters[key].value }), {})
  );

  const handleFilterChange = (key: string, value: string) => {
    const newFilters = { ...localFilters, [key]: value };
    setLocalFilters(newFilters);
    onChange(newFilters);
  };

  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
      <div className="flex flex-wrap items-center gap-4">
        {Object.entries(filters).map(([key, config]) => (
          <div key={key} className="flex items-center space-x-2">
            {config.label && (
              <label className="text-sm font-medium text-gray-700">
                {config.label}:
              </label>
            )}
            <select
              value={localFilters[key] || config.value}
              onChange={(e) => handleFilterChange(key, e.target.value)}
              className="block w-40 px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              {config.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        {onRefresh && (
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="ml-auto px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                加载中...
              </span>
            ) : (
              <span className="flex items-center">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                刷新
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default ReportFilter;
