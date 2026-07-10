import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  warpImageToCanvas,
  mmToPx,
  A4,
  type Point,
  type Point4,
} from '../utils/perspective';

interface PrintAlignmentModalProps {
  /** 图纸图片 URL（绝对路径，如 http://.../uploads/drawings/xxx.jpg） */
  imageUrl: string;
  /** 图纸标题（用于打印窗口标题） */
  drawingTitle?: string;
  onClose: () => void;
}

/** 打印板预设 */
const BOARD_PRESETS: Array<{ label: string; size: number }> = [
  { label: '52×52 板', size: 52 },
  { label: '78×78 板', size: 78 },
  { label: '104×104 板', size: 104 },
];

/** 默认单格像素宽度（拼豆标准 2.7mm） */
const DEFAULT_CELL_MM = 2.7;

/**
 * 打印对齐图纸生成弹窗
 *
 * 三步向导：
 * 1. 在图纸上点选 4 个角，输入框选区域宽/高格子数 → 透视拉正
 * 2. 选择目标打印板尺寸 + 单格像素宽度
 * 3. 合成预览：底板(网格+孔点) + 图纸色块叠加，可拖拽调整位置 → 打印/下载
 */
const PrintAlignmentModal: React.FC<PrintAlignmentModalProps> = ({
  imageUrl,
  drawingTitle,
  onClose,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ===== 步骤 1：4 角选区 =====
  const imageRef = useRef<HTMLImageElement | null>(null);
  const cornerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [corners, setCorners] = useState<Point[]>([]);
  const [regionW, setRegionW] = useState<number>(20);
  const [regionH, setRegionH] = useState<number>(20);
  const [warping, setWarping] = useState(false);

  // 拉正后的完整 canvas（保留原图分辨率，零颜色失真）
  // 拉正图尺寸 = regionW × regionH 格，每格 outScale 像素
  const [warpedCanvas, setWarpedCanvas] = useState<HTMLCanvasElement | null>(null);

  // ===== 步骤 2：板尺寸 + 像素宽度 =====
  const [boardSize, setBoardSize] = useState<number>(52);
  const [customBoard, setCustomBoard] = useState<string>('');
  const [cellMm, setCellMm] = useState<number>(DEFAULT_CELL_MM);

  // ===== 步骤 3：合成 =====
  const composeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // 图纸在底板上的偏移（以格子为单位）
  const [offsetCol, setOffsetCol] = useState<number>(0);
  const [offsetRow, setOffsetRow] = useState<number>(0);
  const [draggingOffset, setDraggingOffset] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; col: number; row: number } | null>(null);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ===== 步骤 1：屏幕坐标 → 图片自然像素坐标（参考 MaterialRecognition.getImageCoordinates） =====
  const getImageCoords = useCallback((e: React.MouseEvent): Point | null => {
    if (!imageRef.current) return null;
    const rect = imageRef.current.getBoundingClientRect();
    const scaleX = imageRef.current.naturalWidth / rect.width;
    const scaleY = imageRef.current.naturalHeight / rect.height;
    let x = (e.clientX - rect.left) * scaleX;
    let y = (e.clientY - rect.top) * scaleY;
    // 边界纠错
    x = Math.max(0, Math.min(x, imageRef.current.naturalWidth));
    y = Math.max(0, Math.min(y, imageRef.current.naturalHeight));
    return { x, y };
  }, []);

  // 点击拾取角点
  const handleCornerClick = (e: React.MouseEvent) => {
    if (corners.length >= 4) return;
    const p = getImageCoords(e);
    if (!p) return;
    setCorners((prev) => [...prev, p]);
  };

  // 画角点和四边形
  useEffect(() => {
    const img = imageRef.current;
    const canvas = cornerCanvasRef.current;
    if (!imgLoaded || !img || !canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 画四边形
    if (corners.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x, corners[i].y);
      }
      if (corners.length === 4) ctx.closePath();
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = Math.max(2, img.naturalWidth / 400);
      ctx.stroke();
      // 半透明填充
      if (corners.length === 4) {
        ctx.fillStyle = 'rgba(59,130,246,0.12)';
        ctx.fill();
      }
    }
    // 画角点 + 序号
    const r = Math.max(6, img.naturalWidth / 250);
    corners.forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#EF4444';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = r * 0.4;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r * 1.2}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), c.x, c.y);
    });
  }, [corners, imgLoaded]);

  // 步骤 1 → 步骤 2：执行透视拉正（保留原图像素，零颜色失真）
  const handleWarp = async () => {
    if (corners.length !== 4) return;
    if (regionW < 1 || regionH < 1) {
      alert('宽和高格子数必须大于 0');
      return;
    }
    setWarping(true);
    // 让浏览器有机会更新 UI
    await new Promise((r) => setTimeout(r, 50));
    try {
      if (!imageRef.current) throw new Error('图片未加载');
      const p4 = [corners[0], corners[1], corners[2], corners[3]] as Point4;
      // 每格 outScale 像素，保证拉正后足够清晰；细分数 8 兼顾精度与速度
      const canvas = warpImageToCanvas(imageRef.current, p4, regionW, regionH, 20, 8);
      setWarpedCanvas(canvas);
      // 初始化偏移：居中
      const effectiveBoard = getEffectiveBoard();
      setOffsetCol(Math.floor((effectiveBoard - regionW) / 2));
      setOffsetRow(Math.floor((effectiveBoard - regionH) / 2));
      setStep(2);
    } catch (err) {
      console.error('[print-align] 透视拉正失败', err);
      alert('透视拉正失败：' + (err as Error).message);
    } finally {
      setWarping(false);
    }
  };

  // 当前生效的板尺寸（预设或自定义）
  const getEffectiveBoard = useCallback(() => {
    const custom = parseInt(customBoard);
    if (!isNaN(custom) && custom > 0) return custom;
    return boardSize;
  }, [boardSize, customBoard]);

  const effectiveBoard = getEffectiveBoard();

  // 物理尺寸计算
  const boardMmW = effectiveBoard * cellMm;
  const boardMmH = effectiveBoard * cellMm;
  const pagesX = Math.ceil(boardMmW / A4.width);
  const pagesY = Math.ceil(boardMmH / A4.height);
  const totalPages = pagesX * pagesY;

  // 步骤 2 → 步骤 3
  const handleGenerate = () => {
    // 偏移夹紧到底板范围内
    setOffsetCol((c) => Math.max(-regionW + 1, Math.min(effectiveBoard - 1, c)));
    setOffsetRow((r) => Math.max(-regionH + 1, Math.min(effectiveBoard - 1, r)));
    setStep(3);
  };

  // ===== 步骤 3：合成画布渲染 =====
  // 渲染时的 cellPx（屏幕预览用，每格屏幕像素，约 8~12 之间自动算）
  const previewCellPx = Math.max(4, Math.min(12, Math.floor(560 / effectiveBoard)));

  const drawCompose = useCallback(
    (ctx: CanvasRenderingContext2D, cellPx: number, opts?: { showPageLines?: boolean; pageLineOnly?: boolean }) => {
      const showPageLines = opts?.showPageLines ?? false;
      const pageLineOnly = opts?.pageLineOnly ?? false;
      const total = effectiveBoard * cellPx;
      ctx.clearRect(0, 0, total, total);

      if (!pageLineOnly) {
        // ===== 底板：白色背景 + 浅灰网格线 + 孔点标记 =====
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, total, total);

        // 网格线
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = Math.max(0.5, cellPx / 20);
        for (let i = 0; i <= effectiveBoard; i++) {
          const p = i * cellPx;
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, total);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, p);
          ctx.lineTo(total, p);
          ctx.stroke();
        }

        // 孔点标记（每格中心一个小灰点，模拟实物板钉孔）
        const dotR = Math.max(1, cellPx / 8);
        ctx.fillStyle = '#9ca3af';
        for (let r = 0; r < effectiveBoard; r++) {
          for (let c = 0; c < effectiveBoard; c++) {
            ctx.beginPath();
            ctx.arc((c + 0.5) * cellPx, (r + 0.5) * cellPx, dotR, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // ===== 图纸贴图叠加（保留原图像素，仅缩放尺寸） =====
        if (warpedCanvas) {
          // 拉正图覆盖 regionW × regionH 个格子，整体缩放到目标矩形
          const dx = offsetCol * cellPx;
          const dy = offsetRow * cellPx;
          const dw = regionW * cellPx;
          const dh = regionH * cellPx;
          ctx.drawImage(warpedCanvas, dx, dy, dw, dh);
        }
      }

      // ===== A4 分页线 =====
      if (showPageLines) {
        const a4wPx = mmToPx(A4.width);
        const a4hPx = mmToPx(A4.height);
        ctx.strokeStyle = '#EF4444';
        ctx.lineWidth = Math.max(1, cellPx / 6);
        ctx.setLineDash([cellPx / 2, cellPx / 3]);
        // 竖向分页线
        for (let i = 1; i < pagesX; i++) {
          const x = (i * A4.width / cellMm) * cellPx;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, total);
          ctx.stroke();
        }
        // 横向分页线
        for (let i = 1; i < pagesY; i++) {
          const y = (i * A4.height / cellMm) * cellPx;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(total, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // 隐藏未使用的 a4wPx/a4hPx 警告
        void a4wPx;
        void a4hPx;
      }
    },
    [effectiveBoard, warpedCanvas, regionH, regionW, offsetCol, offsetRow, pagesX, pagesY, cellMm]
  );

  // 重绘合成画布
  useEffect(() => {
    if (step !== 3) return;
    const canvas = composeCanvasRef.current;
    if (!canvas) return;
    const cellPx = previewCellPx;
    const total = effectiveBoard * cellPx;
    canvas.width = total;
    canvas.height = total;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawCompose(ctx, cellPx, { showPageLines: true });
  }, [step, drawCompose, previewCellPx, effectiveBoard]);

  // 拖拽调整位置（在合成画布上拖动图纸）
  const handleComposeMouseDown = (e: React.MouseEvent) => {
    if (!composeCanvasRef.current) return;
    const rect = composeCanvasRef.current.getBoundingClientRect();
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      col: offsetCol,
      row: offsetRow,
    };
    setDraggingOffset(true);
    void rect;
  };

  useEffect(() => {
    if (!draggingOffset) return;
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start || !composeCanvasRef.current) return;
      const rect = composeCanvasRef.current.getBoundingClientRect();
      const dCol = Math.round((e.clientX - start.x) / previewCellPx);
      const dRow = Math.round((e.clientY - start.y) / previewCellPx);
      setOffsetCol(Math.max(-regionW + 1, Math.min(effectiveBoard - 1, start.col + dCol)));
      setOffsetRow(Math.max(-regionH + 1, Math.min(effectiveBoard - 1, start.row + dRow)));
      void rect;
    };
    const onUp = () => {
      setDraggingOffset(false);
      dragStartRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [draggingOffset, previewCellPx, regionW, regionH, effectiveBoard]);

  // ===== 打印：生成高分辨率多页 A4 =====
  const handlePrint = () => {
    // 每格像素 = mm 像素宽度（保证物理精度，96dpi）
    const cellPx = mmToPx(cellMm);
    const win = window.open('', '_blank');
    if (!win) {
      alert('无法打开打印窗口，请检查浏览器是否拦截了弹窗');
      return;
    }

    // 为每一页生成一个 A4 子区域的 dataURL
    // 注意：每页物理尺寸 = 该页实际格数 × 单格mm（短边按实际格数算），
    // 而非固定 210×297，否则非完整页会被拉伸变形。
    const pages: Array<{ src: string; mmW: number; mmH: number }> = [];
    for (let py = 0; py < pagesY; py++) {
      for (let px = 0; px < pagesX; px++) {
        // 这一页在板坐标（格子）中的范围
        const colStart = Math.floor((px * A4.width) / cellMm);
        const rowStart = Math.floor((py * A4.height) / cellMm);
        const colEnd = Math.min(effectiveBoard, Math.ceil(((px + 1) * A4.width) / cellMm));
        const rowEnd = Math.min(effectiveBoard, Math.ceil(((py + 1) * A4.height) / cellMm));
        const pageCols = colEnd - colStart;
        const pageRows = rowEnd - rowStart;
        if (pageCols <= 0 || pageRows <= 0) continue;
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = pageCols * cellPx;
        pageCanvas.height = pageRows * cellPx;
        const pctx = pageCanvas.getContext('2d');
        if (!pctx) continue;
        // 渲染该子区域
        const tmp = document.createElement('canvas');
        tmp.width = effectiveBoard * cellPx;
        tmp.height = effectiveBoard * cellPx;
        const tctx = tmp.getContext('2d');
        if (!tctx) continue;
        drawCompose(tctx, cellPx, { showPageLines: false });
        // 裁切
        pctx.drawImage(
          tmp,
          colStart * cellPx,
          rowStart * cellPx,
          pageCols * cellPx,
          pageRows * cellPx,
          0,
          0,
          pageCols * cellPx,
          pageRows * cellPx
        );
        pages.push({
          src: pageCanvas.toDataURL('image/png'),
          mmW: pageCols * cellMm,
          mmH: pageRows * cellMm,
        });
      }
    }

    const imgsHtml = pages
      .map(
        (p) =>
          `<div class="page"><img src="${p.src}" style="width:${p.mmW}mm;height:${p.mmH}mm;" /></div>`
      )
      .join('\n');

    win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>打印对齐图纸 - ${drawingTitle || ''}</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page { width: 210mm; height: 297mm; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .page img { display: block; }
  @media screen {
    body { background: #808080; padding: 20px; }
    .page { margin: 0 auto 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.3); background: #fff; }
  }
  .tip { text-align:center; padding: 20px; font-size: 18px; color:#333; background:#FEF3C7; border-bottom:2px solid #F59E0B; }
  @media print { .tip { display: none; } }
</style>
</head>
<body>
  <div class="tip">
    ⚠️ 打印时请务必在打印对话框选择：<b>「实际尺寸」或「自定义 100%」</b>，并<b>关闭页边距</b>，否则物理尺寸会偏差。
    打印完成后用透明拼豆板对照即可对齐。
  </div>
  ${imgsHtml}
  <script>
    window.onload = function() { setTimeout(function(){ window.print(); }, 300); };
  ${'<'}${'/'}script>
</body>
</html>`);
    win.document.close();
  };

  // ===== 下载完整合成 PNG =====
  const handleDownloadPng = () => {
    const cellPx = mmToPx(cellMm);
    const canvas = document.createElement('canvas');
    canvas.width = effectiveBoard * cellPx;
    canvas.height = effectiveBoard * cellPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawCompose(ctx, cellPx, { showPageLines: false });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `print-align-${drawingTitle || 'drawing'}-${effectiveBoard}x${effectiveBoard}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-4">
            <h2 className="text-lg font-medium">打印对齐图纸</h2>
            <div className="flex items-center space-x-1 text-sm">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center">
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                      step >= s ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {s}
                  </span>
                  {s < 3 && <div className={`w-6 h-0.5 ${step > s ? 'bg-blue-500' : 'bg-gray-200'}`} />}
                </div>
              ))}
            </div>
            <span className="text-sm text-gray-500">
              {step === 1 && '框选图纸范围'}
              {step === 2 && '选择打印板'}
              {step === 3 && '调整位置并打印'}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-6">
          {/* ========== 步骤 1：4 角选区 ========== */}
          {step === 1 && (
            <div>
              <div className="mb-3 p-3 bg-blue-50 rounded text-sm text-blue-800">
                <b>操作说明：</b>在下图上依次点击图纸范围的<b> 4 个角</b>（建议顺序：左上 → 右上 → 右下 → 左下）。
                系统会自动把歪斜的四边形拉正成网格。点错可点「重置选区」重新开始。
              </div>
              <div className="flex flex-col lg:flex-row gap-6">
                {/* 图片+选区画布 */}
                <div className="flex-1 bg-gray-100 rounded p-2 overflow-auto" style={{ maxHeight: '70vh' }}>
                  <div className="relative inline-block">
                    <img
                      ref={imageRef}
                      src={imageUrl}
                      alt="图纸"
                      crossOrigin="anonymous"
                      onLoad={() => setImgLoaded(true)}
                      className="max-w-full h-auto block"
                      style={{ maxHeight: '70vh', cursor: corners.length >= 4 ? 'default' : 'crosshair' }}
                      onClick={handleCornerClick}
                    />
                    {imgLoaded && (
                      <canvas
                        ref={cornerCanvasRef}
                        className="absolute top-0 left-0 w-full h-full pointer-events-none"
                        style={{ cursor: corners.length >= 4 ? 'default' : 'crosshair' }}
                      />
                    )}
                  </div>
                </div>
                {/* 参数面板 */}
                <div className="lg:w-72 flex-shrink-0 space-y-4">
                  <div className="p-4 bg-gray-50 rounded">
                    <div className="text-sm font-medium mb-2">已选角点：{corners.length} / 4</div>
                    <div className="flex items-center space-x-2 mb-3">
                      {[1, 2, 3, 4].map((n) => (
                        <span
                          key={n}
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                            corners.length >= n ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-400'
                          }`}
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                    {corners.length < 4 && (
                      <div className="text-xs text-gray-500">
                        请点击第 <b>{corners.length + 1}</b> 个角
                      </div>
                    )}
                  </div>

                  <div className="p-4 border rounded space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">框选区域宽（格子数）</label>
                      <input
                        type="number"
                        min={1}
                        value={regionW}
                        onChange={(e) => setRegionW(Math.max(1, parseInt(e.target.value) || 1))}
                        className="mt-1 block w-full border border-gray-300 rounded p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">框选区域高（格子数）</label>
                      <input
                        type="number"
                        min={1}
                        value={regionH}
                        onChange={(e) => setRegionH(Math.max(1, parseInt(e.target.value) || 1))}
                        className="mt-1 block w-full border border-gray-300 rounded p-2"
                      />
                    </div>
                    <div className="text-xs text-gray-500">
                      拉正后输出 {regionW} × {regionH} = {regionW * regionH} 格
                    </div>
                  </div>

                  <button
                    onClick={() => setCorners([])}
                    className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                  >
                    重置选区
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========== 步骤 2：板尺寸 + 像素宽度 ========== */}
          {step === 2 && (
            <div className="max-w-2xl mx-auto">
              <div className="mb-4 p-3 bg-green-50 rounded text-sm text-green-800">
                ✅ 拉正完成，输出 {regionW} × {regionH} 格。请选择要适配的打印板尺寸。
              </div>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">打印板尺寸</label>
                  <div className="grid grid-cols-3 gap-3">
                    {BOARD_PRESETS.map((p) => (
                      <button
                        key={p.size}
                        onClick={() => {
                          setBoardSize(p.size);
                          setCustomBoard('');
                        }}
                        className={`px-3 py-3 rounded border-2 text-sm font-medium transition-colors ${
                          effectiveBoard === p.size && !customBoard
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center space-x-2">
                    <label className="text-sm text-gray-700">自定义板格数：</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="留空用预设"
                      value={customBoard}
                      onChange={(e) => setCustomBoard(e.target.value)}
                      className="w-32 border border-gray-300 rounded p-2"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    单格像素宽度（mm）— 拼豆标准 2.7mm
                  </label>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={cellMm}
                    onChange={(e) => setCellMm(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                    className="w-32 border border-gray-300 rounded p-2"
                  />
                </div>

                {/* 物理尺寸预览 */}
                <div className="p-4 bg-gray-50 rounded space-y-1 text-sm">
                  <div>板物理尺寸：<b>{boardMmW.toFixed(1)} × {boardMmH.toFixed(1)} mm</b></div>
                  <div>
                    A4 纸可容纳：<b>{A4.width} × {A4.height} mm</b>
                    {boardMmW > A4.width || boardMmH > A4.height ? (
                      <span className="text-amber-600 font-medium"> （超出，需分页打印）</span>
                    ) : (
                      <span className="text-green-600 font-medium"> （可单页打印）</span>
                    )}
                  </div>
                  <div>
                    分页数：<b>{pagesX} 列 × {pagesY} 行 = {totalPages} 页</b>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========== 步骤 3：合成预览 ========== */}
          {step === 3 && (
            <div className="flex flex-col lg:flex-row gap-6">
              {/* 画布 */}
              <div className="flex-1 bg-gray-100 rounded p-3 overflow-auto" style={{ maxHeight: '70vh' }}>
                <canvas
                  ref={composeCanvasRef}
                  className="block mx-auto cursor-move"
                  style={{ maxWidth: '100%', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
                  onMouseDown={handleComposeMouseDown}
                />
                <div className="mt-2 text-center text-xs text-gray-500">
                  底板 {effectiveBoard}×{effectiveBoard} 格（{boardMmW.toFixed(1)}×{boardMmH.toFixed(1)}mm）｜
                  红色虚线 = A4 分页线｜可拖动图纸调整位置
                </div>
              </div>
              {/* 控制面板 */}
              <div className="lg:w-72 flex-shrink-0 space-y-4">
                <div className="p-4 border rounded space-y-3">
                  <div className="text-sm font-medium">图纸位置（格子偏移）</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600">左偏移（列）</label>
                      <input
                        type="number"
                        value={offsetCol}
                        onChange={(e) => setOffsetCol(parseInt(e.target.value) || 0)}
                        className="w-full border border-gray-300 rounded p-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">上偏移（行）</label>
                      <input
                        type="number"
                        value={offsetRow}
                        onChange={(e) => setOffsetRow(parseInt(e.target.value) || 0)}
                        className="w-full border border-gray-300 rounded p-2 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        setOffsetCol(Math.floor((effectiveBoard - regionW) / 2));
                        setOffsetRow(Math.floor((effectiveBoard - regionH) / 2));
                      }}
                      className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                    >
                      居中
                    </button>
                  </div>
                </div>

                <div className="p-4 border rounded space-y-2">
                  <div className="text-sm font-medium">缩放比例</div>
                  <label className="block text-xs text-gray-600">单格像素宽度（mm）</label>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={cellMm}
                    onChange={(e) => setCellMm(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                    className="w-full border border-gray-300 rounded p-2 text-sm"
                  />
                  <div className="text-xs text-gray-500">
                    实际板尺寸：{boardMmW.toFixed(1)}×{boardMmH.toFixed(1)}mm｜{totalPages} 页
                  </div>
                </div>

                <button
                  onClick={handlePrint}
                  className="w-full px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded font-medium"
                >
                  🖨️ 打印（{totalPages} 页 A4）
                </button>
                <button
                  onClick={handleDownloadPng}
                  className="w-full px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded text-sm"
                >
                  ⬇️ 下载完整 PNG
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="text-xs text-gray-500">
            {step === 1 && '提示：4 个角点定义框选区域，系统会透视矫正拉正'}
            {step === 2 && `输出 ${regionW}×${regionH} 格 ｜ 目标板 ${effectiveBoard}×${effectiveBoard}`}
            {step === 3 && `图纸偏移 (列:${offsetCol}, 行:${offsetRow})`}
          </div>
          <div className="flex space-x-2">
            {step > 1 && (
              <button
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
              >
                上一步
              </button>
            )}
            {step === 1 && (
              <button
                onClick={handleWarp}
                disabled={corners.length !== 4 || warping}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {warping ? '拉正中...' : '下一步：拉正选区'}
              </button>
            )}
            {step === 2 && (
              <button
                onClick={handleGenerate}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm"
              >
                下一步：生成合成图
              </button>
            )}
            {step === 3 && (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
              >
                完成
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintAlignmentModal;
