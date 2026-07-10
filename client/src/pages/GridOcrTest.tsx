import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  detectGrid,
  type GridDetectResult,
} from '../utils/gridDetect';
import {
  recognizeGrid,
  getOcrStatus,
  recomputeStats,
  normalizeCode,
  CELL_WARP_PX,
  RECOG_SCALE,
  type CellOcrResult,
  type CellOcrProgress,
} from '../utils/cellOcr';
import { warpImageToCanvas, solveHomography, applyHomography, type Point, type Point4 } from '../utils/perspective';

type Phase = 'upload' | 'adjust' | 'result';

/** 视图变换：自然像素 → 屏幕 = natural × scale + offset */
interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const GridOcrTest: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('upload');
  const [imgUrl, setImgUrl] = useState<string>('');
  const [imgLoaded, setImgLoaded] = useState(false);

  // 四角（自然像素坐标）+ 格子数（物料区）
  const [corners, setCorners] = useState<Point[]>([]);
  const [cols, setCols] = useState<number>(50);
  const [rows, setRows] = useState<number>(50);
  const [showGrid, setShowGrid] = useState(true);
  const [keepRect, setKeepRect] = useState(true); // 保持矩形（默认开，适合数字化方正图纸）
  const [detectInfo, setDetectInfo] = useState<string>('');

  // 视图变换（缩放/平移）
  const [view, setView] = useState<View>({ scale: 1, offsetX: 0, offsetY: 0 });

  // OCR 状态
  const [ocrLoading, setOcrLoading] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false); // 后端模型加载中
  const [progress, setProgress] = useState<CellOcrProgress | null>(null);
  const [result, setResult] = useState<CellOcrResult | null>(null);
  const cancelledRef = useRef(false);

  // 选中格（用于查看/修正）
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);

  // refs
  const imgRef = useRef<HTMLImageElement | null>(null); // 隐藏的图片数据源
  const canvasRef = useRef<HTMLCanvasElement | null>(null); // 主绘制画布（图片+overlay）
  const wrapRef = useRef<HTMLDivElement | null>(null); // 视口容器

  // 交互状态
  const dragIdxRef = useRef<number | null>(null); // 正在拖拽的顶点序号
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null); // 用于渲染放大镜
  const dragViewRef = useRef<{ startX: number; startY: number; startOffX: number; startOffY: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // ===== 上传 =====
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    const url = URL.createObjectURL(f);
    setImgUrl(url);
    setImgLoaded(false);
    setCorners([]);
    setResult(null);
    setPhase('adjust');
  };

  // 图片加载完成后：fit 到视口 + 自动检测
  const onImgLoad = useCallback(() => {
    setImgLoaded(true);
    setTimeout(() => {
      fitToView();
      autoDetect();
    }, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 让图片适应视口（contain）
  const fitToView = useCallback(() => {
    const img = imgRef.current;
    const wrap = wrapRef.current;
    if (!img || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const offsetX = (rect.width - img.naturalWidth * scale) / 2;
    const offsetY = (rect.height - img.naturalHeight * scale) / 2;
    setView({ scale, offsetX, offsetY });
  }, []);

  const autoDetect = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setDetectInfo('检测中...');
    try {
      const r: GridDetectResult = detectGrid(img);
      setCorners(r.corners.map((p) => ({ ...p })));
      setCols(Math.max(1, r.cols));
      setRows(Math.max(1, r.rows));
      const conf = Math.round(r.confidence * 100);
      const msg =
        conf < 55
          ? `自动检测完成：四角已定位，格子数约为 ${r.cols}×${r.rows}（置信度较低 ${conf}%）。可滚轮放大后微调顶点和格子数。`
          : conf < 75
          ? `自动检测完成：${r.cols}×${r.rows}（置信度 ${conf}%）。可滚轮放大后微调。`
          : `自动检测完成：${r.cols}×${r.rows}（置信度 ${conf}%）。`;
      setDetectInfo(msg);
    } catch (err) {
      setDetectInfo('自动检测失败，请手动设置四角和格子数。');
    }
  }, []);

  // ===== 坐标换算（基于 view）=====
  const screenToNatural = useCallback(
    (sx: number, sy: number): Point => {
      return {
        x: (sx - view.offsetX) / view.scale,
        y: (sy - view.offsetY) / view.scale,
      };
    },
    [view]
  );

  const getMouseInCanvas = useCallback((e: React.MouseEvent | MouseEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // 命中测试：返回最近的顶点序号（屏幕距离 < 阈值）
  const hitTestCorner = useCallback(
    (screenPt: Point): number => {
      if (corners.length !== 4) return -1;
      let nearest = -1;
      let bestDist = 16; // 屏幕像素阈值
      corners.forEach((c, i) => {
        const sx = c.x * view.scale + view.offsetX;
        const sy = c.y * view.scale + view.offsetY;
        const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
        if (d < bestDist) {
          bestDist = d;
          nearest = i;
        }
      });
      return nearest;
    },
    [corners, view]
  );

  // ===== 鼠标交互 =====
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const sp = getMouseInCanvas(e);
    if (!sp) return;
    const hit = hitTestCorner(sp);
    if (e.button === 2) return; // 右键不处理（防止菜单由 onContextMenu 拦截）

    if (hit >= 0) {
      // 拖拽顶点
      dragIdxRef.current = hit;
      setDraggingIdx(hit);
      e.preventDefault();
      return;
    }
    // 空白处：平移视图
    dragViewRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffX: view.offsetX,
      startOffY: view.offsetY,
    };
    setPanning(true);
  };

  // 全局 mousemove/mouseup（拖拽顶点 / 平移）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const sp = getMouseInCanvas(e);
      if (!sp) return;

      // 拖拽顶点
      if (dragIdxRef.current !== null) {
        const np = screenToNatural(sp.x, sp.y);
        const idx = dragIdxRef.current;
        const img = imgRef.current;
        // 钳制到图片范围
        const cx = img ? Math.max(0, Math.min(np.x, img.naturalWidth)) : np.x;
        const cy = img ? Math.max(0, Math.min(np.y, img.naturalHeight)) : np.y;
        setCorners((prev) => {
          if (prev.length !== 4) return prev;
          const next = prev.map((p) => ({ ...p }));
          next[idx] = { x: cx, y: cy };
          // 保持矩形：拖一角带动相邻两角
          if (keepRect) {
            // 角序：0左上 1右上 2右下 3左下
            // 每个角的"相邻"= 共享 x 或 共享 y 的两个角
            // 0左上: x与3(左下)共享, y与1(右上)共享
            // 1右上: x与2(右下)共享, y与0(左上)共享
            // 2右下: x与1(右上)共享, y与3(左下)共享
            // 3左下: x与0(左上)共享, y与2(右下)共享
            const xPeer = idx === 0 ? 3 : idx === 1 ? 2 : idx === 2 ? 1 : 0;
            const yPeer = idx === 0 ? 1 : idx === 1 ? 0 : idx === 2 ? 3 : 2;
            next[xPeer].x = cx;
            next[yPeer].y = cy;
          }
          return next;
        });
        return;
      }
      // 平移视图
      if (panning && dragViewRef.current) {
        const dx = e.clientX - dragViewRef.current.startX;
        const dy = e.clientY - dragViewRef.current.startY;
        setView((v) => ({
          ...v,
          offsetX: dragViewRef.current!.startOffX + dx,
          offsetY: dragViewRef.current!.startOffY + dy,
        }));
      }
    };
    const onUp = () => {
      dragIdxRef.current = null;
      setDraggingIdx(null);
      setPanning(false);
      dragViewRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [screenToNatural, getMouseInCanvas, keepRect, panning]);

  // 滚轮缩放（以鼠标位置为锚点）
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const sp = getMouseInCanvas(e);
      if (!sp) return;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const newScale = Math.max(0.05, Math.min(40, v.scale * factor));
        // 锚点：让 sp 对应的自然坐标在缩放前后不变
        // natural = (sp - offset)/scale
        const nx = (sp.x - v.offsetX) / v.scale;
        const ny = (sp.y - v.offsetY) / v.scale;
        return {
          scale: newScale,
          offsetX: sp.x - nx * newScale,
          offsetY: sp.y - ny * newScale,
        };
      });
    },
    [getMouseInCanvas]
  );

  // 阻止右键菜单（避免平移时弹出）
  const handleContextMenu = (e: React.MouseEvent) => e.preventDefault();

  // ===== 主绘制：图片 + overlay（四角 + 网格预览 + 放大镜）=====
  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!imgLoaded || !img || !canvas || !wrap) return;
    // 防御：图片未真正解码完成或尺寸为 0 时跳过，避免 drawImage 抛错导致整页白屏
    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return; // 容器尺寸退化时跳过
    // 防御：view/corners 含 NaN 时跳过
    const { scale, offsetX, offsetY } = view;
    if (![scale, offsetX, offsetY].every((v) => Number.isFinite(v))) return;
    // 整个绘制过程 try-catch：任何 Canvas 异常都不能让组件崩溃白屏
    try {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      // 背景深灰
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, rect.width, rect.height);

      // 画图片（按 view 变换）。
      // 关键：放大很多倍时，drawImage 目标尺寸(naturalW*scale)会超过浏览器 canvas 上限
      // (Chrome 16384px) → 渲染进程崩溃 → 白屏（try-catch 拦不住）。
      // 修复：用源裁剪 drawImage 9 参数版，只取原图中"当前视口可见"的那块区域，
      // 按它实际应占的屏幕像素绘制，目标尺寸永远 ≤ canvas 尺寸。
      if (scale > 0 && Number.isFinite(scale)) {
        // 视口（canvas）对应的自然坐标范围
        const visLeftNat = -offsetX / scale;
        const visTopNat = -offsetY / scale;
        const visWidthNat = rect.width / scale;
        const visHeightNat = rect.height / scale;
        // 与原图取交集（裁掉视口外的部分）
        const sx = Math.max(0, visLeftNat);
        const sy = Math.max(0, visTopNat);
        const sx2 = Math.min(img.naturalWidth, visLeftNat + visWidthNat);
        const sy2 = Math.min(img.naturalHeight, visTopNat + visHeightNat);
        const sw = sx2 - sx;
        const sh = sy2 - sy;
        if (sw > 0 && sh > 0) {
          // 源区域 (sx,sy,sw,sh) 在屏幕上的位置和尺寸
          const dx = sx * scale + offsetX;
          const dy = sy * scale + offsetY;
          const dw = sw * scale;
          const dh = sh * scale;
          if (dw > 0 && dh > 0 && Number.isFinite(dw) && Number.isFinite(dh)) {
            ctx.imageSmoothingEnabled = scale < 4;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
          }
        }
      }

      // 自然→屏幕坐标转换
      const n2s = (p: Point): Point => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY });

      // 网格预览线
      if (corners.length >= 4 && showGrid) {
        const p4: Point4 = [corners[0], corners[1], corners[2], corners[3]];
        drawGridOverlayScreen(ctx, p4, cols, rows, n2s);
      }
      // 四边形框
      if (corners.length >= 2) {
        ctx.beginPath();
        const s0 = n2s(corners[0]);
        ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < corners.length; i++) {
          const sp = n2s(corners[i]);
          ctx.lineTo(sp.x, sp.y);
        }
        if (corners.length === 4) ctx.closePath();
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 2;
        ctx.stroke();
        if (corners.length === 4) {
          ctx.fillStyle = 'rgba(59,130,246,0.10)';
          ctx.fill();
        }
      }
      // 顶点（拖拽时放大）
      const labels = ['左上', '右上', '右下', '左下'];
      corners.forEach((c, i) => {
        const sp = n2s(c);
        const isDragging = draggingIdx === i;
        const r = isDragging ? 12 : 8;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#EF4444';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${isDragging ? 12 : 10}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[i] || String(i + 1), sp.x, sp.y);
    });

    // ===== 放大镜（拖拽顶点时显示）=====
    if (draggingIdx !== null && corners[draggingIdx]) {
      drawMagnifier(ctx, corners[draggingIdx], img, scale, n2s);
    }
    } catch (err) {
      // 任何 Canvas/坐标异常都不应让组件崩溃白屏；静默忽略，下一帧会重绘
      console.warn('[grid-ocr] 渲染异常（已忽略）:', err);
    }
  }, [corners, cols, rows, showGrid, imgLoaded, view, draggingIdx]);

  // 窗口尺寸变化时重绘（保持 fit 或当前 view）
  useEffect(() => {
    const onResize = () => {
      // 触发重绘（view 不变，靠 effect 依赖 view 不会触发，故手动）
      setView((v) => ({ ...v }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ===== OCR =====
  const runOcr = async () => {
    const img = imgRef.current;
    if (!img || corners.length !== 4) {
      alert('请先设置 4 个角点');
      return;
    }
    if (cols < 1 || rows < 1) {
      alert('格子数必须大于 0');
      return;
    }
    cancelledRef.current = false;
    setResult(null);
    setProgress({ done: 0, total: cols * rows });
    setOcrLoading(true);
    setEngineLoading(true);
    try {
      // 等待后端 OCR 引擎就绪（首次启动后端会加载模型，约 0.2-2s）
      let waited = 0;
      while (waited < 60) {
        const status = await getOcrStatus();
        if (status === 'ready') break;
        if (status === 'error') throw new Error('后端 OCR 引擎不可用，请检查服务器');
        await new Promise((r) => setTimeout(r, 1000));
        waited++;
      }
      setEngineLoading(false);
      const p4: Point4 = [corners[0], corners[1], corners[2], corners[3]];
      const res = await recognizeGrid(img, p4, cols, rows, (p) => {
        if (cancelledRef.current) return;
        setProgress({ ...p });
      });
      if (!cancelledRef.current) {
        setResult(res);
        setPhase('result');
      }
    } catch (err) {
      console.error('[grid-ocr] OCR failed', err);
      alert('OCR 失败：' + (err as Error).message);
    } finally {
      setOcrLoading(false);
      setEngineLoading(false);
      setProgress(null);
    }
  };

  const cancelOcr = () => {
    cancelledRef.current = true;
    setOcrLoading(false);
    setEngineLoading(false);
    setProgress(null);
  };

  /**
   * 调试：导出前 3 行（含第0行）的单格图，拼成一张带标注的大图。
   * 用于排查格子分割是否正确（前两行识别失败时看格子有没有取偏）。
   */
  const exportDebugCells = () => {
    const img = imgRef.current;
    if (!img || corners.length !== 4) {
      alert('请先设置 4 个角点');
      return;
    }
    const p4: Point4 = [corners[0], corners[1], corners[2], corners[3]];
    const warped = warpImageToCanvas(img, p4, cols, rows, CELL_WARP_PX, 6);
    const showRows = Math.min(3, rows);
    const cellOut = CELL_WARP_PX * RECOG_SCALE; // 每格放大后像素
    const labelH = 24; // 顶部标注行高
    const labelW = 32; // 左侧标注列宽
    const gap = 2;
    // 拼图画布
    const canvas = document.createElement('canvas');
    canvas.width = labelW + cols * (cellOut + gap);
    canvas.height = labelH + showRows * (cellOut + gap);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      alert('无法创建画布');
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#666';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 列标注
    for (let c = 0; c < cols; c++) {
      ctx.fillText(String(c), labelW + c * (cellOut + gap) + cellOut / 2, labelH / 2);
    }
    // 每格
    for (let r = 0; r < showRows; r++) {
      // 行标注
      ctx.fillText('r' + r, labelW / 2, labelH + r * (cellOut + gap) + cellOut / 2);
      for (let c = 0; c < cols; c++) {
        const dx = labelW + c * (cellOut + gap);
        const dy = labelH + r * (cellOut + gap);
        // 截取单格并放大
        const cellCanvas = document.createElement('canvas');
        cellCanvas.width = cellOut;
        cellCanvas.height = cellOut;
        const cctx = cellCanvas.getContext('2d');
        if (cctx) {
          cctx.imageSmoothingEnabled = true;
          cctx.imageSmoothingQuality = 'high';
          cctx.drawImage(warped, c * CELL_WARP_PX, r * CELL_WARP_PX, CELL_WARP_PX, CELL_WARP_PX, 0, 0, cellOut, cellOut);
        }
        ctx.drawImage(cellCanvas, dx, dy);
        // 格子边框
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.strokeRect(dx, dy, cellOut, cellOut);
      }
    }
    // 下载
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grid-debug-first3rows-${cols}x${rows}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };


  // 组件卸载时清理 url
  useEffect(() => {
    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 手动修正某格 =====
  const fixCell = (r: number, c: number, value: string) => {
    if (!result) return;
    const newCodeGrid = result.codeGrid.map((row) => row.slice());
    const newRawGrid = result.rawGrid.map((row) => row.slice());
    const code = normalizeCode(value);
    newCodeGrid[r][c] = code;
    newRawGrid[r][c] = value;
    const stats = recomputeStats(newCodeGrid);
    setResult({ ...result, codeGrid: newCodeGrid, rawGrid: newRawGrid, stats });
  };

  // ===== 导出 CSV =====
  const exportCsv = () => {
    if (!result) return;
    const lines = ['物料代码,数量'];
    result.stats.forEach((s) => lines.push(`${s.code},${s.count}`));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grid-ocr-stats.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 pt-16 pb-12">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">图纸物料网格识别（测试页）</h1>
            <p className="text-sm text-gray-500 mt-1">
              上传图纸 → 自动检测四角和格子数 → 滚轮放大微调 → 浏览器端逐格 OCR → 统计物料数量
            </p>
          </div>
          <Link to="/" className="text-sm text-blue-600 hover:underline">
            ← 返回首页
          </Link>
        </div>

        {/* 步骤指示 */}
        <div className="flex items-center gap-2 mb-6 text-sm">
          {(['upload', 'adjust', 'result'] as Phase[]).map((p, i) => {
            const labels = { upload: '上传图纸', adjust: '检测/微调', result: '识别结果' };
            const active = phase === p;
            const done = ['upload', 'adjust', 'result'].indexOf(phase) > i;
            return (
              <React.Fragment key={p}>
                <div
                  className={`px-3 py-1 rounded-full ${
                    active
                      ? 'bg-blue-500 text-white'
                      : done
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {i + 1}. {labels[p]}
                </div>
                {i < 2 && <div className="w-6 h-px bg-gray-300" />}
              </React.Fragment>
            );
          })}
        </div>

        {/* 上传区（始终显示，方便换图） */}
        <div className="mb-4 flex items-center gap-3">
          <label className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded cursor-pointer text-sm">
            📁 选择图纸图片
            <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
          </label>
          {imgUrl && <span className="text-sm text-gray-500">已加载图片，可重新选择</span>}
        </div>

        {/* 主体 */}
        {!imgUrl && (
          <div className="bg-white rounded-lg border-2 border-dashed border-gray-300 p-16 text-center text-gray-400">
            点击上方按钮上传一张拼豆图纸照片开始测试
          </div>
        )}

        {imgUrl && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            {/* 左：画布视口 */}
            <div className="bg-white rounded-lg p-3 shadow-sm">
              {/* 隐藏的真实图片（仅作数据源） */}
              <img
                ref={imgRef}
                src={imgUrl}
                alt="图纸"
                crossOrigin="anonymous"
                onLoad={onImgLoad}
                className="hidden"
                draggable={false}
              />
              <div
                ref={wrapRef}
                className="relative overflow-hidden rounded select-none"
                style={{ height: '70vh', cursor: draggingIdx !== null ? 'grabbing' : panning ? 'grabbing' : 'crosshair' }}
              >
                <canvas
                  ref={canvasRef}
                  className="block"
                  style={{ width: '100%', height: '100%' }}
                  onMouseDown={handleCanvasMouseDown}
                  onWheel={handleWheel}
                  onContextMenu={handleContextMenu}
                />
              </div>
              <p className="text-xs text-gray-400 mt-2 text-center">
                滚轮缩放 ｜ 拖动空白处平移 ｜ 拖动红色顶点微调（拖拽时自动放大显示）
                {view.scale !== 1 && (
                  <>
                    {' ｜ '}
                    <button onClick={fitToView} className="text-blue-500 hover:underline">
                      重置缩放
                    </button>
                  </>
                )}
              </p>
            </div>

            {/* 右：控制面板 */}
            <div className="space-y-3">
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <button
                  onClick={autoDetect}
                  className="w-full px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded text-sm mb-3"
                >
                  🔍 自动检测四角和格子数
                </button>
                <div className="text-xs text-gray-500 mb-3 min-h-[32px]">{detectInfo}</div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      横向格子数（物料区）
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={cols}
                      onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      竖向格子数（物料区）
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={rows}
                      onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div className="text-xs text-gray-400 mb-3">
                  物料区 {cols} × {rows} = {cols * rows} 格（框选区域内格子数）
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-600 mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                  />
                  显示网格预览线
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keepRect}
                    onChange={(e) => setKeepRect(e.target.checked)}
                  />
                  保持矩形（拖一角带动相邻两角）
                </label>

                <button
                  onClick={() => setCorners([])}
                  className="w-full px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs mb-2"
                >
                  重置角点
                </button>

                <button
                  onClick={exportDebugCells}
                  disabled={corners.length !== 4}
                  className="w-full px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded text-xs disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  🐛 导出前3行格子图（调试）
                </button>
              </div>

              <div className="bg-white rounded-lg p-4 shadow-sm">
                <button
                  onClick={runOcr}
                  disabled={ocrLoading || corners.length !== 4}
                  className="w-full px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {engineLoading
                    ? '⏳ 后端引擎加载中...'
                    : ocrLoading
                    ? '🔤 识别中...'
                    : '🚀 开始逐格 OCR'}
                </button>
                {ocrLoading && (
                  <div className="mt-3">
                    <button
                      onClick={cancelOcr}
                      className="w-full px-3 py-1 bg-red-100 hover:bg-red-200 text-red-600 rounded text-xs"
                    >
                      取消识别
                    </button>
                  </div>
                )}
                {progress && (
                  <div className="mt-3">
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-500 h-full transition-all"
                        style={{
                          width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 mt-1 text-center">
                      {progress.done} / {progress.total}
                      {progress.current
                        ? `  ·  当前: 第${progress.current.row + 1}行 第${progress.current.col + 1}列`
                        : ''}
                    </div>
                  </div>
                )}
                <div className="text-xs text-gray-400 mt-3">
                  OCR 在后端运行（PaddleOCR），首次启动服务器会加载模型（约 0.2-2 秒）。格子较多时请耐心等待。
                </div>
              </div>

              {/* 选中格预览/修正 */}
              {result && selectedCell && (
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="text-sm font-medium mb-2">
                    第 {selectedCell.r} 行 第 {selectedCell.c} 列
                  </div>
                  <input
                    type="text"
                    value={result.rawGrid[selectedCell.r]?.[selectedCell.c] || ''}
                    onChange={(e) => fixCell(selectedCell.r, selectedCell.c, e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    placeholder="物料代码（如 C26）"
                  />
                  <div className="text-xs text-gray-400 mt-1">
                    规范化：{result.codeGrid[selectedCell.r]?.[selectedCell.c] || '（空）'}
                  </div>
                  <button
                    onClick={() => setSelectedCell(null)}
                    className="mt-2 text-xs text-gray-500 hover:underline"
                  >
                    关闭
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 结果区 */}
        {result && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 统计表 */}
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-medium">
                  物料统计（{result.stats.length} 种）
                </h2>
                <button
                  onClick={exportCsv}
                  className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs"
                >
                  ⬇️ 导出 CSV
                </button>
              </div>
              <div className="text-xs text-gray-400 mb-3">
                共 {result.totalCells} 格，有效识别 {result.recognizedCells} 格（
                {result.totalCells
                  ? Math.round((result.recognizedCells / result.totalCells) * 100)
                  : 0}
                %）
              </div>
              <div className="max-h-96 overflow-auto border border-gray-200 rounded">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">物料代码</th>
                      <th className="text-right px-3 py-2 font-medium">数量</th>
                      <th className="text-right px-3 py-2 font-medium">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.stats.map((s) => (
                      <tr key={s.code} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-mono">{s.code}</td>
                        <td className="px-3 py-1.5 text-right">{s.count}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400">
                          {result.totalCells
                            ? ((s.count / result.totalCells) * 100).toFixed(1)
                            : 0}
                          %
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 原始识别网格 */}
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h2 className="font-medium mb-3">
                原始识别网格（点击任一格可修正）
              </h2>
              <RawGrid
                grid={result.codeGrid}
                onSelect={(r, c) => setSelectedCell({ r, c })}
                selected={selectedCell}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 绘制网格预览线（屏幕坐标版）：把四角定义的网格用透视绘制，再经 n2s 转屏幕坐标。
 */
function drawGridOverlayScreen(
  ctx: CanvasRenderingContext2D,
  corners: Point4,
  totalCols: number,
  totalRows: number,
  n2s: (p: Point) => Point
) {
  const dstCorners: Point4 = [
    { x: 0, y: 0 },
    { x: totalCols, y: 0 },
    { x: totalCols, y: totalRows },
    { x: 0, y: totalRows },
  ];
  const H = solveHomography(dstCorners, corners); // dst(网格坐标) -> src(图片自然坐标)
  if (!H) return;

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  // 竖线
  for (let c = 0; c <= totalCols; c++) {
    const top = n2s(applyHomography(H, { x: c, y: 0 }));
    const bot = n2s(applyHomography(H, { x: c, y: totalRows }));
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bot.x, bot.y);
    ctx.stroke();
  }
  // 横线
  for (let r = 0; r <= totalRows; r++) {
    const l = n2s(applyHomography(H, { x: 0, y: r }));
    const rr = n2s(applyHomography(H, { x: totalCols, y: r }));
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(rr.x, rr.y);
    ctx.stroke();
  }
}

/**
 * 放大镜：在拖拽中的顶点附近显示一个圆形放大区域，方便精确定位。
 * 把源图以更高 zoom 在圆内绘制，圆心十字准星对准顶点。
 */
function drawMagnifier(
  ctx: CanvasRenderingContext2D,
  corner: Point,
  img: HTMLImageElement,
  viewScale: number,
  n2s: (p: Point) => Point
) {
  const sp = n2s(corner);
  const MAG = 4; // 放大倍数相对当前 view
  const R = 70; // 放大镜半径（屏幕像素）
  // 放大镜放在顶点右下方，避免遮挡左上区域；若靠近右边缘则放左下
  let cx = sp.x + R + 16;
  let cy = sp.y + R + 16;
  const canvasW = ctx.canvas.width / (window.devicePixelRatio || 1);
  const canvasH = ctx.canvas.height / (window.devicePixelRatio || 1);
  if (cx + R > canvasW - 4) cx = sp.x - R - 16;
  if (cy + R > canvasH - 4) cy = sp.y - R - 16;

  ctx.save();
  // 圆形裁剪
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.closePath();
  // 阴影底
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  ctx.clip();
  // 在圆内以 (cx,cy) 为中心、MAG 倍 zoom 绘制源图。
  // 用源裁剪（9 参数 drawImage）只绘制圆覆盖的那一小块源图区域，
  // 避免 zoom 很大时目标尺寸超 canvas 上限导致崩溃白屏。
  const zoom = viewScale * MAG;
  if (Number.isFinite(zoom) && zoom > 0 && img.naturalWidth > 0 && img.naturalHeight > 0) {
    // 圆覆盖的源图区域：以 corner 为中心，半径 R/zoom 的自然坐标范围
    const srcR = R / zoom;
    const sx = Math.max(0, corner.x - srcR);
    const sy = Math.max(0, corner.y - srcR);
    const sx2 = Math.min(img.naturalWidth, corner.x + srcR);
    const sy2 = Math.min(img.naturalHeight, corner.y + srcR);
    const sw = sx2 - sx;
    const sh = sy2 - sy;
    if (sw > 0 && sh > 0) {
      // 这块源区域在圆内屏幕坐标的位置
      const dx = sx * zoom + (cx - corner.x * zoom);
      const dy = sy * zoom + (cy - corner.y * zoom);
      const dw = sw * zoom;
      const dh = sh * zoom;
      if (dw > 0 && dh > 0) {
        ctx.imageSmoothingEnabled = false; // 放大时显示像素，便于对齐格子线
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      }
    }
  }

  // 十字准星（圆心 = 顶点位置）
  ctx.strokeStyle = 'rgba(239,68,68,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx, cy + 10);
  ctx.stroke();
  ctx.restore();

  // 放大镜边框
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** 原始识别网格展示组件（紧凑表格，点击可修正） */
const RawGrid: React.FC<{
  grid: string[][];
  onSelect: (r: number, c: number) => void;
  selected: { r: number; c: number } | null;
}> = ({ grid, onSelect, selected }) => {
  if (!grid.length) return null;
  const totalRows = grid.length;
  const totalCols = grid[0].length;
  return (
    <div className="overflow-auto border border-gray-200 rounded" style={{ maxHeight: 400 }}>
      <table className="text-xs border-collapse">
        <tbody>
          {grid.map((rowArr, r) => (
            <tr key={r}>
              {rowArr.map((code, c) => {
                const isSel = selected && selected.r === r && selected.c === c;
                return (
                  <td
                    key={c}
                    onClick={() => onSelect(r, c)}
                    className={`border border-gray-100 px-1.5 py-0.5 text-center font-mono cursor-pointer ${
                      code ? 'hover:bg-blue-50' : 'bg-red-50 text-red-300 hover:bg-red-100'
                    } ${isSel ? 'ring-2 ring-blue-400' : ''}`}
                    style={{ minWidth: 32, maxWidth: 48 }}
                    title={code || '未识别'}
                  >
                    {code || '·'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {totalRows > 0 && (
        <div className="text-xs text-gray-400 p-2">
          {totalCols} 列 × {totalRows} 行 · 红色格 = 未识别，点击修正
        </div>
      )}
    </div>
  );
};

export default GridOcrTest;
