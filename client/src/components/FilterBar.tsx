import React, { useState } from 'react';
import { Search, SlidersHorizontal, X, RotateCcw, ChevronDown } from 'lucide-react';

/**
 * 筛选状态接口
 */
export interface FilterState {
  folderId: number | null;
  status: string[];
  archived: boolean | 'all';
  favorite: boolean;
  searchQuery: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

interface FilterBarProps {
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
  onReset: () => void;
  folders?: { id: number; name: string }[];
  statusOptions?: { value: string; label: string }[];
  sortOptions?: { value: string; label: string }[];
}

/**
 * 多维度筛选栏组件
 */
const FilterBar: React.FC<FilterBarProps> = ({
  filter,
  onFilterChange,
  onReset,
  folders = [],
  statusOptions = [
    { value: 'draft', label: '草稿' },
    { value: 'pending', label: '待拼' },
    { value: 'in_progress', label: '进行中' },
    { value: 'completed', label: '已完成' }
  ],
  sortOptions = [
    { value: 'created_at', label: '创建时间' },
    { value: 'updated_at', label: '更新时间' },
    { value: 'title', label: '名称' },
    { value: 'status', label: '状态' }
  ]
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  const updateFilter = (updates: Partial<FilterState>) => {
    onFilterChange({ ...filter, ...updates });
  };

  const toggleStatus = (status: string) => {
    const newStatus = filter.status.includes(status)
      ? filter.status.filter(s => s !== status)
      : [...filter.status, status];
    updateFilter({ status: newStatus });
  };

  const toggleFavorite = () => {
    updateFilter({ favorite: !filter.favorite });
  };

  const toggleArchived = () => {
    const current = filter.archived;
    const newArchived: boolean | 'all' =
      current === false ? true : current === true ? 'all' : false;
    updateFilter({ archived: newArchived });
  };

  const activeFilterCount =
    (filter.searchQuery ? 1 : 0) +
    (filter.folderId !== null ? 1 : 0) +
    filter.status.length +
    (filter.favorite ? 1 : 0) +
    (filter.archived !== false && filter.archived !== 'all' ? 1 : 0);

  return (
    <div className="filter-bar bg-white border border-gray-200 rounded-lg p-3 mb-4 space-y-3">
      {/* 主筛选栏 */}
      <div className="flex items-center gap-3">
        {/* 搜索框 */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索图纸名称..."
            value={filter.searchQuery}
            onChange={(e) => updateFilter({ searchQuery: e.target.value })}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
          {filter.searchQuery && (
            <button
              onClick={() => updateFilter({ searchQuery: '' })}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>

        {/* 高级筛选按钮 */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
            activeFilterCount > 0
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-gray-300 hover:bg-gray-50'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="text-sm">筛选</span>
          {activeFilterCount > 0 && (
            <span className="bg-blue-600 text-white text-xs px-1.5 rounded-full">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
          />
        </button>

        {/* 重置按钮 */}
        {activeFilterCount > 0 && (
          <button
            onClick={onReset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="text-sm">重置</span>
          </button>
        )}
      </div>

      {/* 高级筛选面板 */}
      {showAdvanced && (
        <div className="pt-3 border-t border-gray-200 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 目录筛选 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">目录</label>
              <select
                value={filter.folderId ?? ''}
                onChange={(e) => updateFilter({ folderId: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">全部目录</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 排序选项 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">排序</label>
              <div className="flex gap-2">
                <select
                  value={filter.sortBy}
                  onChange={(e) => updateFilter({ sortBy: e.target.value })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => updateFilter({ sortOrder: filter.sortOrder === 'asc' ? 'desc' : 'asc' })}
                  className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  title={filter.sortOrder === 'asc' ? '升序' : '降序'}
                >
                  {filter.sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>

            {/* 快速筛选按钮 */}
            <div className="flex items-end gap-2">
              <button
                onClick={toggleFavorite}
                className={`flex-1 px-3 py-2 rounded-lg border transition-colors ${
                  filter.favorite
                    ? 'bg-yellow-100 border-yellow-300 text-yellow-700'
                    : 'border-gray-300 hover:bg-gray-50'
                }`}
              >
                ⭐ {filter.favorite ? '已收藏' : '收藏'}
              </button>
              <button
                onClick={toggleArchived}
                className={`flex-1 px-3 py-2 rounded-lg border transition-colors ${
                  filter.archived === true
                    ? 'bg-gray-200 border-gray-400 text-gray-700'
                    : filter.archived === 'all'
                    ? 'bg-gray-100 border-gray-300 text-gray-600'
                    : 'border-gray-300 hover:bg-gray-50'
                }`}
              >
                📦 {filter.archived === true ? '仅归档' : filter.archived === 'all' ? '全部' : '未归档'}
              </button>
            </div>

            {/* 状态筛选 */}
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
              <button
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-left text-sm flex items-center justify-between"
              >
                <span>
                  {filter.status.length === 0
                    ? '全部状态'
                    : `已选 ${filter.status.length} 个`}
                </span>
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${showStatusDropdown ? 'rotate-180' : ''}`}
                />
              </button>

              {showStatusDropdown && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg py-1">
                  {statusOptions.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center px-3 py-2 hover:bg-gray-100 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={filter.status.includes(option.value)}
                        onChange={() => toggleStatus(option.value)}
                        className="mr-2"
                      />
                      <span className="text-sm">{option.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilterBar;
