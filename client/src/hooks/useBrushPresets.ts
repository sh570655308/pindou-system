import { useState, useEffect } from 'react';

export interface BrushPreset {
  id: number;
  name: string;
  color: string | null;
  productId: number | null;
  size: number;
}

const DEFAULT_BRUSHES: BrushPreset[] = [
  { id: 1, name: '画笔1', color: null, productId: null, size: 1 },
  { id: 2, name: '画笔2', color: null, productId: null, size: 1 },
  { id: 3, name: '画笔3', color: null, productId: null, size: 1 },
  { id: 4, name: '画笔4', color: null, productId: null, size: 1 },
  { id: 5, name: '画笔5', color: null, productId: null, size: 1 },
];

const STORAGE_KEY = 'pixelate_brush_presets';

export function useBrushPresets() {
  const [brushes, setBrushes] = useState<BrushPreset[]>(DEFAULT_BRUSHES);
  const [activeBrushId, setActiveBrushId] = useState<number>(1);

  // 从 localStorage 加载画笔设置
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.brushes && Array.isArray(parsed.brushes)) {
          setBrushes(parsed.brushes);
        }
        if (parsed.activeBrushId) {
          setActiveBrushId(parsed.activeBrushId);
        }
      }
    } catch (e) {
      console.error('Failed to load brush presets:', e);
    }
  }, []);

  // 保存画笔设置到 localStorage
  const saveBrushes = (newBrushes: BrushPreset[], activeId: number) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        brushes: newBrushes,
        activeBrushId: activeId
      }));
    } catch (e) {
      console.error('Failed to save brush presets:', e);
    }
  };

  // 更新画笔设置
  const updateBrush = (id: number, updates: Partial<BrushPreset>) => {
    setBrushes(prev => {
      const newBrushes = prev.map(brush =>
        brush.id === id ? { ...brush, ...updates } : brush
      );
      saveBrushes(newBrushes, activeBrushId);
      return newBrushes;
    });
  };

  // 获取当前激活的画笔
  const activeBrush = brushes.find(b => b.id === activeBrushId) || brushes[0];

  return {
    brushes,
    activeBrushId,
    activeBrush,
    setActiveBrushId: (id: number) => {
      setActiveBrushId(id);
      saveBrushes(brushes, id);
    },
    updateBrush,
    // 从项目数据加载画笔设置
    loadFromProject: (projectBrushes: BrushPreset[], activeId: number) => {
      if (projectBrushes && Array.isArray(projectBrushes) && projectBrushes.length > 0) {
        setBrushes(projectBrushes);
        setActiveBrushId(activeId || 1);
      }
    },
    // 导出画笔设置用于项目保存
    exportForProject: () => ({
      brushes,
      activeBrushId
    })
  };
}
