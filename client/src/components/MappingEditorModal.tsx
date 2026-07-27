import React, { useState, useRef } from 'react';
import MaterialPickerModal, { MaterialItem } from './MaterialPickerModal';

export interface MappingEntry {
  productId: number | null;
  code: string;
  hex: string;
  count: number;
}

export interface MappingChange {
  productId: number;
  hex: string;
}

interface MappingEditorModalProps {
  visible: boolean;
  entries: MappingEntry[];
  availableMaterials: MaterialItem[];
  onClose: () => void;
  onApply: (changes: Map<number | string, MappingChange>) => void;
}

/**
 * 映射关系编辑弹窗：
 * 列出像素化结果中每个颜色/物料的映射，用户可以把任意一个重新映射到别的物料。
 * 复用 MaterialPickerModal 做物料选择。
 */
const MappingEditorModal: React.FC<MappingEditorModalProps> = ({ visible, entries, availableMaterials, onClose, onApply }) => {
  // 拖拽
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 200, top: 80 });
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);

  // 当前正在编辑哪一行（用 entry key）
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // MaterialPickerModal 的位置
  const [pickerPos, setPickerPos] = useState<{ left: number; top: number }>({ left: 400, top: 120 });

  // 修改记录：key(原productId或hex) → { productId, hex, code }
  const [changes, setChanges] = useState<Map<string, MappingChange & { code: string }>>(new Map());

  if (!visible) return null;

  // 为每个 entry 生成唯一 key
  const entryKey = (e: MappingEntry) =>
    typeof e.productId === 'number' ? `p:${e.productId}` : `h:${(e.hex || '').toLowerCase()}`;

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: pos.left, startTop: pos.top };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const newLeft = dragRef.current.startLeft + (e.clientX - dragRef.current.startX);
    const newTop = dragRef.current.startTop + (e.clientY - dragRef.current.startY);
    setPos({
      left: Math.max(0, Math.min(window.innerWidth - 560, newLeft)),
      top: Math.max(0, Math.min(window.innerHeight - 200, newTop)),
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch (err) {}
  };

  const handleStartEdit = (e: MappingEntry, idx: number) => {
    const key = entryKey(e);
    setEditingKey(key);
    // 把 picker 放到弹窗右侧
    setPickerPos({ left: Math.min(window.innerWidth - 540, pos.left + 460), top: pos.top + idx * 48 });
  };

  const handlePickerConfirm = (productId: number, hex: string) => {
    if (!editingKey) return;
    const mat = availableMaterials.find((m) => m.id === productId);
    const newChanges = new Map(changes);
    newChanges.set(editingKey, { productId, hex, code: mat?.code || String(productId) });
    setChanges(newChanges);
    setEditingKey(null);
  };

  const handlePickerClose = () => {
    setEditingKey(null);
  };

  const handleResetRow = (e: MappingEntry) => {
    const key = entryKey(e);
    if (changes.has(key)) {
      const newChanges = new Map(changes);
      newChanges.delete(key);
      setChanges(newChanges);
    }
  };

  const handleConfirm = () => {
    // 把内部 changes（key 带 p:/h: 前缀）转成 onApply 需要的格式
    const result = new Map<number | string, MappingChange>();
    changes.forEach((v, k) => {
      if (k.startsWith('p:')) result.set(Number(k.slice(2)), { productId: v.productId, hex: v.hex });
      else result.set(k.slice(2), { productId: v.productId, hex: v.hex });
    });
    onApply(result);
    setChanges(new Map());
  };

  const handleCancel = () => {
    setChanges(new Map());
    setEditingKey(null);
    onClose();
  };

  const changeCount = changes.size;
  const totalPixels = entries.reduce((s, e) => s + (e.count || 0), 0);

  return (
    <>
      <div className="fixed z-50" style={{ left: pos.left, top: pos.top, width: 560 }}>
        <div className="bg-white rounded-lg shadow-2xl border border-gray-300" style={{ width: 560 }}>
          {/* 标题栏 */}
          <div
            className="flex items-center justify-between px-4 py-3 cursor-move bg-gray-50 border-b border-gray-200 rounded-t-lg"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <div className="flex items-center space-x-2">
              <span className="font-medium text-gray-800">编辑颜色映射</span>
              <span className="text-xs text-gray-400">({entries.length} 种颜色 · {totalPixels} 像素)</span>
            </div>
            <button className="text-gray-400 hover:text-gray-600 text-xl leading-none" onClick={handleCancel} title="关闭">×</button>
          </div>

          {/* 说明 */}
          <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
            <span className="text-xs text-blue-700">点击「换色」可将该颜色重新映射到其他物料，支持修改多个后统一确认。</span>
          </div>

          {/* 列表 */}
          <div className="p-3" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            <div className="space-y-1">
              {entries.map((e, idx) => {
                const key = entryKey(e);
                const change = changes.get(key);
                const isEditing = editingKey === key;
                const pct = totalPixels > 0 ? (e.count / totalPixels * 100).toFixed(1) : '0';
                return (
                  <div
                    key={key}
                    className={`flex items-center justify-between p-2 rounded border transition-colors ${
                      isEditing ? 'border-blue-400 bg-blue-50' : change ? 'border-green-300 bg-green-50' : 'border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    {/* 左侧：当前映射 */}
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <div className="w-7 h-7 rounded border border-gray-300 flex-shrink-0" style={{ backgroundColor: e.hex || '#ddd' }} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-700 truncate">{e.code}</div>
                          <div className="text-xs text-gray-400">{e.count} 像素 ({pct}%)</div>
                        </div>
                      </div>
                    </div>

                    {/* 中间：箭头 + 新映射（如果有） */}
                    {change && (
                      <div className="flex items-center space-x-2 mx-3">
                        <span className="text-gray-400">→</span>
                        <div className="w-7 h-7 rounded border border-green-400 flex-shrink-0" style={{ backgroundColor: change.hex }} />
                        <span className="text-sm font-medium text-green-700">{change.code}</span>
                      </div>
                    )}

                    {/* 右侧：操作按钮 */}
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <button
                        className="px-2 py-1 text-xs rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                        onClick={() => handleStartEdit(e, idx)}
                      >
                        换色
                      </button>
                      {change && (
                        <button
                          className="px-2 py-1 text-xs rounded bg-gray-50 text-gray-500 hover:bg-gray-100"
                          onClick={() => handleResetRow(e)}
                          title="撤销修改"
                        >
                          ↩
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {entries.length === 0 && <div className="text-gray-400 text-sm text-center py-4">暂无颜色数据</div>}
            </div>
          </div>

          {/* 底部 */}
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50 rounded-b-lg">
            <div className="text-sm text-gray-500">
              {changeCount > 0 ? <span className="text-green-600 font-medium">已修改 {changeCount} 项</span> : '未做修改'}
            </div>
            <div className="flex space-x-2">
              <button className="px-4 py-1.5 text-sm rounded bg-gray-100 text-gray-600 hover:bg-gray-200" onClick={handleCancel}>取消</button>
              <button
                className={`px-4 py-1.5 text-sm rounded text-white ${changeCount > 0 ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'}`}
                onClick={handleConfirm}
                disabled={changeCount === 0}
              >
                确认 ({changeCount})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 复用已有的物料选择弹窗 */}
      <MaterialPickerModal
        visible={editingKey !== null}
        initialPos={pickerPos}
        availableMaterials={availableMaterials}
        onClose={handlePickerClose}
        onSelectPreview={() => {}}
        onConfirm={handlePickerConfirm}
      />
    </>
  );
};

export default MappingEditorModal;
