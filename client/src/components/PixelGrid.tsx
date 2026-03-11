import React, { useRef, useState, useEffect, useCallback } from 'react';

export type PixelCell = {
  hex: string | null;
  productId?: number | null;
};

export type SelectionTool = 'hand' | 'free-select' | 'magic-wand' | 'color-select' | 'paste' | 'brush';

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
  showMaterialCodes?: boolean; // 新增：是否显示物料代码开关
  // 画笔相关
  brushSettings?: { color: string | null; productId: number | null; size: number };
  onBrushDraw?: (cells: Array<{ row: number; col: number }>) => void;
  onBrushEnd?: () => void; // 画笔完成时的回调
}

const PixelGrid: React.FC<PixelGridProps> = ({
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
  brushSettings = { color: null, productId: null, size: 1 },
  onBrushDraw,
  onBrushEnd,
}) => {

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number>(1);
  const [translate, setTranslate] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panRef = useRef<{ dragging: boolean; startX: number; startY: number; moved?: boolean } | null>(null);
  const selectStartRef = useRef<{ row: number; col: number } | null>(null);
  const brushDrawingRef = useRef<{ isDrawing: boolean; lastRow: number | null; lastCol: number | null }>({
    isDrawing: false,
    lastRow: null,
    lastCol: null
  });

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
    const headerW = Math.max(36, Math.floor(cellSize * 1.6));
    const headerH = Math.max(24, Math.floor(cellSize * 1.2));

    // 获取容器尺寸
    const container = containerRef.current;
    if (!container) {
      return { rowStart: 0, rowEnd: rows, colStart: 0, colEnd: cols };
    }
    const rect = container.getBoundingClientRect();

    // 计算可见范围（考虑缩放和偏移）
    const minContentX = (-headerW - translate.x) / Math.max(scale, 1);
    const maxContentX = (rect.width - headerW - translate.x) / Math.max(scale, 1);
    const minContentY = (-headerH - translate.y) / Math.max(scale, 1);
    const maxContentY = (rect.height - headerH - translate.y) / Math.max(scale, 1);

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
    ctx.clearRect(0, 0, rect.width, rect.height);
    // reserve header space for axis labels
    const headerW = Math.max(36, Math.floor(cellSize * 1.6));
    const headerH = Math.max(24, Math.floor(cellSize * 1.2));
    // apply pan & zoom with header offset
    ctx.save();
    ctx.translate(translate.x + headerW, translate.y + headerH);
    ctx.scale(scale, scale);

    // compute visible content bounds (in content coordinates) to draw grid in all directions
    const minContentX = (-headerW - translate.x) / Math.max(scale, 1);
    const maxContentX = (rect.width - headerW - translate.x) / Math.max(scale, 1);
    const minContentY = (-headerH - translate.y) / Math.max(scale, 1);
    const maxContentY = (rect.height - headerH - translate.y) / Math.max(scale, 1);

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
    ctx.fillStyle = '#f9fafb';
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
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
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
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
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
        const r = parseInt(parts[0], 10);
        const c = parseInt(parts[1], 10);
        if (Number.isNaN(r) || Number.isNaN(c)) continue;
        // draw overlay regardless of whether pixel exists or has color
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        ctx.strokeRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
      ctx.restore();
    }

    // hover highlight removed: no per-cell hover overlay is drawn anymore

    ctx.restore();

    // draw axis labels in header area (outside scaled/translated content)
    // ensure labels sit above image and have white background for readability
    ctx.fillStyle = 'rgba(55,65,81,0.95)';
    const fontSize = Math.max(10, Math.floor(cellSize * 0.45));
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = 'middle';
    // compute origin for labels
    const originX = headerW + translate.x;
    const originY = headerH + translate.y;
    // top labels (column indices)
    ctx.textAlign = 'center';
    const labelDrawCols = Math.max(10, Math.floor((rect.width - headerW) / cellSize));
    const labelCount = cols > 0 ? cols : labelDrawCols;
    for (let c = 0; c < labelCount; c++) {
      const text = String(c + 1);
      const x = originX + (c * cellSize + cellSize / 2) * scale;
      const y = headerH / 2;
      // measure text and draw white background rect behind it
      const metrics = ctx.measureText(text);
      const textW = metrics.width;
      const padX = 6;
      const padY = 4;
      const rectW = textW + padX * 2;
      const rectH = fontSize + padY * 2;
      const rectX = Math.round(x - rectW / 2);
      const rectY = Math.round(y - rectH / 2);
      ctx.fillStyle = 'white';
      ctx.fillRect(rectX, rectY, rectW, rectH);
      // draw text on top
      ctx.fillStyle = 'rgba(55,65,81,0.95)';
      ctx.fillText(text, x, y);
    }
    // left labels (row indices) starting from 1, align right inside header
    ctx.textAlign = 'right';
    for (let r = 0; r < (rows > 0 ? rows : Math.max(10, Math.floor((rect.height - headerH) / cellSize))); r++) {
      const text = String(r + 1);
      const y = originY + (r * cellSize + cellSize / 2) * scale;
      // align the rect to the right inside header (small right padding)
      const metrics = ctx.measureText(text);
      const textW = metrics.width;
      const padX = 6;
      const padY = 4;
      const rectW = textW + padX * 2;
      const rectH = fontSize + padY * 2;
      const rectRight = headerW - 6; // existing x for right alignment
      const rectX = Math.round(rectRight - rectW);
      const rectY = Math.round(y - rectH / 2);
      ctx.fillStyle = 'white';
      ctx.fillRect(rectX, rectY, rectW, rectH);
      ctx.fillStyle = 'rgba(55,65,81,0.95)';
      ctx.fillText(text, rectRight - padX, y);
    }

    if (onPanZoomChange) onPanZoomChange(scale, translate.x, translate.y);
  }, [pixels, scale, translate, rows, cols, cellSize, highlightedProductId, onPanZoomChange, selectionState, currentTool]);

  // center content when pixels first set (only if translate is default)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // only center when translate is near zero
    const headerW = Math.max(36, Math.floor(cellSize * 1.6));
    const headerH = Math.max(24, Math.floor(cellSize * 1.2));
    if ((translate.x === 0 && translate.y === 0) && rows > 0 && cols > 0) {
      const rect = container.getBoundingClientRect();
      const contentW = cols * cellSize * scale;
      const contentH = rows * cellSize * scale;
      const tx = Math.max(0, (rect.width - contentW) / 2 - headerW);
      const ty = Math.max(0, (rect.height - contentH) / 2 - headerH);
      setTranslate({ x: tx, y: ty });
    }
  }, [pixels, rows, cols, cellSize, scale]);

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

  // pointer pan handlers (hand tool and brush tool)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;

    if (currentTool === 'hand') {
      panRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, moved: false } as any;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } else if (currentTool === 'brush') {
      // 画笔工具：开始绘画
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const headerW = Math.max(36, Math.floor(cellSize * 1.6));
      const headerH = Math.max(24, Math.floor(cellSize * 1.2));
      const x = (e.clientX - rect.left - (translate.x + headerW)) / scale;
      const y = (e.clientY - rect.top - (translate.y + headerH)) / scale;
      const col = Math.floor(x / cellSize);
      const row = Math.floor(y / cellSize);

      if (row >= 0 && row < rows && col >= 0 && col < cols) {
        brushDrawingRef.current = { isDrawing: true, lastRow: row, lastCol: col };
        // 计算画笔覆盖的单元格
        const cellsToPaint: Array<{ row: number; col: number }> = [];
        const size = brushSettings.size;
        const halfSize = Math.floor(size / 2);

        for (let dr = -halfSize; dr < size - halfSize; dr++) {
          for (let dc = -halfSize; dc < size - halfSize; dc++) {
            const r = row + dr;
            const c = col + dc;
            if (r >= 0 && r < rows && c >= 0 && c < cols) {
              cellsToPaint.push({ row: r, col: c });
            }
          }
        }

        if (cellsToPaint.length > 0) {
          onBrushDraw?.(cellsToPaint);
        }
      }

      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // hand tool: panning
    if (panRef.current && panRef.current.dragging && currentTool === 'hand') {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panRef.current.moved = true;
      setTranslate((t) => ({ x: t.x + dx, y: t.y + dy }));
      panRef.current.startX = e.clientX;
      panRef.current.startY = e.clientY;
    }

    // brush tool: painting
    if (brushDrawingRef.current.isDrawing && currentTool === 'brush') {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const headerW = Math.max(36, Math.floor(cellSize * 1.6));
      const headerH = Math.max(24, Math.floor(cellSize * 1.2));
      const x = (e.clientX - rect.left - (translate.x + headerW)) / scale;
      const y = (e.clientY - rect.top - (translate.y + headerH)) / scale;
      const col = Math.floor(x / cellSize);
      const row = Math.floor(y / cellSize);

      // 检查是否移动到新的单元格
      const { lastRow, lastCol } = brushDrawingRef.current;
      if (row !== lastRow || col !== lastCol) {
        if (row >= 0 && row < rows && col >= 0 && col < cols) {
          // 使用Bresenham直线算法插值，确保连续线条
          const cellsToPaint = getLineCells(lastRow ?? row, lastCol ?? col, row, col);

          // 扩展到画笔尺寸
          const expandedCells: Array<{ row: number; col: number }> = [];
          const size = brushSettings.size;
          const halfSize = Math.floor(size / 2);

          cellsToPaint.forEach(cell => {
            for (let dr = -halfSize; dr < size - halfSize; dr++) {
              for (let dc = -halfSize; dc < size - halfSize; dc++) {
                const r = cell.row + dr;
                const c = cell.col + dc;
                if (r >= 0 && r < rows && c >= 0 && c < cols) {
                  expandedCells.push({ row: r, col: c });
                }
              }
            }
          });

          if (expandedCells.length > 0) {
            onBrushDraw?.(expandedCells);
          }

          brushDrawingRef.current = { isDrawing: true, lastRow: row, lastCol: col };
        }
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (currentTool === 'hand' && panRef.current) {
      panRef.current.dragging = false;
    } else if (currentTool === 'brush' && brushDrawingRef.current.isDrawing) {
      brushDrawingRef.current.isDrawing = false;
      brushDrawingRef.current.lastRow = null;
      brushDrawingRef.current.lastCol = null;
      // 通知画笔绘画完成，用于保存历史记录
      onBrushEnd?.();
    }
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch (err) { }
  };

  // Bresenham直线算法，用于画笔连续绘画
  const getLineCells = (x0: number, y0: number, x1: number, y1: number): Array<{ row: number; col: number }> => {
    const cells: Array<{ row: number; col: number }> = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
      cells.push({ row: y, col: x });

      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }

    return cells;
  };

  // handle clicks: compute cell and handle based on current tool
  const handleClick = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const headerW = Math.max(36, Math.floor(cellSize * 1.6));
    const headerH = Math.max(24, Math.floor(cellSize * 1.2));
    const x = (e.clientX - rect.left - (translate.x + headerW)) / scale;
    const y = (e.clientY - rect.top - (translate.y + headerH)) / scale;
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);

    // if a pan occurred just before click, ignore as it's likely a drag
    if (panRef.current && (panRef.current as any).moved) {
      (panRef.current as any).moved = false;
      return;
    }

    // if outside grid bounds:
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      if (currentTool === 'hand') {
        // hand tool: background click
        onBackgroundClick?.();
        return;
      } else if (currentTool === 'free-select') {
        // allow selecting cells outside current pixels (e.g., expanded area)
        handleFreeSelect(row, col, e);
        return;
      } else if (currentTool === 'magic-wand') {
        // magic wand requires an actual colored cell; out-of-bounds does nothing
        return;
      }
    }

    const cell = pixels[row][col];

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
      handleFreeSelect(row, col, e);
    } else if (currentTool === 'magic-wand') {
      // magic wand tool: flood fill selection
      handleMagicWand(row, col);
    } else if (currentTool === 'color-select') {
      // color select tool: select all cells with same color
      handleColorSelect(row, col);
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

      selected.add(key);

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
    <div ref={containerRef} className="relative w-full h-full bg-white touch-none" style={{ overflow: 'hidden' }}>
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
          cursor: currentTool === 'hand'
            ? (panRef.current?.dragging ? 'grabbing' : 'grab')
            : currentTool === 'free-select'
              ? 'crosshair'
              : currentTool === 'magic-wand'
                ? 'copy'
                : currentTool === 'paste'
                  ? 'cell'
                  : currentTool === 'brush'
                    ? 'crosshair'
                    : 'default'
        }}
      />
    </div>
  );
};

export default PixelGrid;


