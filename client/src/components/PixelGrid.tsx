import React, { useRef, useState, useEffect, useCallback } from 'react';

export type PixelCell = {
  hex: string | null;
  productId?: number | null;
};

export type SelectionTool = 'hand' | 'free-select' | 'magic-wand' | 'color-select' | 'paste' | 'brush' | 'eraser';

export interface SelectionState {
  selectedCells: Set<string>; // 使用 "row,col" 作为key
  isSelecting: boolean;
}

interface MaterialInfo {
  id: number;
  code: string;
  name?: string;
  hex?: string;
}

interface PixelGridProps {
  pixels: PixelCell[][]; // [row][col]
  cellSize?: number;
  gap?: number;
  onCellClick?: (cell: PixelCell, row: number, col: number) => void;
  onBackgroundClick?: () => void;
  highlightedProductId?: number | null;
  onPanZoomChange?: (scale: number, translateX: number, translateY: number) => void;
  // 新增的选择相关属性
  currentTool?: SelectionTool;
  selectionState?: SelectionState;
  onSelectionChange?: (newSelection: SelectionState) => void;
  onCellSelect?: (row: number, col: number, mode: 'add' | 'remove' | 'toggle' | 'rect' | 'flood' | 'color') => void;
  // 新增的材料信息，用于显示材料代码
  materials?: MaterialInfo[];
  showMaterialCodes?: boolean;
  darkBackground?: boolean;
  // 画笔相关
  brushSettings?: { color: string | null; productId: number | null; size: number };
  onBrushDraw?: (cells: Array<{ row: number; col: number }>) => void;
  onBrushErase?: (cells: Array<{ row: number; col: number }>) => void;
  onBrushEnd?: () => void; // 画笔完成时的回调
  // 当需要调整 translate 时调用（数组扩展时保持视觉位置稳定）
  onTranslateAdjust?: (dx: number, dy: number) => void;
  // 虚拟坐标偏移：pixels[0][0] 对应的虚拟坐标
  gridOffset?: { row: number; col: number };
}const PixelGrid: React.FC<PixelGridProps> = ({
  pixels,
  cellSize = 20,
  gap = 0,
  onCellClick,
  onBackgroundClick,
  highlightedProductId = null,
  onPanZoomChange,
  currentTool = 'hand',
  selectionState = { selectedCells: new Set(), isSelecting: false },
  onSelectionChange,
  onCellSelect,
  materials = [],
  showMaterialCodes = false, // 默认为 false
  darkBackground = false,
  brushSettings = { color: null, productId: null, size: 1 },
  onBrushDraw,
  onBrushErase,
  onBrushEnd,
  onTranslateAdjust,
  gridOffset = { row: 0, col: 0 },
}) => {

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number>(1);
  const [translate, setTranslate] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panRef = useRef<{ dragging: boolean; startX: number; startY: number; moved?: boolean; viaSpace?: boolean } | null>(null);
  const selectStartRef = useRef<{ row: number; col: number } | null>(null);
  // === 画笔/橡皮擦 共用状态 ===
  const brushDrawingRef = useRef<{ isDrawing: boolean; lastRow: number; lastCol: number }>({
    isDrawing: false,
    lastRow: 0,
    lastCol: 0
  });

  // === Photoshop 风格：按住空格拖拽画布 ===
  // spaceHeldRef 用于事件处理（避免闭包陈旧值），spaceHeld 用于驱动光标重渲染
  const spaceHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
    };
    const isSpaceKey = (e: KeyboardEvent) =>
      e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return;
      // 在输入框/文本域中时，空格正常输入（不拦截）
      if (isEditable(e.target)) return;
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true;
        setSpaceHeld(true);
      }
      // 阻止默认行为：页面滚动 + 按钮被空格激活
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return;
      if (isEditable(e.target)) return;
      if (spaceHeldRef.current) {
        spaceHeldRef.current = false;
        setSpaceHeld(false);
      }
    };
    // 窗口失焦时释放，避免卡住“按住空格”状态
    const onBlur = () => {
      if (spaceHeldRef.current) {
        spaceHeldRef.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const rows = pixels.length;
  const cols = pixels[0]?.length || 0;
  const baseWidth = cols * cellSize;
  const baseHeight = rows * cellSize;

  // === 视口裁剪优化：计算可见的像素范围 ===
  const getVisibleRange = useCallback((): {
    rowStart: number;
    rowEnd: number;
    colStart: number;
    colEnd: number;
  } => {
    // 获取容器尺寸
    const container = containerRef.current;
    if (!container) {
      return { rowStart: 0, rowEnd: rows, colStart: 0, colEnd: cols };
    }
    const rect = container.getBoundingClientRect();

    // 计算可见范围（考虑缩放和偏移）
    const safeScale = Math.max(scale, 0.01);
    const minContentX = -translate.x / safeScale;
    const maxContentX = (rect.width - translate.x) / safeScale;
    const minContentY = -translate.y / safeScale;
    const maxContentY = (rect.height - translate.y) / safeScale;

    // 转换为行列范围（添加一些边距以确保平滑滚动）
    const margin = 2; // 边距行/列数
    const rowStart = Math.max(0, Math.floor(minContentY / cellSize) - margin);
    const rowEnd = Math.min(rows, Math.ceil(maxContentY / cellSize) + margin);
    const colStart = Math.max(0, Math.floor(minContentX / cellSize) - margin);
    const colEnd = Math.min(cols, Math.ceil(maxContentX / cellSize) + margin);

    return { rowStart, rowEnd, colStart, colEnd };
  }, [cellSize, cols, rows, scale, translate]);

  // 计算颜色的亮度值（0-255）
  const getColorBrightness = (hex: string): number => {
    if (!hex) return 255;
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    // 使用相对亮度公式: 0.299*R + 0.587*G + 0.114*B
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };

  // 根据背景色选择文字颜色（黑或白）
  const getTextColor = (backgroundHex: string): string => {
    const brightness = getColorBrightness(backgroundHex);
    return brightness > 128 ? '#000000' : '#ffffff'; // 亮度高于128用黑色，否则用白色
  };

  // 获取材料的代码
  const getMaterialCode = (productId: number | null | undefined): string => {
    if (!productId) return '';
    const material = materials.find(m => m.id === productId);
    return material?.code || '';
  };

  // redraw when pixels/scale/translate change
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    // set canvas size to container size
    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // clear
    ctx.fillStyle = darkBackground ? '#1a1a2e' : '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    // apply pan & zoom
    ctx.save();
    ctx.translate(translate.x, translate.y);
    ctx.scale(scale, scale);

    // compute visible content bounds (in content coordinates) to draw grid in all directions
    const safeScale = Math.max(scale, 0.01);
    const minContentX = -translate.x / safeScale;
    const maxContentX = (rect.width - translate.x) / safeScale;
    const minContentY = -translate.y / safeScale;
    const maxContentY = (rect.height - translate.y) / safeScale;

    // compute column/row range to cover visible area (allow negative start)
    const minCol = Math.floor(minContentX / cellSize);
    const maxCol = Math.ceil(maxContentX / cellSize);
    const minRow = Math.floor(minContentY / cellSize);
    const maxRow = Math.ceil(maxContentY / cellSize);

    // ensure at least a minimum grid size
    const minDisplayCols = Math.max(10, maxCol - minCol);
    const minDisplayRows = Math.max(10, maxRow - minRow);

    const drawStartCol = minCol;
    const drawEndCol = minCol + minDisplayCols - 1 > maxCol - 1 ? (minCol + minDisplayCols - 1) : (maxCol - 1);
    const drawStartRow = minRow;
    const drawEndRow = minRow + minDisplayRows - 1 > maxRow - 1 ? (minRow + minDisplayRows - 1) : (maxRow - 1);

    const totalCols = drawEndCol - drawStartCol + 1;
    const totalRows = drawEndRow - drawStartRow + 1;

    // background for the grid body (covering left/up/right/down visible area)
    ctx.fillStyle = darkBackground ? '#2a2a3e' : '#f9fafb';
    ctx.fillRect(drawStartCol * cellSize, drawStartRow * cellSize, totalCols * cellSize, totalRows * cellSize);

    // draw actual pixel cells (only where pixels exist). skip null cells (transparent/removed)
    if (rows > 0 && cols > 0) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = pixels[r][c];
          if (cell.hex == null) continue;

          // add shadow effect for colored pixels to enhance visual distinction
          ctx.save();
          // adjust shadow intensity based on zoom level - stronger shadows when zoomed in
          const shadowIntensity = Math.min(0.4, 0.2 + scale * 0.1);
          ctx.shadowColor = `rgba(0,0,0,${shadowIntensity})`;
          ctx.shadowBlur = Math.max(2, Math.min(8, 3 * scale));
          ctx.shadowOffsetX = Math.max(0.3, Math.min(2, 0.5 * scale));
          ctx.shadowOffsetY = Math.max(0.3, Math.min(2, 0.5 * scale));
          ctx.fillStyle = cell.hex;
          ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
          ctx.restore();

          // 绘制材料代码文字
          const materialCode = getMaterialCode(cell.productId);
          if (showMaterialCodes && materialCode) {
            ctx.save();
            const textColor = getTextColor(cell.hex);
            ctx.fillStyle = textColor;
            // 根据cellSize调整字体大小，确保文字不会太大
            const fontSize = Math.min(cellSize * 0.6, Math.max(8, cellSize * 0.4));
            ctx.font = `bold ${fontSize}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // 在单元格中心绘制文字
            const centerX = c * cellSize + cellSize / 2;
            const centerY = r * cellSize + cellSize / 2;
            ctx.fillText(materialCode, centerX, centerY);
            ctx.restore();
          }
        }
      }
    }

    // thin grid lines across full background (including negative/left/up)
    ctx.lineWidth = 0.5 / Math.max(scale, 1);
    ctx.strokeStyle = darkBackground ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    for (let r = drawStartRow; r <= drawEndRow + 1; r++) {
      const y = r * cellSize;
      ctx.beginPath();
      ctx.moveTo(drawStartCol * cellSize, y);
      ctx.lineTo((drawEndCol + 1) * cellSize, y);
      ctx.stroke();
    }
    for (let c = drawStartCol; c <= drawEndCol + 1; c++) {
      const x = c * cellSize;
      ctx.beginPath();
      ctx.moveTo(x, drawStartRow * cellSize);
      ctx.lineTo(x, (drawEndRow + 1) * cellSize);
      ctx.stroke();
    }

    // darker/thicker grid lines every 10 (cover negative indices too)
    ctx.lineWidth = 1.5 / Math.max(scale, 1);
    ctx.strokeStyle = darkBackground ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.28)';
    const majorRowStart = Math.floor(drawStartRow / 10) * 10;
    const majorColStart = Math.floor(drawStartCol / 10) * 10;
    for (let r = majorRowStart; r <= drawEndRow + 1; r += 10) {
      const y = r * cellSize;
      ctx.beginPath();
      ctx.moveTo(drawStartCol * cellSize, y);
      ctx.lineTo((drawEndCol + 1) * cellSize, y);
      ctx.stroke();
    }
    for (let c = majorColStart; c <= drawEndCol + 1; c += 10) {
      const x = c * cellSize;
      ctx.beginPath();
      ctx.moveTo(x, drawStartRow * cellSize);
      ctx.lineTo(x, (drawEndRow + 1) * cellSize);
      ctx.stroke();
    }

    // (axis labels for the grid body removed; header labels drawn below)

    // highlight logic: dim non-highlighted
    if (highlightedProductId != null) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = pixels[r][c];
          // skip empty (removed) cells from highlight/dimming
          if (cell.hex == null) continue;
          if (cell.productId !== highlightedProductId) {
            ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
          } else {
            // draw subtle shadow for highlighted
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.25)';
            ctx.shadowBlur = 6 / Math.max(scale, 1);
            ctx.fillStyle = cell.hex || '#FFFFFF';
            ctx.fillRect(c * cellSize + 0.5, r * cellSize + 0.5, cellSize - 1, cellSize - 1);
            ctx.restore();
          }
        }
      }
    }

    // selection highlight: draw selection borders and overlays
    if (selectionState.selectedCells.size > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)'; // blue-500
      ctx.lineWidth = 2 / Math.max(scale, 1);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)'; // semi-transparent blue overlay

      // iterate selected cells directly so selections outside current pixels bounds are rendered too
      for (const cellKey of Array.from(selectionState.selectedCells)) {
        const parts = cellKey.split(',');
        if (parts.length !== 2) continue;
        const vr = parseInt(parts[0], 10); // virtual row
        const vc = parseInt(parts[1], 10); // virtual col
        if (Number.isNaN(vr) || Number.isNaN(vc)) continue;
        // 虚拟坐标转数组索引用于渲染（canvas 以数组索引为坐标绘制）
        const ar = vr - gridOffset.row;
        const ac = vc - gridOffset.col;
        ctx.fillRect(ac * cellSize, ar * cellSize, cellSize, cellSize);
        ctx.strokeRect(ac * cellSize, ar * cellSize, cellSize, cellSize);
      }
      ctx.restore();
    }

    // hover highlight removed: no per-cell hover overlay is drawn anymore

    ctx.restore();

    if (onPanZoomChange) onPanZoomChange(scale, translate.x, translate.y);
  }, [pixels, scale, translate, rows, cols, cellSize, highlightedProductId, onPanZoomChange, selectionState, currentTool, darkBackground, showMaterialCodes, materials]);

  // center content when pixels first set (only if translate is default)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // only center when translate is near zero
    if ((translate.x === 0 && translate.y === 0) && rows > 0 && cols > 0) {
      const rect = container.getBoundingClientRect();
      const contentW = cols * cellSize * scale;
      const contentH = rows * cellSize * scale;
      const tx = Math.max(0, (rect.width - contentW) / 2);
      const ty = Math.max(0, (rect.height - contentH) / 2);
      setTranslate({ x: tx, y: ty });
    }
  }, [pixels, rows, cols, cellSize, scale]);

  // 将屏幕坐标转换为虚拟坐标
  // 虚拟坐标 = 数组索引 + gridOffset，这样 handleBrushDraw/handleClick 中 row - gridOffset 就能得到正确的数组索引
  const screenToVirtual = (clientX: number, clientY: number, container: HTMLDivElement): { row: number; col: number } => {
    const rect = container.getBoundingClientRect();
    const x = (clientX - rect.left - translate.x) / scale;
    const y = (clientY - rect.top - translate.y) / scale;
    const col = Math.floor(x / cellSize) + gridOffset.col;
    const row = Math.floor(y / cellSize) + gridOffset.row;
    return { row, col };
  };

  // handle wheel zoom centered
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.12 : 0.88;
    const newScale = Math.min(8, Math.max(0.2, +(scale * factor).toFixed(3)));
    // get cursor in container coords
    const container = containerRef.current;
    if (!container) {
      setScale(newScale);
      return;
    }
    const rect = container.getBoundingClientRect();
    const cx = (e.clientX - rect.left - translate.x) / scale;
    const cy = (e.clientY - rect.top - translate.y) / scale;
    // adjust translate so focal point remains at same screen position
    const newTx = e.clientX - rect.left - cx * newScale;
    const newTy = e.clientY - rect.top - cy * newScale;
    setScale(newScale);
    setTranslate({ x: newTx, y: newTy });
  };

  // Bresenham直线算法，用于画笔连续绘画
  // 参数：r0/c0 和 r1/c1 是行列坐标
  const getLineCells = (r0: number, c0: number, r1: number, c1: number): Array<{ row: number; col: number }> => {
    const cells: Array<{ row: number; col: number }> = [];
    const dr = Math.abs(r1 - r0);
    const dc = Math.abs(c1 - c0);
    const sr = r0 < r1 ? 1 : -1;
    const sc = c0 < c1 ? 1 : -1;
    let err = dr - dc;

    let r = r0;
    let c = c0;

    while (true) {
      cells.push({ row: r, col: c });
      if (r === r1 && c === c1) break;
      const e2 = 2 * err;
      if (e2 > -dc) { err -= dc; r += sr; }
      if (e2 < dr) { err += dr; c += sc; }
    }
    return cells;
  };

  // 计算画笔/橡皮擦覆盖的单元格
  const getBrushCells = (centerRow: number, centerCol: number, size: number): Array<{ row: number; col: number }> => {
    const cells: Array<{ row: number; col: number }> = [];
    const half = Math.floor(size / 2);
    for (let dr = -half; dr < size - half; dr++) {
      for (let dc = -half; dc < size - half; dc++) {
        cells.push({ row: centerRow + dr, col: centerCol + dc });
      }
    }
    return cells;
  };

  // 判断当前是否为画笔或橡皮擦工具
  const isBrushTool = currentTool === 'brush' || currentTool === 'eraser';

  // 按住空格时，任意工具都切换为平移（Photoshop 风格）
  // pointer handlers
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;

    // 空格拖拽优先级最高，任何工具下都进入平移
    if (spaceHeldRef.current) {
      panRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, moved: false, viaSpace: true } as any;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      return;
    }

    if (currentTool === 'hand') {
      panRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, moved: false, viaSpace: false } as any;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } else if (isBrushTool) {
      const container = containerRef.current;
      if (!container) return;
      const { row, col } = screenToVirtual(e.clientX, e.clientY, container);

      brushDrawingRef.current = { isDrawing: true, lastRow: row, lastCol: col };

      const cells = getBrushCells(row, col, brushSettings.size);
      if (cells.length > 0) {
        if (currentTool === 'brush') onBrushDraw?.(cells);
        else onBrushErase?.(cells);
      }

      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // panning: hand 工具 或 空格拖拽（viaSpace）
    const pan = panRef.current;
    const isPanning = !!(pan && pan.dragging &&
      (currentTool === 'hand' || (pan as any).viaSpace));
    if (isPanning && pan) {
      const dx = e.clientX - pan.startX;
      const dy = e.clientY - pan.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) pan.moved = true;
      setTranslate((t) => ({ x: t.x + dx, y: t.y + dy }));
      pan.startX = e.clientX;
      pan.startY = e.clientY;
    }

    // brush/eraser: continuous drawing
    if (brushDrawingRef.current.isDrawing && isBrushTool) {
      const container = containerRef.current;
      if (!container) return;
      const { row, col } = screenToVirtual(e.clientX, e.clientY, container);
      const { lastRow, lastCol } = brushDrawingRef.current;

      if (row !== lastRow || col !== lastCol) {
        // Bresenham 插值确保连续线条
        const lineCells = getLineCells(lastRow, lastCol, row, col);
        // 扩展到画笔尺寸
        const expandedCells: Array<{ row: number; col: number }> = [];
        const size = brushSettings.size;
        lineCells.forEach(cell => {
          const half = Math.floor(size / 2);
          for (let dr = -half; dr < size - half; dr++) {
            for (let dc = -half; dc < size - half; dc++) {
              expandedCells.push({ row: cell.row + dr, col: cell.col + dc });
            }
          }
        });

        if (expandedCells.length > 0) {
          if (currentTool === 'brush') onBrushDraw?.(expandedCells);
          else onBrushErase?.(expandedCells);
        }

        brushDrawingRef.current.lastRow = row;
        brushDrawingRef.current.lastCol = col;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    // 空格拖拽结束：清除 panRef（无需依赖 currentTool）
    if (panRef.current && (panRef.current as any).viaSpace) {
      panRef.current.dragging = false;
      panRef.current = null;
    } else if (currentTool === 'hand' && panRef.current) {
      panRef.current.dragging = false;
    } else if (isBrushTool && brushDrawingRef.current.isDrawing) {
      brushDrawingRef.current.isDrawing = false;
      onBrushEnd?.();
    }
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch (err) { }
  };

  // handle clicks: compute virtual cell and handle based on current tool
  const handleClick = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;

    // 空格仍按住时，点击不触发任何单元格操作（仅在拖拽画布）
    if (spaceHeldRef.current) return;

    const { row, col } = screenToVirtual(e.clientX, e.clientY, container);

    // if a pan occurred just before click, ignore as it's likely a drag
    if (panRef.current && (panRef.current as any).moved) {
      (panRef.current as any).moved = false;
      return;
    }

    // if outside grid bounds (convert to array index for bounds check):
    const arrRow = row - gridOffset.row;
    const arrCol = col - gridOffset.col;
    if (arrRow < 0 || arrRow >= rows || arrCol < 0 || arrCol >= cols) {
      if (currentTool === 'hand') {
        // hand tool: background click
        onBackgroundClick?.();
      } else if (currentTool === 'free-select') {
        // allow selecting cells outside current pixels (e.g., expanded area)
        handleFreeSelect(arrRow, arrCol, e);
      }
      // magic-wand, color-select, brush, paste: out-of-bounds does nothing
      return;
    }

    const cell = pixels[arrRow][arrCol];

    // handle based on current tool
    if (currentTool === 'hand') {
      // hand tool: original behavior
      if (cell.hex == null) {
        onBackgroundClick?.();
      } else {
        onCellClick?.(cell, row, col);
      }
    } else if (currentTool === 'paste') {
      // paste tool: call onCellClick to trigger paste
      onCellClick?.(cell, row, col);
    } else if (currentTool === 'free-select') {
      // free select tool: handle selection
      handleFreeSelect(arrRow, arrCol, e);
    } else if (currentTool === 'magic-wand') {
      // magic wand tool: flood fill selection (use array index)
      handleMagicWand(arrRow, arrCol);
    } else if (currentTool === 'color-select') {
      // color select tool: select all cells with same color (use array index)
      handleColorSelect(arrRow, arrCol);
    }
  };

  const handleColorSelect = (row: number, col: number) => {
    if (row < 0 || row >= rows || col < 0 || col >= cols || !pixels[row] || !pixels[row][col]) return;
    onCellSelect?.(row, col, 'color');
  };

  // free select tool logic
  const handleFreeSelect = (row: number, col: number, e: React.MouseEvent) => {
    const cellKey = `${row},${col}`;

    let mode: 'add' | 'remove' | 'toggle' | 'rect' = 'toggle';

    if (e.ctrlKey || e.metaKey) {
      mode = 'add'; // ctrl/cmd: add to selection
    } else if (e.altKey) {
      mode = 'remove'; // alt: remove from selection
    } else if (e.shiftKey && selectStartRef.current) {
      mode = 'rect'; // shift: rectangle selection
    }

    if (mode === 'rect' && selectStartRef.current) {
      // rectangle selection from start to current
      const startRow = Math.min(selectStartRef.current.row, row);
      const endRow = Math.max(selectStartRef.current.row, row);
      const startCol = Math.min(selectStartRef.current.col, col);
      const endCol = Math.max(selectStartRef.current.col, col);

      const newSelection = new Set(selectionState.selectedCells);
      // add all cells in rect (including empty/out-of-bounds)
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          newSelection.add(`${r},${c}`);
        }
      }
      onSelectionChange?.({ selectedCells: newSelection, isSelecting: false });
      selectStartRef.current = null;
    } else if (mode === 'add') {
      const newSelection = new Set(selectionState.selectedCells);
      newSelection.add(cellKey);
      onSelectionChange?.({ selectedCells: newSelection, isSelecting: false });
    } else if (mode === 'remove') {
      const newSelection = new Set(selectionState.selectedCells);
      newSelection.delete(cellKey);
      onSelectionChange?.({ selectedCells: newSelection, isSelecting: false });
    } else {
      // toggle: start rectangle selection
      const newSelection = selectionState.selectedCells.has(cellKey)
        ? new Set(Array.from(selectionState.selectedCells).filter(k => k !== cellKey))
        : new Set([...Array.from(selectionState.selectedCells), cellKey]);
      onSelectionChange?.({ selectedCells: newSelection, isSelecting: false });
      selectStartRef.current = { row, col };
    }
  };

  // magic wand tool: flood fill selection of same color
  const handleMagicWand = (row: number, col: number) => {
    const cell = pixels[row][col];
    if (cell.hex == null) return;

    const targetColor = cell.hex;
    const visited = new Set<string>();
    const toVisit = [{ row, col }];
    const selected = new Set<string>();

    while (toVisit.length > 0) {
      const { row: r, col: c } = toVisit.pop()!;
      const key = `${r},${c}`;

      if (visited.has(key)) continue;
      visited.add(key);

      const currentCell = pixels[r]?.[c];
      if (!currentCell || currentCell.hex !== targetColor) continue;

      // 存虚拟坐标（数组索引 + gridOffset）
      selected.add(`${r + gridOffset.row},${c + gridOffset.col}`);

      // add adjacent cells (4-way connectivity)
      const directions = [
        { dr: -1, dc: 0 }, // up
        { dr: 1, dc: 0 },  // down
        { dr: 0, dc: -1 }, // left
        { dr: 0, dc: 1 }   // right
      ];

      for (const { dr, dc } of directions) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const neighborKey = `${nr},${nc}`;
          if (!visited.has(neighborKey)) {
            toVisit.push({ row: nr, col: nc });
          }
        }
      }
    }

    onSelectionChange?.({ selectedCells: selected, isSelecting: false });
  };

  return (
    <div ref={containerRef} className="relative w-full h-full touch-none" style={{ overflow: 'hidden', backgroundColor: darkBackground ? '#1a1a2e' : '#ffffff' }}>
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleClick}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: spaceHeld
            ? (panRef.current?.dragging ? 'grabbing' : 'grab')
            : currentTool === 'hand'
              ? (panRef.current?.dragging ? 'grabbing' : 'grab')
              : currentTool === 'free-select'
                ? 'crosshair'
                : currentTool === 'magic-wand'
                  ? 'copy'
                  : currentTool === 'paste'
                    ? 'cell'
                    : currentTool === 'brush'
                      ? 'crosshair'
                      : currentTool === 'eraser'
                        ? 'crosshair'
                        : 'default'
        }}
      />
    </div>
  );
};

export default PixelGrid;


