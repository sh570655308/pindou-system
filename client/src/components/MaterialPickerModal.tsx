import React, { useState, useRef } from 'react';

export interface MaterialItem {
  id: number;
  code: string;
  color_hex?: string | null;
  name?: string;
  category_name?: string;
}

interface MaterialPickerModalProps {
  visible: boolean;
  initialPos?: { left: number; top: number };
  availableMaterials: MaterialItem[];
  onClose: () => void;
  onSelectPreview: (productId: number | null, hex: string | null) => void;
  onConfirm: (productId: number, hex: string) => void;
}

const MaterialPickerModal: React.FC<MaterialPickerModalProps> = ({ visible, initialPos, availableMaterials, onClose, onSelectPreview, onConfirm }) => {
  const [pos, setPos] = useState<{ left: number; top: number }>(initialPos || { left: 120, top: 120 });
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState<string>('');

  if (!visible) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX - pos.left, startY: e.clientY - pos.top };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const newLeft = e.clientX - dragRef.current.startX;
    const newTop = e.clientY - dragRef.current.startY;
    setPos({ left: Math.max(0, Math.min(window.innerWidth - 220, newLeft)), top: Math.max(0, Math.min(window.innerHeight - 120, newTop)) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch (err) {}
  };

  const handleSelect = (item: MaterialItem) => {
    setSelectedId(item.id);
    onSelectPreview(item.id, item.color_hex || null);
  };

  const handleConfirm = () => {
    if (!selectedId) return;
    const item = availableMaterials.find((m) => m.id === selectedId);
    if (!item) return;
    onConfirm(item.id, item.color_hex || '#000000');
  };

  const handleCancel = () => {
    onSelectPreview(null, null);
    setSelectedId(null);
    onClose();
  };

  const filtered = availableMaterials.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (m.code || '').toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q) || (m.category_name || '').toLowerCase().includes(q);
  });

  return (
    <div
      className="fixed z-60"
      style={{ left: pos.left, top: pos.top, width: collapsed ? 48 : 520 }}
    >
      {collapsed ? (
        <div
          className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center cursor-pointer"
          onClick={() => setCollapsed(false)}
          title="恢复选择器"
        >
          <svg className="w-6 h-6 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 4v16M4 12h16"/></svg>
        </div>
      ) : (
        <div className="bg-white rounded shadow-xl border border-gray-200" style={{ width: 520 }}>
          <div
            className="flex items-center justify-between px-3 py-2 cursor-move bg-gray-50 border-b border-gray-100"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <div className="font-medium">选择物料 / 颜色</div>
            <div className="flex items-center space-x-2">
              <button className="text-sm text-gray-600" onClick={() => setCollapsed(true)} title="最小化">—</button>
              <button className="text-sm text-gray-600" onClick={handleCancel} title="关闭">×</button>
            </div>
          </div>

          <div className="p-3" style={{ maxHeight: 360, overflow: 'auto' }}>
            <div className="mb-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="按物料编号或名称筛选"
                className="w-full border rounded p-2 text-sm"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerMove={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
              />
            </div>
            <div className="grid grid-cols-8 gap-3">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  className={`flex flex-col items-center justify-center p-2 rounded border ${selectedId === m.id ? 'border-blue-500' : 'border-gray-200'}`}
                  onClick={() => handleSelect(m)}
                >
                  <div className="w-10 h-10 rounded-full border" style={{ backgroundColor: m.color_hex || '#ffffff' }} />
                  <div className="text-xs text-gray-600 mt-1">{m.code}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-end space-x-2 bg-white">
            <button className="px-3 py-1 bg-gray-100 rounded" onClick={handleCancel}>取消</button>
            <button className={`px-3 py-1 rounded text-white ${selectedId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'}`} onClick={handleConfirm} disabled={!selectedId}>确认</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaterialPickerModal;


