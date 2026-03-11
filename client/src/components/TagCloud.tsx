import React, { useState } from 'react';
import { Tag, X, Plus, Edit, Trash2, Hash } from 'lucide-react';
import { Tag as TagType, TagCloudLayout } from '../types/tag';

interface TagCloudProps {
  tags: TagType[];
  selectedTags: number[];
  onTagToggle: (tagId: number) => void;
  onTagCreate?: () => void;
  onTagEdit?: (tagId: number) => void;
  onTagDelete?: (tagId: number) => void;
  layout?: TagCloudLayout;
  loading?: boolean;
}

/**
 * 标签云组件
 */
const TagCloud: React.FC<TagCloudProps> = ({
  tags,
  selectedTags,
  onTagToggle,
  onTagCreate,
  onTagEdit,
  onTagDelete,
  layout = 'list',
  loading = false
}) => {
  const [showMenu, setShowMenu] = useState<number | null>(null);

  const handleTagClick = (tagId: number) => {
    onTagToggle(tagId);
  };

  const handleMenuToggle = (tagId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(showMenu === tagId ? null : tagId);
  };

  const handleEdit = (tagId: number) => {
    if (onTagEdit) {
      onTagEdit(tagId);
    }
    setShowMenu(null);
  };

  const handleDelete = (tagId: number) => {
    if (onTagDelete) {
      onTagDelete(tagId);
    }
    setShowMenu(null);
  };

  // 列表模式
  if (layout === 'list') {
    return (
      <div className="tag-cloud-list">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-700">标签</h3>
          {onTagCreate && (
            <button
              onClick={onTagCreate}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
              title="新建标签"
            >
              <Plus className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-4 text-gray-400">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-sm">加载中...</span>
          </div>
        ) : tags.length === 0 ? (
          <div className="py-4 text-center text-gray-400 text-sm">
            <p>暂无标签</p>
            <button
              onClick={onTagCreate}
              className="mt-2 text-blue-600 hover:text-blue-700"
            >
              + 创建第一个标签
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {tags.map((tag) => {
              const isSelected = selectedTags.includes(tag.id);
              return (
                <div
                  key={tag.id}
                  className={`tag-item flex items-center justify-between py-1.5 px-2 rounded-md cursor-pointer transition-all ${
                    isSelected ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
                  }`}
                  onClick={() => handleTagClick(tag.id)}
                >
                  <div className="flex items-center flex-1 min-w-0">
                    <Hash className="w-3 h-3 mr-2 flex-shrink-0" style={{ color: tag.color }} />
                    <span className="text-sm font-medium truncate">{tag.name}</span>
                    {tag.usage_count > 0 && (
                      <span className="ml-2 text-xs text-gray-400 flex-shrink-0">
                        {tag.usage_count}
                      </span>
                    )}
                  </div>

                  {onTagEdit !== undefined || onTagDelete !== undefined ? (
                    <div className="relative">
                      <button
                        onClick={(e) => handleMenuToggle(tag.id, e)}
                        className="p-1 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Tag className="w-3 h-3 text-gray-400" />
                      </button>

                      {showMenu === tag.id && (
                        <div className="absolute right-0 top-full mt-1 w-28 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                          <button
                            onClick={() => handleEdit(tag.id)}
                            className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-100 flex items-center"
                          >
                            <Edit className="w-3 h-3 mr-2" />
                            编辑
                          </button>
                          {onTagDelete !== undefined && (
                            <button
                              onClick={() => handleDelete(tag.id)}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-red-50 text-red-600 flex items-center"
                            >
                              <Trash2 className="w-3 h-3 mr-2" />
                              删除
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // 云图模式
  return (
    <div className="tag-cloud-cloud">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-700">标签</h3>
        {onTagCreate && (
          <button
            onClick={onTagCreate}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            title="新建标签"
          >
            <Plus className="w-4 h-4 text-gray-500" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4 text-gray-400">
          <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm">加载中...</span>
        </div>
      ) : tags.length === 0 ? (
        <div className="py-4 text-center text-gray-400 text-sm">
          <p>暂无标签</p>
          <button
            onClick={onTagCreate}
            className="mt-2 text-blue-600 hover:text-blue-700"
          >
            + 创建第一个标签
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const isSelected = selectedTags.includes(tag.id);
            return (
              <div
                key={tag.id}
                className={`tag-chip group relative inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                style={{
                  borderColor: isSelected ? tag.color : 'transparent',
                  borderStyle: 'solid',
                  borderWidth: '1px'
                }}
                onClick={() => handleTagClick(tag.id)}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span>{tag.name}</span>
                {tag.usage_count > 0 && (
                  <span className="ml-1 text-xs opacity-60">{tag.usage_count}</span>
                )}

                {/* 快速删除按钮 */}
                {isSelected && onTagEdit !== undefined && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(tag.id);
                    }}
                    className="ml-1 p-0.5 hover:bg-white rounded transition-colors"
                  >
                    <Edit className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TagCloud;
