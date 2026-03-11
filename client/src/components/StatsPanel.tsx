import React, { useState, useRef, useEffect } from 'react';

interface MaterialStat {
  productId?: number | null;
  code: string;
  hex?: string;
  count: number;
}

interface StatsPanelProps {
  visible: boolean;
  onClose?: () => void;
  stats: MaterialStat[];
  totalCells?: number;
  onSelectMaterial?: (productId?: number | null) => void;
  draggable?: boolean;
  initialPos?: { left?: number; top?: number };
  highlightedProductId?: number | null;
}

const StatsPanel: React.FC<StatsPanelProps> = ({ visible, onClose, stats, totalCells = 0, onSelectMaterial, draggable = true, initialPos, highlightedProductId }) => {
  const [pos, setPos] = useState<{ left: number; top: number }>(() => {
    try {
      const raw = localStorage.getItem('pixelate_stats_pos');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.left === 'number' && typeof parsed.top === 'number') return { left: parsed.left, top: parsed.top };
      }
    } catch (err) {}
    return { left: initialPos?.left ?? Math.max(20, window.innerWidth - 320 - 20), top: initialPos?.top ?? 80 };
  });
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos((p) => ({ left: Math.max(0, p.left + dx), top: Math.max(0, p.top + dy) }));
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current.dragging = false;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch (err) {}
  };
  // persist on pos change
  useEffect(() => {
    try { localStorage.setItem('pixelate_stats_pos', JSON.stringify(pos)); } catch (err) {}
  }, [pos]);

  if (!visible) return null;

  return (
    <div
      className="fixed w-80 bg-white/90 backdrop-blur-sm shadow-xl rounded overflow-hidden z-50 transition-transform hover:scale-105"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="p-3 border-b flex items-center justify-between" {...(draggable ? { onPointerDown, onPointerMove, onPointerUp } : {})}>
        <div>
          <div className="text-sm text-gray-500">颜色数量</div>
          <div className="text-xl font-bold">{stats.length}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500">总豆数</div>
          <div className="text-xl font-bold">{totalCells}</div>
        </div>
      </div>
      <div className="p-2">
        <button className="text-sm text-gray-600 mb-2" onClick={onClose}>关闭</button>
        <div className="space-y-2 max-h-[60vh] overflow-auto">
          {stats.map((m) => {
            const isHighlighted = highlightedProductId !== null && m.productId === highlightedProductId;
            return (
              <div
                key={`${m.productId}-${m.code}`}
                className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                  isHighlighted ? 'bg-blue-100 border border-blue-300' : 'hover:bg-gray-50'
                }`}
                onClick={() => onSelectMaterial?.(m.productId)}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-6 h-6 rounded-full border ${isHighlighted ? 'ring-2 ring-blue-400' : ''}`} style={{ backgroundColor: m.hex || '#ddd' }} />
                  <div className="text-sm">{m.code}</div>
                </div>
                <div className="text-sm text-gray-600">{m.count}</div>
              </div>
            );
          })}
          {stats.length === 0 && <div className="text-gray-500 p-2">暂无颜色</div>}
        </div>
      </div>
    </div>
  );
};

export default StatsPanel;


