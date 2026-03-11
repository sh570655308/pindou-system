import React, { useState, useRef } from 'react';
import { BrushPreset } from '../hooks/useBrushPresets';

export interface SelectionState {
  selectedCells: Set<string>; // 使用 "row,col" 作为key
  isSelecting: boolean;
}

export type SelectionTool = 'hand' | 'free-select' | 'magic-wand' | 'color-select' | 'paste' | 'brush';

export interface BrushSettings {
  color: string | null;
  productId: number | null;
  size: number;
}

export interface MaterialInfo {
  id: number;
  code: string;
  name?: string;
  hex?: string;
}

export interface PixelToolbarProps {
  position: { x: number; y: number };
  collapsed: boolean;
  onPositionChange: (pos: { x: number; y: number }) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  currentTool: SelectionTool;
  onToolChange: (tool: SelectionTool) => void;
  selectionState: SelectionState;
  onClearSelection: () => void;
  onFillSelection: (color: string) => void;
  onDeleteSelection: () => void;
  onCopySelection: () => void;
  hasClipboard: boolean;
  // 画笔相关 - 新增多画笔支持
  brushes: BrushPreset[];
  activeBrushId: number;
  activeBrush: BrushPreset;
  onBrushSelect: (id: number) => void;
  onBrushUpdate: (id: number, updates: Partial<BrushPreset>) => void;
  onOpenBrushColorPicker: () => void;
  availableMaterials?: MaterialInfo[];
}

const PixelToolbar: React.FC<PixelToolbarProps> = ({
  position,
  collapsed,
  onPositionChange,
  onCollapsedChange,
  currentTool,
  onToolChange,
  selectionState,
  onClearSelection,
  onFillSelection,
  onDeleteSelection,
  onCopySelection,
  hasClipboard,
  brushes,
  activeBrushId,
  activeBrush,
  onBrushSelect,
  onBrushUpdate,
  onOpenBrushColorPicker,
  availableMaterials = [],
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (collapsed) return;
    dragRef.current = { startX: e.clientX - position.x, startY: e.clientY - position.y };
    setIsDragging(true);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragRef.current) return;
    const newX = e.clientX - dragRef.current.startX;
    const newY = e.clientY - dragRef.current.startY;
    // 限制在视窗范围内
    const clampedX = Math.max(0, Math.min(window.innerWidth - (collapsed ? 48 : 500), newX));
    const clampedY = Math.max(0, Math.min(window.innerHeight - 48, newY));
    onPositionChange({ x: clampedX, y: clampedY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    dragRef.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  const toggleCollapsed = () => {
    onCollapsedChange(!collapsed);
  };

  // 计算颜色的亮度，返回合适的文本颜色（黑色或白色）
  const getContrastColor = (hexColor: string): string => {
    // 移除 # 前缀
    const hex = hexColor.replace('#', '');
    // 解析 RGB
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    // 计算亮度（使用 sRGB 亮度公式）
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    // 返回黑色或白色，取决于背景亮度
    return brightness > 128 ? '#1f2937' : '#ffffff';
  };

  // 获取画笔显示的名称（有颜色时显示代码，否则显示原名）
  const getBrushDisplayName = (brush: BrushPreset): string => {
    if (brush.productId && availableMaterials) {
      const material = availableMaterials.find(m => m.id === brush.productId);
      return material?.code || brush.name;
    }
    if (brush.color) {
      // 如果只有颜色没有产品，显示颜色代码的前6位
      return brush.color.toUpperCase().replace('#', '');
    }
    return brush.name;
  };

  if (collapsed) {
    return (
      <div
        className="fixed z-50 bg-white/90 backdrop-blur-sm shadow-lg rounded-full cursor-move transition-all duration-200 hover:scale-105"
        style={{
          left: position.x,
          top: position.y,
          width: 48,
          height: 48,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <button
          className="w-full h-full flex items-center justify-center text-gray-700 hover:text-gray-900"
          onClick={toggleCollapsed}
          title="展开工具栏"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed z-50 bg-white/95 backdrop-blur-sm shadow-xl rounded-lg border border-gray-200 transition-all duration-200 hover:shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        minWidth: 400,
        maxWidth: 900,
      }}
    >
      {/* 折叠按钮 */}
      <button
        className="absolute -right-3 -top-3 w-8 h-8 bg-white border border-gray-300 rounded-full shadow-md flex items-center justify-center text-gray-600 hover:text-gray-800 hover:bg-gray-50 transition-all duration-200 z-10"
        onClick={toggleCollapsed}
        title="折叠工具栏"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* 工具栏内容 */}
      <div className="p-4">
        <div className="flex">
          {/* 左侧：主工具区 */}
          <div className="flex-1">
            {/* 标题栏 */}
            <div
              className="flex items-center justify-between mb-4 cursor-move select-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <h3 className="text-lg font-semibold text-gray-800">像素工具</h3>
              <div className="text-sm text-gray-500">
                {selectionState.selectedCells.size > 0
                  ? `已选中 ${selectionState.selectedCells.size} 个像素`
                  : '未选中像素'
                }
              </div>
            </div>

            {/* 主要工具 */}
            <div className="flex items-center space-x-2 mb-4">
              {/* 手掌工具 */}
              <button
                className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 transition-all duration-200 ${currentTool === 'hand'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-800'
                  }`}
                onClick={() => onToolChange('hand')}
                title="手掌工具 - 拖拽和缩放"
              >
                <svg className="w-6 h-6 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
                <span className="text-xs">手掌</span>
              </button>

              {/* 自由选择工具 */}
              <button
                className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 transition-all duration-200 ${currentTool === 'free-select'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-800'
                  }`}
                onClick={() => onToolChange('free-select')}
                title="自由选择工具 - 点击选择，Ctrl多选，Shift框选，Alt反向选择"
              >
                <svg className="w-6 h-6 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
                <span className="text-xs">选择</span>
              </button>

              {/* 连续选择工具 */}
              <button
                className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 transition-all duration-200 ${currentTool === 'magic-wand'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-800'
                  }`}
                onClick={() => onToolChange('magic-wand')}
                title="连续选择工具 - 选择相同颜色的连续像素"
              >
                <svg className="w-6 h-6 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                <span className="text-xs">魔棒</span>
              </button>

              {/* 全局颜色选择工具 */}
              <button
                className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 transition-all duration-200 ${currentTool === 'color-select'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-800'
                  }`}
                onClick={() => onToolChange('color-select')}
                title="全局颜色选择工具 - 选择相同颜色的所有像素"
              >
                <svg className="w-6 h-6 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span className="text-xs">同色</span>
              </button>

              {/* 粘贴工具 */}
              <button
                className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 transition-all duration-200 relative ${currentTool === 'paste'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-800'
                  }`}
                onClick={() => onToolChange('paste')}
                title="粘贴工具 - 点击粘贴复制的内容"
              >
                {hasClipboard && (
                  <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full" />
                )}
                <svg className="w-6 h-6 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                <span className="text-xs">粘贴</span>
              </button>

              {/* 画笔工具组 */}
              {brushes.map((brush) => {
                const hasColor = !!brush.color;
                const textColor = hasColor ? getContrastColor(brush.color!) : '';
                const displayName = getBrushDisplayName(brush);

                return (
                  <button
                    key={brush.id}
                    className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 transition-all duration-200 ${
                      currentTool === 'brush' && activeBrushId === brush.id
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                    style={{
                      backgroundColor: brush.color || undefined,
                      color: textColor || undefined,
                    }}
                    onClick={() => {
                      onToolChange('brush');
                      onBrushSelect(brush.id);
                    }}
                    title={`${brush.name} - ${brush.color ? '已设置颜色' : '未设置颜色'}`}
                  >
                    <svg
                      className="w-6 h-6 mb-1"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={textColor || 'currentColor'}
                    >
                      <path
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                    <span className="text-xs font-medium">{displayName}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 右侧：选中时扩展的编辑工具或画笔设置面板 */}
          {(selectionState.selectedCells.size > 0 || currentTool === 'brush') && (
            <div className="ml-4 w-56 border-l border-gray-100 pl-4 flex-shrink-0">
              {currentTool === 'brush' ? (
                // 画笔设置面板
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">{getBrushDisplayName(activeBrush)}设置</span>
                  </div>

                  {/* 颜色选择 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">颜色</span>
                      {activeBrush.productId && availableMaterials && (
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                          {availableMaterials.find(m => m.id === activeBrush.productId)?.code || ''}
                        </span>
                      )}
                    </div>
                    <button
                      className="w-10 h-10 rounded-full border-2 border-gray-300 hover:border-gray-400 transition-all"
                      style={{ backgroundColor: activeBrush.color || '#e5e7eb' }}
                      onClick={onOpenBrushColorPicker}
                      title="点击选择颜色"
                    />
                  </div>

                  {/* 尺寸选择 */}
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-600">尺寸</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={activeBrush.size}
                      onChange={(e) => {
                        const size = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                        onBrushUpdate(activeBrushId, { size });
                      }}
                      className="w-16 border rounded px-2 py-1 text-sm"
                    />
                  </div>
                </div>
              ) : (
                // 选择编辑工具
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-700">编辑工具</span>
                    <button
                      className="text-xs text-gray-500 hover:text-gray-700"
                      onClick={onClearSelection}
                    >
                      清除
                    </button>
                  </div>

                  <div className="flex flex-col items-stretch gap-3">
                    {/* 油漆桶：点击后由上层打开颜色/物料选择窗口（这里触发空色值信号） */}
                    <button
                      className="flex items-center gap-2 px-3 py-2 bg-white border rounded-lg hover:bg-gray-50"
                      onClick={() => onFillSelection('')}
                      title="油漆桶 - 点击以选择颜色/物料"
                    >
                      <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      <span className="text-sm text-gray-700">填充（选择颜色）</span>
                    </button>

                    {/* 复制按钮 */}
                    <button
                      className="flex items-center gap-2 px-3 py-2 bg-white border rounded-lg hover:bg-gray-50"
                      onClick={onCopySelection}
                      title="复制 - 复制选中的像素"
                    >
                      <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm text-gray-700">复制</span>
                    </button>

                    {/* 垃圾桶 */}
                    <button
                      className="flex items-center gap-2 px-3 py-2 bg-white border rounded-lg hover:bg-gray-50"
                      onClick={onDeleteSelection}
                      title="删除 - 移除选中的像素"
                    >
                      <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span className="text-sm text-gray-700">删除</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PixelToolbar;
