import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, MoreVertical, Plus, Edit, Trash2 } from 'lucide-react';
import { FolderNode } from '../types/folder';

export type DropPosition = 'before' | 'inside' | 'after';

interface DirectoryTreeProps {
  tree: FolderNode[];
  selectedFolderId: number | null;
  onFolderSelect: (folderId: number | null) => void;
  onFolderCreate: (parentId: number | null) => void;
  onFolderEdit: (folderId: number) => void;
  onFolderDelete: (folderId: number) => void;
  /**
   * 拖放移动目录：把 draggedId 放到 targetId 的 position 位置。
   * - before/after：插入到 targetId 的同级前/后
   * - inside：成为 targetId 的子目录
   */
  onFolderReorder?: (draggedId: number, targetId: number, position: DropPosition) => void;
  /** @deprecated 旧回调，仅保留向后兼容；若提供 onFolderReorder 则忽略此回调 */
  onFolderDrop?: (draggedId: number, targetId: number) => void;
  loading?: boolean;
}

/**
 * 递归渲染目录树节点
 */
const FolderTreeNode: React.FC<{
  node: FolderNode;
  level: number;
  selectedFolderId: number | null;
  onFolderSelect: (folderId: number | null) => void;
  onFolderCreate: (parentId: number | null) => void;
  onFolderEdit: (folderId: number) => void;
  onFolderDelete: (folderId: number) => void;
  onFolderReorder?: (draggedId: number, targetId: number, position: DropPosition) => void;
  onFolderDrop?: (draggedId: number, targetId: number) => void;
  /** 判断 targetId 是否是 draggedId 的子孙（用于禁用无效拖放） */
  isDescendantOfDragged?: (draggedId: number, targetId: number) => boolean;
}> = ({
  node,
  level,
  selectedFolderId,
  onFolderSelect,
  onFolderCreate,
  onFolderEdit,
  onFolderDelete,
  onFolderReorder,
  onFolderDrop,
  isDescendantOfDragged
}) => {
  const [expanded, setExpanded] = useState(node.expanded || false);
  const [showMenu, setShowMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  // dragenter/dragleave 计数器，避免子元素切换造成抖动
  const dragEnterCount = useRef(0);
  const hasChildren = node.children && node.children.length > 0;
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showMenu]);

  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const handleSelect = () => {
    onFolderSelect(node.id);
  };

  const handleCreateSubfolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFolderCreate(node.id);
    setShowMenu(false);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFolderEdit(node.id);
    setShowMenu(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFolderDelete(node.id);
    setShowMenu(false);
  };

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(node.id));
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDropPosition(null);
    dragEnterCount.current = 0;
  };

  // 根据鼠标在节点内的纵向位置判定拖放位置
  const computeDropPosition = (e: React.DragEvent): DropPosition => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (y < h * 0.25) return 'before';
    if (y > h * 0.75) return 'after';
    return 'inside';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!onFolderReorder) return;
    const draggedId = parseInt(e.dataTransfer.getData('text/plain') || '0');
    // 不能拖到自己身上
    if (draggedId && draggedId === node.id) return;
    // 不能拖到自己的子孙节点上（仅在 isDescendantOfDragged 提供时检查）
    if (draggedId && isDescendantOfDragged && isDescendantOfDragged(draggedId, node.id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const pos = computeDropPosition(e);
    if (pos !== dropPosition) setDropPosition(pos);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!onFolderReorder) return;
    const draggedId = parseInt(e.dataTransfer.getData('text/plain') || '0');
    if (draggedId && draggedId === node.id) return;
    if (draggedId && isDescendantOfDragged && isDescendantOfDragged(draggedId, node.id)) return;
    dragEnterCount.current += 1;
  };

  const handleDragLeave = () => {
    if (!onFolderReorder) return;
    dragEnterCount.current -= 1;
    if (dragEnterCount.current <= 0) {
      dragEnterCount.current = 0;
      setDropPosition(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
    dragEnterCount.current = 0;
    const pos = dropPosition;
    setDropPosition(null);
    if (!draggedId || draggedId === node.id) return;
    // 后代判定（虽然 dragOver 已拦截，这里再保险一次）
    if (isDescendantOfDragged && isDescendantOfDragged(draggedId, node.id)) return;
    if (onFolderReorder) {
      onFolderReorder(draggedId, node.id, pos || 'inside');
    } else if (onFolderDrop) {
      // 向后兼容：没有 reorder 回调时退化为"成为子目录"
      onFolderDrop(draggedId, node.id);
    }
  };

  const isSelected = selectedFolderId === node.id;
  const paddingLeft = level * 16 + 8;

  // 视觉反馈类
  const isDropInside = dropPosition === 'inside';
  const showDropLineBefore = dropPosition === 'before';
  const showDropLineAfter = dropPosition === 'after';

  return (
    <div className="folder-tree-node">
      <div
        className={`folder-node-content group flex items-center py-1.5 px-2 cursor-pointer hover:bg-gray-100 rounded-md transition-colors relative ${
          isSelected ? 'bg-blue-100 text-blue-700' : ''
        } ${isDragging ? 'opacity-50' : ''} ${
          isDropInside ? 'ring-2 ring-blue-400 bg-blue-50' : ''
        }`}
        style={{ paddingLeft: `${paddingLeft}px` }}
        draggable={!!(onFolderReorder || onFolderDrop)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 拖放插入指示线：before（上方） */}
        {showDropLineBefore && (
          <div
            className="absolute left-2 right-2 top-0 z-10 pointer-events-none"
            style={{ height: '2px', backgroundColor: '#3B82F6', boxShadow: '0 0 3px rgba(59,130,246,0.8)' }}
          />
        )}
        {/* 拖放插入指示线：after（下方） */}
        {showDropLineAfter && (
          <div
            className="absolute left-2 right-2 bottom-0 z-10 pointer-events-none"
            style={{ height: '2px', backgroundColor: '#3B82F6', boxShadow: '0 0 3px rgba(59,130,246,0.8)' }}
          />
        )}
        {/* 展开/折叠按钮 */}
        <button
          onClick={toggleExpand}
          className="p-0.5 hover:bg-gray-200 rounded mr-1 transition-colors"
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {/* 文件夹图标 */}
        <div onClick={handleSelect} className="flex items-center flex-1 min-w-0">
          {expanded ? (
            <FolderOpen className="w-4 h-4 mr-2 flex-shrink-0" style={{ color: node.color }} />
          ) : (
            <Folder className="w-4 h-4 mr-2 flex-shrink-0" style={{ color: node.color }} />
          )}

          {/* 文件夹名称 */}
          <span className="text-sm font-medium truncate">{node.name}</span>

          {/* 图纸数量 */}
          {node.drawing_count > 0 && (
            <span className="ml-2 text-xs text-gray-400 flex-shrink-0">({node.drawing_count})</span>
          )}
        </div>

        {/* 右键菜单按钮 */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreVertical className="w-4 h-4 text-gray-500" />
          </button>

          {/* 下拉菜单 */}
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              <button
                onClick={handleCreateSubfolder}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 flex items-center"
              >
                <Plus className="w-4 h-4 mr-2" />
                新建子目录
              </button>
              <button
                onClick={handleEdit}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 flex items-center"
              >
                <Edit className="w-4 h-4 mr-2" />
                重命名
              </button>
              {node.name !== '未分类' && (
                <button
                  onClick={handleDelete}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-red-50 text-red-600 flex items-center"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  删除
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 子节点 */}
      {expanded && hasChildren && (
        <div className="children">
          {node.children!.map((child) => (
            <FolderTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedFolderId={selectedFolderId}
              onFolderSelect={onFolderSelect}
              onFolderCreate={onFolderCreate}
              onFolderEdit={onFolderEdit}
              onFolderDelete={onFolderDelete}
              onFolderReorder={onFolderReorder}
              onFolderDrop={onFolderDrop}
              isDescendantOfDragged={isDescendantOfDragged}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 目录树组件
 */
const DirectoryTree: React.FC<DirectoryTreeProps> = ({
  tree,
  selectedFolderId,
  onFolderSelect,
  onFolderCreate,
  onFolderEdit,
  onFolderDelete,
  onFolderReorder,
  onFolderDrop,
  loading = false
}) => {
  // 构建 id -> 子孙 id 集合的索引，用于禁止把目录拖入自己的子树
  const descendantIndex = React.useMemo(() => {
    const index = new Map<number, Set<number>>();
    const collect = (n: FolderNode): Set<number> => {
      const acc = new Set<number>();
      (n.children || []).forEach((c) => {
        const childSet = collect(c);
        // 把子节点及其所有子孙并入本节点的后代集合
        childSet.forEach((id) => acc.add(id));
        acc.add(c.id);
      });
      index.set(n.id, acc);
      return acc;
    };
    tree.forEach((n) => collect(n));
    return index;
  }, [tree]);

  const isDescendantOfDragged = React.useCallback(
    (draggedId: number, targetId: number): boolean => {
      const set = descendantIndex.get(draggedId);
      return !!set && set.has(targetId);
    },
    [descendantIndex]
  );

  return (
    <div className="directory-tree">
      {/* 全部图纸选项 */}
      <div
        className={`folder-node-content flex items-center py-2 px-2 cursor-pointer hover:bg-gray-100 rounded-md mb-1 ${
          selectedFolderId === null ? 'bg-blue-100 text-blue-700' : ''
        }`}
        onClick={() => onFolderSelect(null)}
      >
        <Folder className="w-4 h-4 mr-2 text-gray-500" />
        <span className="text-sm font-medium">全部图纸</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
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
      ) : tree.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-sm">
          <p>暂无目录</p>
          <button
            onClick={() => onFolderCreate(null)}
            className="mt-2 text-blue-600 hover:text-blue-700"
          >
            + 创建第一个目录
          </button>
        </div>
      ) : (
        <div className="tree-content">
          {tree.map((node) => (
            <FolderTreeNode
              key={node.id}
              node={node}
              level={0}
              selectedFolderId={selectedFolderId}
              onFolderSelect={onFolderSelect}
              onFolderCreate={onFolderCreate}
              onFolderEdit={onFolderEdit}
              onFolderDelete={onFolderDelete}
              onFolderReorder={onFolderReorder}
              onFolderDrop={onFolderDrop}
              isDescendantOfDragged={isDescendantOfDragged}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default DirectoryTree;
