// 图纸网格识别弹窗：集成 GridOcrTest 的成熟画布/OCR 逻辑，用于图纸档案页面。
//
// 与独立测试页的区别：
//  - 以弹窗形式呈现（fixed inset-0）
//  - 图片来自图纸档案已上传的图纸图片（可切换），而非本地上传
//  - 识别完成后，物料代码自动匹配产品库（products）得到 product_id
//  - 「确认」直接替换当前材料清单（BOM），而非仅统计/导出
//
// 画布渲染沿用 GridOcrTest 的视口裁剪 drawImage（避免放大后超过 16384px 上限导致白屏）。

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  detectGrid,
  type GridDetectResult,
} from '../utils/gridDetect';
import {
  recognizeGrid,
  getOcrStatus,
  recomputeStats,
  normalizeCode,
  normalizeCodeLenient,
  CODE_REGEX,
  CELL_WARP_PX,
  RECOG_SCALE,
  type CellOcrResult,
  type CellOcrProgress,
} from '../utils/cellOcr';
import { warpImageToCanvas, solveHomography, applyHomography, type Point, type Point4 } from '../utils/perspective';
import { downloadPindouProject, buildPindouProject } from '../utils/pixelExport';

export interface DrawingGridOcrImage {
  id?: number;
  file_path: string;
  file_name?: string;
  image_type?: string;
}

export interface DrawingGridOcrProduct {
  id: number;
  code: string;
  category_name?: string;
  color_hex?: string;
}

/** 单张图纸的识别状态快照（按图缓存，切换图片时保留框选/识别结果） */
interface PerImageState {
  corners: Point[];
  cols: number;
  rows: number;
  result: CellOcrResult | null;
  warpedBg: string;                 // dataURL
  warpedCanvas: HTMLCanvasElement | null;
  resultView: boolean;
}

interface DrawingGridOcrModalProps {
  /** 图纸 ID（用于持久化框选状态到 localStorage） */
  drawingId?: number;
  /** 图纸的图片列表（通常来自 GET /drawings/:id 的 images 字段） */
  images: DrawingGridOcrImage[];
  /** 产品库（用于把识别到的物料代码映射为 product_id） */
  products: DrawingGridOcrProduct[];
  /** 当前图纸已保存的材料清单（用于差异核对，{ product_id, quantity }） */
  existingMaterials?: Array<{ product_id?: number | null; quantity?: number | null }>;
  /** 确认替换 BOM：返回 [{ product_id, quantity }]，调用方据此 setMaterials */
  onConfirm: (materials: Array<{ product_id: number; quantity: number; code: string; unmatched?: boolean }>) => void;
  onClose: () => void;
}

/** 视图变换：自然像素 → 屏幕 = natural × scale + offset */
interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const DrawingGridOcrModal: React.FC<DrawingGridOcrModalProps> = ({
  drawingId,
  images,
  products,
  existingMaterials,
  onConfirm,
  onClose,
}) => {
  // 可用图纸图片：保留所有图片（blueprint + completion 等），blueprint 排在第一位作为默认选择
  // 旧逻辑只在有多张 blueprint 时才显示选择器，但图纸档案通常只有 1 张 blueprint + 若干 completion，
  // 导致用户无法选择 completion 图纸进行 OCR。现在所有图片都可选，blueprint 优先。
  const drawingImages: DrawingGridOcrImage[] = (() => {
    if (!images || images.length === 0) return [];
    const blueprints = images.filter((i) => i.image_type === 'blueprint');
    const others = images.filter((i) => i.image_type !== 'blueprint');
    return [...blueprints, ...others];
  })();
  const [selectedImage, setSelectedImage] = useState<DrawingGridOcrImage | null>(drawingImages[0] || null);

  const [imgUrl, setImgUrl] = useState<string>('');
  const [imgLoaded, setImgLoaded] = useState(false);

  // 四角（自然像素坐标）+ 格子数（物料区）
  const [corners, setCorners] = useState<Point[]>([]);
  const [cols, setCols] = useState<number>(50);
  const [rows, setRows] = useState<number>(50);
  const [showGrid, setShowGrid] = useState(true);
  const [keepRect, setKeepRect] = useState(true);
  const [detectInfo, setDetectInfo] = useState<string>('');

  // 视图变换
  const [view, setView] = useState<View>({ scale: 1, offsetX: 0, offsetY: 0 });

  // OCR 状态
  const [ocrLoading, setOcrLoading] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);
  const [progress, setProgress] = useState<CellOcrProgress | null>(null);
  const [result, setResult] = useState<CellOcrResult | null>(null);
  const [resultView, setResultView] = useState<boolean>(false); // true=结果面板, false=框选面板
  const cancelledRef = useRef(false);

  // 选中格（用于修正）
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);

  // 正在编辑的格（双击进入编辑）
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);

  // 结果面板的显示开关
  const [highlightEmpty, setHighlightEmpty] = useState<boolean>(true); // 高亮空白格
  const [hideCodeLayer, setHideCodeLayer] = useState<boolean>(false); // 隐藏物料代码层（只看底层图纸）
  const [showColorLayer, setShowColorLayer] = useState<boolean>(false); // 显示纯色图纸层（代码层下、底图上）

  // 物料统计表点击某行 → 右侧网格高亮该代码的所有格子（高饱和度黄色）
  const [highlightCode, setHighlightCode] = useState<string | null>(null);

  // 物料统计表排序：sortKey（按哪列排）+ sortDir（升/降序）
  // sortKey: 'code' | 'count' | 'orig' | 'diff'，默认按数量降序
  const [sortKey, setSortKey] = useState<'code' | 'count' | 'orig' | 'diff'>('code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // 多选：批量修改物料代码。key 形如 "r,c"
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const [batchEditOpen, setBatchEditOpen] = useState<boolean>(false);

  const toggleMultiSelect = (r: number, c: number) => {
    setMultiSelect((prev) => {
      const next = new Set(prev);
      const key = `${r},${c}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const clearMultiSelect = () => setMultiSelect(new Set());

  // 批量修改：把所有选中的格子改成同一个物料代码
  const applyBatchCode = (value: string) => {
    if (!result || multiSelect.size === 0) return;
    const code = normalizeCode(value);
    const newCodeGrid = result.codeGrid.map((row) => row.slice());
    const newRawGrid = result.rawGrid.map((row) => row.slice());
    multiSelect.forEach((key) => {
      const [r, c] = key.split(',').map(Number);
      if (r >= 0 && r < newCodeGrid.length && c >= 0 && c < newCodeGrid[r].length) {
        newCodeGrid[r][c] = code;
        newRawGrid[r][c] = value;
      }
    });
    const stats = recomputeStats(newCodeGrid);
    const newResult = { ...result, codeGrid: newCodeGrid, rawGrid: newRawGrid, stats };
    setResult(newResult);
    clearMultiSelect();
    setBatchEditOpen(false);
    // 同步写入按图缓存
    const fp = selectedImage?.file_path;
    if (fp) {
      const cached = imageStateCache.current.get(fp);
      if (cached) {
        imageStateCache.current.set(fp, { ...cached, result: newResult });
        setCacheVersion((v) => v + 1);
      }
    }
  };

  // 导出 .pindou 项目文件：可在像素化模块加载继续编辑
  const [exportingImg, setExportingImg] = useState<boolean>(false);
  const handleExportPixelImage = () => {
    if (!result) return;
    setExportingImg(true);
    try {
      const ok = downloadPindouProject(result.codeGrid, products);
      if (!ok) {
        alert('导出失败（可能没有有效物料格）');
      }
    } catch (err) {
      console.error('[drawing-grid-ocr] 导出失败:', err);
      alert('导出失败：' + (err as Error).message);
    } finally {
      setExportingImg(false);
    }
  };

  // 写入项目：把当前识别结果生成 .pindou，直接上传绑定到当前图片（不下载到本地）
  const [writingProject, setWritingProject] = useState<boolean>(false);
  const handleWriteProject = async () => {
    if (!result) return;
    if (drawingId == null) { alert('缺少图纸 ID，无法写入'); return; }
    const imageId = selectedImage?.id;
    if (imageId == null) { alert('缺少图片 ID，无法写入'); return; }
    setWritingProject(true);
    try {
      const project = buildPindouProject(result.codeGrid, products);
      if (!project) { alert('没有有效物料格，无法生成项目文件'); return; }
      const json = JSON.stringify(project, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const fname = `${(selectedImage?.file_name || 'project').replace(/\.[^.]+$/, '')}.pindou`;
      const file = new File([blob], fname, { type: 'application/json' });
      const form = new FormData();
      form.append('project', file);
      const token = localStorage.getItem('token') || '';
      const resp = await fetch(`/api/drawings/${drawingId}/images/${imageId}/project-file`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      alert('项目文件已写入并绑定到当前图片');
    } catch (err) {
      console.error('[drawing-grid-ocr] 写入项目失败:', err);
      alert('写入项目失败：' + (err as Error).message);
    } finally {
      setWritingProject(false);
    }
  };

  // 单元格预览弹窗：查看某个物料代码对应的所有格子图
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  // 拉正画布缓存（OCR 完成后生成一次，预览弹窗按 code 提取对应格子）
  const warpedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // refs
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 交互状态
  const dragIdxRef = useRef<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const dragViewRef = useRef<{ startX: number; startY: number; startOffX: number; startOffY: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // 把用户框选的图纸区域透视拉正，作为结果网格的背景图（与识别用的格子完全对齐）。
  // 注意：只在 OCR 完成进入结果页时生成一次，不在后续编辑中重算（否则会闪烁/丢失）。
  const [warpedBg, setWarpedBg] = useState<string>('');

  // 物料代码 → 产品色（用于纯色图纸层填充）。products 稳定，映射一次即可。
  const colorMap = useMemo(() => {
    const m: Record<string, string> = {};
    products.forEach((p) => {
      if (p.color_hex) m[p.code] = p.color_hex;
    });
    return m;
  }, [products]);

  // 现有 BOM：product_id → 累计数量（可能有多行同物料），再映射到 物料代码 → 原始数量
  const originalQtyByCode = useMemo(() => {
    const m: Record<string, number> = {};
    if (!existingMaterials || !products) return m;
    // product_id → code
    const codeByPid = new Map<number, string>();
    products.forEach((p) => codeByPid.set(p.id, p.code));
    existingMaterials.forEach((row) => {
      const pid = row.product_id;
      const qty = Number(row.quantity) || 0;
      if (pid == null) return;
      const code = codeByPid.get(pid);
      if (!code) return;
      m[code] = (m[code] || 0) + qty;
    });
    return m;
  }, [existingMaterials, products]);

  // ===== 按图缓存：切换图片时保留每张图的识别状态（四角/行列/结果/背景图）=====
  const imageStateCache = useRef<Map<string, PerImageState>>(new Map());
  // 缓存版本号：每次写缓存自增，驱动聚合统计 memo 重算（Map 内部变化不会触发渲染）
  const [cacheVersion, setCacheVersion] = useState(0);

  // ===== 持久化到 localStorage：刷新页面/重开弹窗后仍保留框选和识别结果 =====
  // key = pindou:gridOcr:<drawingId>，value = 可序列化的 per-image 状态数组
  // 注意 warpedCanvas 是 HTMLCanvasElement 无法序列化，只持久化 warpedBg(dataURL)，
  // 重新打开时背景图仍能从 dataURL 恢复显示；单元格预览弹窗（需 warpedCanvas）则需重新识别才可用。
  const STORAGE_KEY = useMemo(
    () => (drawingId != null ? `pindou:gridOcr:${drawingId}` : ''),
    [drawingId]
  );
  // 启动时从 localStorage 加载，并清理指向已删除图片的残留记录
  useEffect(() => {
    if (!STORAGE_KEY) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as Array<{ filePath: string; st: PerImageState }>;
      // 当前可用图片的 file_path 集合（用于剔除残留：指向已删除图片的记录）
      const validPaths = new Set(drawingImages.map((i) => i.file_path));
      let removedStale = false;
      arr.forEach(({ filePath, st }) => {
        if (!validPaths.has(filePath)) {
          // 残留记录：对应图片已删除，跳过并标记需回写
          removedStale = true;
          return;
        }
        // warpedCanvas 不可序列化，恢复为 null（背景图走 warpedBg dataURL）
        imageStateCache.current.set(filePath, { ...st, warpedCanvas: null });
      });
      // 若清理了残留，立即回写 localStorage（避免下次还加载到失效条目）
      if (removedStale) {
        const cleaned: Array<{ filePath: string; st: PerImageState }> = [];
        imageStateCache.current.forEach((st, filePath) => {
          if (st.corners.length === 4 || st.result) cleaned.push({ filePath, st });
        });
        if (cleaned.length === 0) {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
        }
      }
      setCacheVersion((v) => v + 1);
    } catch (e) {
      console.warn('[drawing-grid-ocr] 恢复持久化状态失败:', e);
    }
    // 仅启动时加载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [STORAGE_KEY]);
  // cacheVersion 变化时写入 localStorage（防抖：用 setTimeout 合并连续写入）
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!STORAGE_KEY) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      try {
        const arr: Array<{ filePath: string; st: PerImageState }> = [];
        imageStateCache.current.forEach((st, filePath) => {
          // 跳过空状态（无框选无结果），避免存无用条目
          if (st.corners.length === 4 || st.result) {
            arr.push({ filePath, st });
          }
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      } catch (e) {
        // localStorage 满或禁用，静默忽略
        console.warn('[drawing-grid-ocr] 持久化状态写入失败:', e);
      }
    }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion, STORAGE_KEY]);

  // 聚合统计：合并所有已识别图的结果（按 code 求和）
  const aggregatedStats = useMemo(() => {
    const map = new Map<string, number>();
    imageStateCache.current.forEach((st) => {
      if (st.result) {
        st.result.stats.forEach((s) => {
          map.set(s.code, (map.get(s.code) || 0) + s.count);
        });
      }
    });
    return Array.from(map.entries()).map(([code, count]) => ({ code, count }));
    // 依赖 cacheVersion + result 触发重算
  }, [cacheVersion, result]);

  // 已识别的图片数 + 聚合物料格总数（顶栏展示）
  const recognizedImageCount = useMemo(() => {
    let n = 0;
    imageStateCache.current.forEach((st) => { if (st.result) n += 1; });
    return n;
  }, [cacheVersion, result]);
  const aggregatedTotalCells = aggregatedStats.reduce((s, x) => s + x.count, 0);

  // 物料统计表排序后的列表（依赖 sortKey/sortDir + 原始数量）
  // 合并策略：所有已识别图的合计（aggregatedStats）+ 原始 BOM 中"未识别到"的物料（count=0），
  // 让用户能看到"原始有、没识别到"的物料，避免遗漏。
  const sortedStats = useMemo(() => {
    // 1. 聚合识别结果 enrich（带原始数量）
    const byCode = new Map<string, { code: string; count: number; orig: number; diff: number }>();
    aggregatedStats.forEach((s) => {
      const orig = originalQtyByCode[s.code] || 0;
      byCode.set(s.code, { code: s.code, count: s.count, orig, diff: s.count - orig });
    });
    // 2. 补入原始 BOM 中未识别到的物料（count=0）
    Object.entries(originalQtyByCode).forEach(([code, orig]) => {
      if (!byCode.has(code)) {
        byCode.set(code, { code, count: 0, orig, diff: 0 - orig });
      }
    });
    const enriched = Array.from(byCode.values());
    const dir = sortDir === 'asc' ? 1 : -1;
    return enriched.slice().sort((a, b) => {
      if (sortKey === 'code') {
        // 代码按字母+数字自然排序
        return a.code.localeCompare(b.code, 'en', { numeric: true }) * dir;
      }
      if (sortKey === 'count') return (a.count - b.count) * dir;
      if (sortKey === 'orig') return (a.orig - b.orig) * dir;
      // diff
      return (a.diff - b.diff) * dir;
    });
  }, [aggregatedStats, originalQtyByCode, sortKey, sortDir]);

  // 点击表头切换排序：同列点击切换升降序，不同列切换到该列（默认降序）
  const toggleSort = (key: 'code' | 'count' | 'orig' | 'diff') => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // 代码默认升序（A→Z），数值列默认降序（多→少）
      setSortDir(key === 'code' ? 'asc' : 'desc');
    }
  };

  // 切换图片时：从按图缓存恢复状态（若有），否则首次进入清空
  const skipAutoDetectRef = useRef(false); // 该图已缓存过框选时，加载完成后跳过 autoDetect
  const suppressCacheSyncRef = useRef(false); // 恢复缓存时抑制同步 effect，避免循环
  useEffect(() => {
    if (selectedImage && selectedImage.file_path) {
      setImgUrl(`${window.location.origin}/uploads/drawings/${selectedImage.file_path}`);
      setImgLoaded(false);
      const cached = imageStateCache.current.get(selectedImage.file_path);
      suppressCacheSyncRef.current = true; // 接下来要 set 一批状态，抑制同步
      if (cached) {
        // 恢复该图的识别状态
        setCorners(cached.corners.map((p) => ({ ...p })));
        setCols(cached.cols);
        setRows(cached.rows);
        setResult(cached.result);
        setResultView(cached.resultView);
        setWarpedBg(cached.warpedBg);
        warpedCanvasRef.current = cached.warpedCanvas;
        skipAutoDetectRef.current = true; // 已有框选，跳过自动检测
        setDetectInfo(cached.result ? '已恢复该图的识别结果' : '已恢复该图的框选');
      } else {
        // 首次进入该图：清空，待加载完成后自动检测
        setCorners([]);
        setResult(null);
        setResultView(false);
        setWarpedBg('');
        warpedCanvasRef.current = null;
        skipAutoDetectRef.current = false;
        setDetectInfo('');
      }
      // 切图时清空编辑/多选状态，避免跨图错位
      setEditingCell(null);
      setSelectedCell(null);
      setHighlightCode(null);
      clearMultiSelect();
      // 下一帧解除抑制（让这批 set 落定后再恢复同步）
      setTimeout(() => { suppressCacheSyncRef.current = false; }, 0);
    } else {
      setImgUrl('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImage]);

  // 框选状态（四角/行列）变化时同步到当前图缓存（用户手动调整框选后保存）
  useEffect(() => {
    if (suppressCacheSyncRef.current) return;
    const fp = selectedImage?.file_path;
    if (!fp) return;
    // 四角已设置（自动检测或手动框选完成）才写入缓存，避免空状态污染
    if (corners.length !== 4) return;
    const prev = imageStateCache.current.get(fp);
    imageStateCache.current.set(fp, {
      corners: corners.map((p) => ({ ...p })),
      cols,
      rows,
      result: prev?.result ?? null,
      warpedBg: prev?.warpedBg ?? '',
      warpedCanvas: prev?.warpedCanvas ?? null,
      resultView: prev?.resultView ?? false,
    });
    setCacheVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corners, cols, rows]);

  // 图片加载完成后：fit + 自动检测（仅首次进入该图时自动检测，已缓存则跳过）
  const onImgLoad = useCallback(() => {
    setImgLoaded(true);
    setTimeout(() => {
      fitToView();
      if (!skipAutoDetectRef.current) {
        autoDetect();
      }
    }, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // 坐标换算
  const screenToNatural = useCallback(
    (sx: number, sy: number): Point => ({
      x: (sx - view.offsetX) / view.scale,
      y: (sy - view.offsetY) / view.scale,
    }),
    [view]
  );

  const getMouseInCanvas = useCallback((e: React.MouseEvent | MouseEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const hitTestCorner = useCallback(
    (screenPt: Point): number => {
      if (corners.length !== 4) return -1;
      let nearest = -1;
      let bestDist = 16;
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

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const sp = getMouseInCanvas(e);
    if (!sp) return;
    if (e.button === 2) return;
    const hit = hitTestCorner(sp);
    if (hit >= 0) {
      dragIdxRef.current = hit;
      setDraggingIdx(hit);
      e.preventDefault();
      return;
    }
    dragViewRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffX: view.offsetX,
      startOffY: view.offsetY,
    };
    setPanning(true);
  };

  // 全局 mousemove/mouseup
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const sp = getMouseInCanvas(e);
      if (!sp) return;
      if (dragIdxRef.current !== null) {
        const np = screenToNatural(sp.x, sp.y);
        const idx = dragIdxRef.current;
        const img = imgRef.current;
        const cx = img ? Math.max(0, Math.min(np.x, img.naturalWidth)) : np.x;
        const cy = img ? Math.max(0, Math.min(np.y, img.naturalHeight)) : np.y;
        setCorners((prev) => {
          if (prev.length !== 4) return prev;
          const next = prev.map((p) => ({ ...p }));
          next[idx] = { x: cx, y: cy };
          if (keepRect) {
            const xPeer = idx === 0 ? 3 : idx === 1 ? 2 : idx === 2 ? 1 : 0;
            const yPeer = idx === 0 ? 1 : idx === 1 ? 0 : idx === 2 ? 3 : 2;
            next[xPeer].x = cx;
            next[yPeer].y = cy;
          }
          return next;
        });
        return;
      }
      if (panning && dragViewRef.current) {
        // 在事件回调里把 ref 当前值取出来存局部变量，避免 setView 的更新函数延迟执行时
        // dragViewRef.current 已被 onUp 置空导致 "Cannot read properties of null"。
        const drag = dragViewRef.current;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        setView((v) => ({
          ...v,
          offsetX: drag.startOffX + dx,
          offsetY: drag.startOffY + dy,
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

  // 滚轮缩放（鼠标位置为锚点）
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const sp = getMouseInCanvas(e);
      if (!sp) return;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const newScale = Math.max(0.05, Math.min(40, v.scale * factor));
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

  const handleContextMenu = (e: React.MouseEvent) => e.preventDefault();

  // 主绘制
  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!imgLoaded || !img || !canvas || !wrap) return;
    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const { scale, offsetX, offsetY } = view;
    if (![scale, offsetX, offsetY].every((v) => Number.isFinite(v))) return;
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
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, rect.width, rect.height);

      // 视口裁剪绘制图片（避免放大后 drawImage 目标尺寸超 canvas 上限 → 白屏）
      if (scale > 0 && Number.isFinite(scale)) {
        const visLeftNat = -offsetX / scale;
        const visTopNat = -offsetY / scale;
        const visWidthNat = rect.width / scale;
        const visHeightNat = rect.height / scale;
        const sx = Math.max(0, visLeftNat);
        const sy = Math.max(0, visTopNat);
        const sx2 = Math.min(img.naturalWidth, visLeftNat + visWidthNat);
        const sy2 = Math.min(img.naturalHeight, visTopNat + visHeightNat);
        const sw = sx2 - sx;
        const sh = sy2 - sy;
        if (sw > 0 && sh > 0) {
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

      const n2s = (p: Point): Point => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY });

      if (corners.length >= 4 && showGrid) {
        const p4: Point4 = [corners[0], corners[1], corners[2], corners[3]];
        drawGridOverlayScreen(ctx, p4, cols, rows, n2s);
      }
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

      if (draggingIdx !== null && corners[draggingIdx]) {
        drawMagnifier(ctx, corners[draggingIdx], img, scale, n2s);
      }
    } catch (err) {
      console.warn('[drawing-grid-ocr] 渲染异常（已忽略）:', err);
    }
  }, [corners, cols, rows, showGrid, imgLoaded, view, draggingIdx]);

  // 注意：本弹窗不注册全局 ESC 关闭监听器。
  // 用户在物料核对阶段双击格子进入编辑，ESC 应当只用于退出单元格编辑（见 CellEditor），
  // 而不能关闭整个识别窗口，否则框选与识别结果会全部丢失。
  // 关闭弹窗请使用右上角 × 或底部按钮。

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
    const ocrStartFilePath = selectedImage?.file_path || '';
    setResult(null);
    setProgress({ done: 0, total: cols * rows });
    setOcrLoading(true);
    setEngineLoading(true);
    try {
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
      const res = await recognizeGrid(
        img,
        p4,
        cols,
        rows,
        (p) => {
          if (cancelledRef.current) return;
          setProgress({ ...p });
        },
        // 取消检查：每批发送前判断，真正终止后续请求
        () => cancelledRef.current
      );
      if (!cancelledRef.current) {
        // 切图保护：OCR 完成时若用户已切到别的图，丢弃结果（不写入当前图）
        if (ocrStartFilePath && ocrStartFilePath !== selectedImage?.file_path) {
          // 已切走，结果归档到 OCR 起始图（若仍在缓存范围内）
          const startCache = imageStateCache.current.get(ocrStartFilePath);
          if (startCache) {
            try {
              const c = warpImageToCanvas(img, p4, cols, rows, 64, 6);
              imageStateCache.current.set(ocrStartFilePath, {
                ...startCache, result: res, warpedBg: c.toDataURL('image/png'), warpedCanvas: c, resultView: true,
              });
            } catch {
              imageStateCache.current.set(ocrStartFilePath, { ...startCache, result: res, resultView: true });
            }
            setCacheVersion((v) => v + 1);
          }
        } else {
          // 仍在原图：生成背景图（仅一次），同时缓存拉正画布供单元格预览使用
          try {
            const c = warpImageToCanvas(img, p4, cols, rows, 64, 6);
            warpedCanvasRef.current = c;
            setWarpedBg(c.toDataURL('image/png'));
          } catch (e) {
            warpedCanvasRef.current = null;
            setWarpedBg('');
          }
          setResult(res);
          setResultView(true);
          // 写入按图缓存（注意：此时 warpedBg/warpedCanvas 已设置，用同步值）
          const fp = selectedImage?.file_path;
          if (fp) {
            const bg = warpedCanvasRef.current ? warpedCanvasRef.current.toDataURL('image/png') : '';
            imageStateCache.current.set(fp, {
              corners: corners.map((p) => ({ ...p })), cols, rows, result: res,
              warpedBg: bg, warpedCanvas: warpedCanvasRef.current, resultView: true,
            });
            setCacheVersion((v) => v + 1);
          }
        }
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg === 'CANCELLED' || cancelledRef.current) {
        // 用户主动取消，不报错
      } else {
        console.error('[drawing-grid-ocr] OCR failed', err);
        alert('OCR 失败：' + msg);
      }
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

  // 手动修正某格
  const fixCell = (r: number, c: number, value: string) => {
    if (!result) return;
    const newCodeGrid = result.codeGrid.map((row) => row.slice());
    const newRawGrid = result.rawGrid.map((row) => row.slice());
    const code = normalizeCode(value);
    newCodeGrid[r][c] = code;
    newRawGrid[r][c] = value;
    const stats = recomputeStats(newCodeGrid);
    const newResult = { ...result, codeGrid: newCodeGrid, rawGrid: newRawGrid, stats };
    setResult(newResult);
    // 同步写入按图缓存
    const fp = selectedImage?.file_path;
    if (fp) {
      const cached = imageStateCache.current.get(fp);
      if (cached) {
        imageStateCache.current.set(fp, { ...cached, result: newResult });
        setCacheVersion((v) => v + 1);
      }
    }
  };

  // 确认：把所有已识别图的物料代码合计 → 匹配产品库 → 替换 BOM
  const handleConfirmReplace = () => {
    if (aggregatedStats.length === 0) {
      alert('没有识别到物料');
      return;
    }
    const productByCode = new Map<string, DrawingGridOcrProduct>();
    products.forEach((p) => productByCode.set(p.code, p));

    const unmatched: string[] = [];
    const materials: Array<{ product_id: number; quantity: number; code: string; unmatched?: boolean }> = [];
    aggregatedStats.forEach((s) => {
      const prod = productByCode.get(s.code);
      if (prod) {
        materials.push({ product_id: prod.id, quantity: s.count, code: s.code });
      } else {
        unmatched.push(s.code);
      }
    });

    const imgInfo = recognizedImageCount > 1 ? `（合并 ${recognizedImageCount} 张图的识别结果）` : '';
    if (unmatched.length > 0) {
      const ok = window.confirm(
        `以下 ${unmatched.length} 个物料代码在产品库中不存在，将被跳过：\n${unmatched.slice(0, 30).join(', ')}${unmatched.length > 30 ? ' ...' : ''}\n\n是否继续替换材料清单？${imgInfo}（仅导入已匹配的 ${materials.length} 种）`
      );
      if (!ok) return;
    } else {
      const ok = window.confirm(
        `确认用识别结果替换当前材料清单吗？${imgInfo}\n\n将导入 ${materials.length} 种物料，现有材料清单会被清空。`
      );
      if (!ok) return;
    }

    if (materials.length === 0) {
      alert('没有可导入的物料（所有代码均未匹配产品库）');
      return;
    }
    onConfirm(materials);
    onClose();
  };

  // 无图纸图片
  if (drawingImages.length === 0) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
          <div className="text-center">
            <div className="text-gray-500 mb-4">该图纸暂无图片，请先上传图纸图片。</div>
            <button onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">关闭</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[95vw] max-w-[1400px] h-[92vh] flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-3 border-b">
          <h3 className="text-lg font-medium">图纸网格识别</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-sm">关闭</button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-hidden p-4">
          {/* 图片选择器：只要有多张图片就显示，让用户选择要对哪张图进行 OCR */}
          {drawingImages.length > 1 && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm text-gray-600">选择图纸：</span>
              <select
                value={selectedImage?.file_path || ''}
                onChange={(e) => {
                  const img = drawingImages.find((i) => i.file_path === e.target.value);
                  if (img) setSelectedImage(img);
                }}
                className="border rounded px-2 py-1 text-sm max-w-md"
                disabled={ocrLoading}
              >
                {drawingImages.map((img) => (
                  <option key={img.file_path} value={img.file_path}>
                    {img.image_type === 'blueprint' ? '【图纸】' : img.image_type === 'completion' ? '【完工】' : ''}
                    {img.file_name || img.file_path}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-400">共 {drawingImages.length} 张图片，可切换对任意一张进行识别</span>
            </div>
          )}

          {!resultView ? (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 h-[calc(92vh-180px)]">
              {/* 左：画布视口 */}
              <div className="bg-gray-50 rounded-lg p-2 flex flex-col">
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
                  className="relative overflow-hidden rounded select-none flex-1"
                  style={{ cursor: draggingIdx !== null ? 'grabbing' : panning ? 'grabbing' : 'crosshair' }}
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
                <p className="text-xs text-gray-400 mt-1 text-center">
                  滚轮缩放 ｜ 拖动空白处平移 ｜ 拖动红色顶点微调（拖拽时自动放大显示）
                  {view.scale !== 1 && (
                    <>
                      {' ｜ '}
                      <button onClick={fitToView} className="text-blue-500 hover:underline">重置缩放</button>
                    </>
                  )}
                </p>
              </div>

              {/* 右：控制面板 */}
              <div className="space-y-3 overflow-y-auto">
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
                      <label className="block text-xs font-medium text-gray-600 mb-1">横向格子数</label>
                      <input
                        type="number"
                        min={1}
                        value={cols}
                        onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">竖向格子数</label>
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
                    物料区 {cols} × {rows} = {cols * rows} 格
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-600 mb-2 cursor-pointer">
                    <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                    显示网格预览线
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-600 mb-3 cursor-pointer">
                    <input type="checkbox" checked={keepRect} onChange={(e) => setKeepRect(e.target.checked)} />
                    保持矩形（拖一角带动相邻两角）
                  </label>

                  <button
                    onClick={() => setCorners([])}
                    className="w-full px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs mb-2"
                  >
                    重置角点
                  </button>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <button
                    onClick={runOcr}
                    disabled={ocrLoading || corners.length !== 4}
                    className="w-full px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {engineLoading ? '⏳ 后端引擎加载中...' : ocrLoading ? '🔤 识别中...' : '🚀 开始逐格 OCR'}
                  </button>
                  {ocrLoading && (
                    <button
                      onClick={cancelOcr}
                      className="w-full mt-3 px-3 py-1 bg-red-100 hover:bg-red-200 text-red-600 rounded text-xs"
                    >
                      取消识别
                    </button>
                  )}
                  {progress && (
                    <div className="mt-3">
                      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-blue-500 h-full transition-all"
                          style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 mt-1 text-center">
                        {progress.done} / {progress.total}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* 结果面板 */
            <div className="h-[calc(92vh-180px)] flex flex-col">
              {result && (
                <>
                  {/* 顶栏：聚合物料数（所有已识别图合计） + 操作按钮 */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm text-gray-600">
                      {recognizedImageCount > 1 && (
                        <span className="mr-2 text-blue-600">已识别 {recognizedImageCount}/{drawingImages.length} 张图 ｜ </span>
                      )}
                      合计 <span className="font-medium text-green-600">{aggregatedTotalCells}</span> 个物料格，
                      <span className="font-medium"> {aggregatedStats.length}</span> 种物料
                      {sortedStats.length > aggregatedStats.length && (
                        <span className="text-amber-600"> （含原始 BOM 未识别到 {sortedStats.length - aggregatedStats.length} 种）</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setResultView(false); }}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm"
                        disabled={ocrLoading}
                      >
                        返回调整
                      </button>
                      <button
                        onClick={handleExportPixelImage}
                        disabled={exportingImg}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm disabled:bg-gray-300"
                        title="导出为 .pindou 像素化项目文件到本地，可在像素化模块加载继续编辑"
                      >
                        {exportingImg ? '导出中...' : '导出项目'}
                      </button>
                      <button
                        onClick={handleWriteProject}
                        disabled={writingProject}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm disabled:bg-gray-300"
                        title="把当前识别结果生成 .pindou 项目文件，直接写入并绑定到当前图片（不下载到本地）"
                      >
                        {writingProject ? '写入中...' : '写入项目'}
                      </button>
                      <button
                        onClick={handleConfirmReplace}
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium"
                      >
                        确认替换材料清单
                      </button>
                    </div>
                  </div>

                  {/* 批量修改工具栏：选中格子后出现 */}
                  {multiSelect.size > 0 && (
                    <div className="flex items-center justify-between mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded">
                      <div className="text-sm text-blue-700">
                        已选中 <span className="font-medium">{multiSelect.size}</span> 格
                        <span className="ml-2 text-xs text-blue-500">（Ctrl/⌘+点击 多选，双击编辑单格）</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setBatchEditOpen(true)}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                        >
                          批量修改代码
                        </button>
                        <button
                          onClick={clearMultiSelect}
                          className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-sm"
                        >
                          取消选择
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 overflow-hidden">
                    {/* 统计表（点击行高亮右侧对应格子） */}
                    <div className="bg-white rounded-lg p-3 shadow-sm flex flex-col overflow-hidden">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium text-sm">物料统计{highlightCode ? `（高亮: ${highlightCode}）` : ''}</h4>
                        {highlightCode && (
                          <button
                            onClick={() => setHighlightCode(null)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            清除高亮
                          </button>
                        )}
                      </div>
                      <div className="flex-1 overflow-auto border border-gray-200 rounded">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th
                                onClick={() => toggleSort('code')}
                                className="text-left px-3 py-2 font-medium cursor-pointer select-none hover:bg-gray-100"
                                title="点击排序"
                              >
                                物料代码{sortKey === 'code' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                              </th>
                              <th
                                onClick={() => toggleSort('count')}
                                className="text-right px-2 py-2 font-medium cursor-pointer select-none hover:bg-gray-100"
                                title="点击排序"
                              >
                                数量{sortKey === 'count' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                              </th>
                              <th
                                onClick={() => toggleSort('orig')}
                                className="text-right px-2 py-2 font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-100"
                                title="当前图纸已保存的数量，点击排序"
                              >
                                原始{sortKey === 'orig' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                              </th>
                              <th
                                onClick={() => toggleSort('diff')}
                                className="text-right px-2 py-2 font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-100"
                                title="识别数量 − 原始数量，点击排序"
                              >
                                差异{sortKey === 'diff' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                              </th>
                              <th className="text-left px-2 py-2 font-medium">匹配</th>
                              <th className="text-center px-2 py-2 font-medium" style={{ width: 48 }}>格子</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedStats.map((s) => {
                              const matched = products.find((p) => p.code === s.code);
                              const isHL = highlightCode === s.code;
                              const orig = s.orig;
                              const diff = s.diff;
                              // 本次未识别到但原始 BOM 有的物料：用琥珀色背景提示"可能遗漏"
                              const isMissing = s.count === 0 && orig > 0;
                              return (
                                <tr
                                  key={s.code}
                                  onClick={() => setHighlightCode(isHL ? null : s.code)}
                                  className={`border-t border-gray-100 cursor-pointer ${
                                    isHL ? 'bg-yellow-100' : isMissing ? 'bg-amber-50' : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <td className="px-3 py-1.5 font-mono flex items-center gap-2">
                                    {matched && matched.color_hex && (
                                      <span className="inline-block w-3 h-3 rounded border border-gray-300" style={{ backgroundColor: matched.color_hex }} />
                                    )}
                                    {s.code}
                                    {isMissing && (
                                      <span className="text-[10px] text-amber-600 bg-amber-100 px-1 rounded" title="原始 BOM 有此物料，但本次未识别到">未识别</span>
                                    )}
                                  </td>
                                  <td className={`px-2 py-1.5 text-right tabular-nums ${isMissing ? 'text-amber-600' : ''}`}>{s.count}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{orig || '-'}</td>
                                  <td className={`px-2 py-1.5 text-right tabular-nums ${diff !== 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                                    {diff > 0 ? `+${diff}` : (diff === 0 ? '0' : diff)}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    {matched ? (
                                      <span className="text-green-600 text-xs">✓ {matched.category_name || '已匹配'}</span>
                                    ) : (
                                      <span className="text-red-500 text-xs">未匹配产品库</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setPreviewCode(s.code); }}
                                      className="text-xs px-2 py-0.5 bg-gray-100 hover:bg-blue-100 hover:text-blue-700 rounded"
                                      title="查看识别为该物料的所有格子"
                                    >
                                      查看
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">点击表头排序 ｜ 点击行在右侧高亮对应格子</div>
                    </div>

                    {/* 原始网格（点击修正） */}
                    <div className="bg-white rounded-lg p-3 shadow-sm flex flex-col overflow-hidden">
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <h4 className="font-medium text-sm">原始识别网格（双击格子直接编辑，底层为截取的图纸）</h4>
                        <div className="flex items-center gap-3 text-xs">
                          <label className="flex items-center gap-1 cursor-pointer text-gray-600">
                            <input
                              type="checkbox"
                              checked={highlightEmpty}
                              onChange={(e) => setHighlightEmpty(e.target.checked)}
                            />
                            高亮空白格
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer text-gray-600">
                            <input
                              type="checkbox"
                              checked={showColorLayer}
                              onChange={(e) => setShowColorLayer(e.target.checked)}
                            />
                            纯色图纸层
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer text-gray-600">
                            <input
                              type="checkbox"
                              checked={hideCodeLayer}
                              onChange={(e) => setHideCodeLayer(e.target.checked)}
                            />
                            隐藏物料代码
                          </label>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 relative">
                        <RawGrid
                          grid={result.codeGrid}
                          warpedBg={warpedBg}
                          colorMap={colorMap}
                          showColorLayer={showColorLayer}
                          editingCell={editingCell}
                          highlightEmpty={highlightEmpty}
                          hideCodeLayer={hideCodeLayer}
                          highlightCode={highlightCode}
                          multiSelect={multiSelect}
                          onCellClick={(r, c) => {
                            // 单击：仅选中（不进入编辑）
                            setSelectedCell({ r, c });
                          }}
                          onCellDoubleClick={(r, c) => {
                            // 双击：进入编辑
                            setSelectedCell({ r, c });
                            setEditingCell({ r, c });
                          }}
                          onToggleMulti={(r, c) => toggleMultiSelect(r, c)}
                          onCommit={(r, c, value) => {
                            fixCell(r, c, value);
                            setEditingCell(null);
                          }}
                          onCancelEdit={() => setEditingCell(null)}
                        />
                      </div>
                      <div className="shrink-0 mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className="text-gray-500">
                          {result.codeGrid[0]?.length || 0} 列 × {result.codeGrid.length} 行
                          <span className="mx-1.5 text-gray-300">|</span>
                          滚轮缩放 ｜ 按住拖动平移 ｜ 双击格内编辑 ｜ Ctrl/⌘+点击 多选
                        </span>
                        {selectedCell && editingCell === null && (
                          <span className="px-2 py-1 bg-gray-100 border border-gray-200 rounded text-gray-600">
                            第 {selectedCell.r + 1} 行 第 {selectedCell.c + 1} 列 ｜ 当前：{result.codeGrid[selectedCell.r]?.[selectedCell.c] || '（空）'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 单元格预览弹窗 */}
      {previewCode && result && (
        <CellPreviewModal
          code={previewCode}
          codeGrid={result.codeGrid}
          warpedCanvas={warpedCanvasRef.current}
          color={products.find((p) => p.code === previewCode)?.color_hex}
          cellPx={64}
          products={products}
          onClose={() => setPreviewCode(null)}
          onBatchFix={(cells, newCode) => {
            // 在父组件把选中的格子统一改成 newCode
            const newCodeGrid = result.codeGrid.map((row) => row.slice());
            const newRawGrid = result.rawGrid.map((row) => row.slice());
            cells.forEach(({ r, c }) => {
              newCodeGrid[r][c] = newCode;
              newRawGrid[r][c] = newCode;
            });
            const stats = recomputeStats(newCodeGrid);
            const newResult = { ...result, codeGrid: newCodeGrid, rawGrid: newRawGrid, stats };
            setResult(newResult);
            // 同步写入按图缓存
            const fp = selectedImage?.file_path;
            if (fp) {
              const cached = imageStateCache.current.get(fp);
              if (cached) {
                imageStateCache.current.set(fp, { ...cached, result: newResult });
                setCacheVersion((v) => v + 1);
              }
            }
          }}
        />
      )}

      {/* 批量修改代码弹窗 */}
      {batchEditOpen && (
        <BatchEditModal
          count={multiSelect.size}
          products={products}
          onApply={applyBatchCode}
          onClose={() => setBatchEditOpen(false)}
        />
      )}
    </div>
  );
};

/**
 * 绘制网格预览线（屏幕坐标版）。
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
  const H = solveHomography(dstCorners, corners);
  if (!H) return;

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= totalCols; c++) {
    const top = n2s(applyHomography(H, { x: c, y: 0 }));
    const bot = n2s(applyHomography(H, { x: c, y: totalRows }));
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bot.x, bot.y);
    ctx.stroke();
  }
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
 * 放大镜：拖拽顶点时在顶点附近显示圆形放大区域。
 */
function drawMagnifier(
  ctx: CanvasRenderingContext2D,
  corner: Point,
  img: HTMLImageElement,
  viewScale: number,
  n2s: (p: Point) => Point
) {
  const sp = n2s(corner);
  const MAG = 4;
  const R = 70;
  let cx = sp.x + R + 16;
  let cy = sp.y + R + 16;
  const canvasW = ctx.canvas.width / (window.devicePixelRatio || 1);
  const canvasH = ctx.canvas.height / (window.devicePixelRatio || 1);
  if (cx + R > canvasW - 4) cx = sp.x - R - 16;
  if (cy + R > canvasH - 4) cy = sp.y - R - 16;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  ctx.clip();
  const zoom = viewScale * MAG;
  if (Number.isFinite(zoom) && zoom > 0 && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const srcR = R / zoom;
    const sx = Math.max(0, corner.x - srcR);
    const sy = Math.max(0, corner.y - srcR);
    const sx2 = Math.min(img.naturalWidth, corner.x + srcR);
    const sy2 = Math.min(img.naturalHeight, corner.y + srcR);
    const sw = sx2 - sx;
    const sh = sy2 - sy;
    if (sw > 0 && sh > 0) {
      const dx = sx * zoom + (cx - corner.x * zoom);
      const dy = sy * zoom + (cy - corner.y * zoom);
      const dw = sw * zoom;
      const dh = sh * zoom;
      if (dw > 0 && dh > 0) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      }
    }
  }

  ctx.strokeStyle = 'rgba(239,68,68,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx, cy + 10);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * 原始识别网格展示组件（正方形单元格 + 底层图纸背景 + 双击行内编辑）。
 *
 * - 用 CSS Grid 保证每格是正方形
 * - 拉正图作为网格容器的 background-image（直接绘制在格子上），所有格子背景透明，背景永不被遮挡
 * - 滚轮缩放（范围放宽到完整可见 ~ 128px），按住拖拽平移
 * - 双击格子进入行内编辑（input 自动聚焦并选中），回车/失焦提交，Esc 取消
 */
const RawGrid: React.FC<{
  grid: string[][];
  warpedBg?: string;
  /** 物料代码 → 颜色（纯色图纸层填充用） */
  colorMap?: Record<string, string>;
  /** 是否显示纯色图纸层（代码层下、底图上） */
  showColorLayer?: boolean;
  editingCell: { r: number; c: number } | null;
  highlightEmpty: boolean;
  hideCodeLayer: boolean;
  /** 高亮某个物料代码的所有格子（高饱和度黄色） */
  highlightCode?: string | null;
  /** 多选集合（key "r,c"） */
  multiSelect?: Set<string>;
  /** Ctrl/⌘+点击 或 Shift+点击：切换多选 */
  onToggleMulti?: (r: number, c: number) => void;
  onCellClick: (r: number, c: number) => void;
  onCellDoubleClick: (r: number, c: number) => void;
  onCommit: (r: number, c: number, value: string) => void;
  onCancelEdit: () => void;
}> = ({ grid, warpedBg, colorMap, showColorLayer, editingCell, highlightEmpty, hideCodeLayer, highlightCode, multiSelect, onToggleMulti, onCellClick, onCellDoubleClick, onCommit, onCancelEdit }) => {
  const totalRows = grid.length;
  const totalCols = totalRows ? grid[0].length : 0;
  const [zoom, setZoom] = useState(24); // 每格边长 px（初始值小，挂载时 fit 到完整显示）
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);

  // 按住拖拽平移（取代滚轮触发原生滚动）
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  // 最近一次鼠标在容器内的位置（用于以鼠标为中心缩放）
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const onMouseDown = (e: React.MouseEvent) => {
    // 编辑中的 input 不触发拖拽
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    // 记录鼠标在容器内的坐标（用于缩放锚点）
    const el = scrollRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left + el.scrollLeft, y: e.clientY - rect.top + el.scrollTop };
    }
    const d = dragRef.current;
    if (!d || !el) return;
    el.scrollLeft = d.sl - (e.clientX - d.x);
    el.scrollTop = d.st - (e.clientY - d.y);
  };
  const onMouseUp = () => { dragRef.current = null; };

  // 缩放：以鼠标位置为中心（鼠标下的格子点不动），并按比例缩放更平滑。
  // 最小缩放钳制为"完整显示"（容器能装下整个网格），最大 128px/格。
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const el = scrollRef.current;
    if (!el) return;
    // 鼠标在内容坐标系（含滚动偏移）中的位置 → 作为缩放锚点
    const rect = el.getBoundingClientRect();
    const ax = mouseRef.current.x || (e.clientX - rect.left + el.scrollLeft);
    const ay = mouseRef.current.y || (e.clientY - rect.top + el.scrollTop);
    // 最小每格像素：让整张网格刚好放进容器（宽度/高度都装下），再留点边距
    const minByW = (el.clientWidth - 4) / totalCols;
    const minByH = (el.clientHeight - 4) / totalRows;
    const minZoom = Math.max(6, Math.min(minByW, minByH));
    setZoom((prevZ) => {
      // 按比例缩放更平滑：每次 ×(1±0.12)，下限保护
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextZ = Math.max(minZoom, Math.min(128, prevZ * factor));
      if (nextZ === prevZ) return prevZ;
      // 以鼠标锚点为中心：缩放后让 (ax,ay) 仍位于鼠标处
      const ratio = nextZ / prevZ;
      // 新的滚动位置 = 锚点在内容中的位置 × ratio - 鼠标在视口中的位置
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // 用 rAF 延迟设置滚动，等 DOM 按新 zoom 重排后
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        scrollRef.current.scrollLeft = ax * ratio - mx;
        scrollRef.current.scrollTop = ay * ratio - my;
      });
      return nextZ;
    });
  };

  // 组件挂载/网格尺寸变化时，默认 fit 到完整显示
  const didInitFit = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !totalCols || !totalRows) return;
    const minByW = (el.clientWidth - 4) / totalCols;
    const minByH = (el.clientHeight - 4) / totalRows;
    const fit = Math.max(6, Math.min(minByW, minByH));
    // 仅首次 fit 到完整显示；之后保证不小于最小可完整显示值（窗口缩放时）
    if (!didInitFit.current) {
      setZoom(fit);
      didInitFit.current = true;
    } else {
      setZoom((z) => (z < fit ? fit : z));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalCols, totalRows]);

  if (!totalRows || !totalCols) return null;

  return (
    <div
      ref={scrollRef}
      className="overflow-auto border border-gray-200 rounded absolute inset-0 select-none"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{
        background: '#1f2937',
        cursor: dragRef.current ? 'grabbing' : 'grab',
      }}
    >
      <div
        className="relative"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${totalCols}, ${zoom}px)`,
          gridTemplateRows: `repeat(${totalRows}, ${zoom}px)`,
          width: totalCols * zoom,
          height: totalRows * zoom,
          backgroundImage: warpedBg ? `url(${warpedBg})` : undefined,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          backgroundColor: '#9ca3af',
        }}
      >
        {/* 格子（背景全部透明，露出底层图纸） */}
        {grid.map((rowArr, r) =>
          rowArr.map((code, c) => {
            const isSel = selected && selected.r === r && selected.c === c;
            const isEditing = editingCell && editingCell.r === r && editingCell.c === c;
            const empty = !code;
            const isMulti = multiSelect && multiSelect.has(`${r},${c}`);
            // 高亮空白格：受开关控制；隐藏代码层时不高亮（否则盖住底层看不清）
            const showEmptyHighlight = highlightEmpty && empty && !hideCodeLayer;
            // 物料统计表点击行 → 高亮该代码所有格子（高饱和度黄色边缘发光）
            const isCodeHL = !!highlightCode && code === highlightCode;
            // 纯色图纸层：开关打开且该格有代码且代码有对应颜色时，用产品色填充
            const fillColor = showColorLayer && code && colorMap && colorMap[code] ? colorMap[code] : '';
            return (
              <div
                key={`${r}-${c}`}
                onClick={(e) => {
                  // Ctrl/⌘+点击 或 Shift+点击：多选切换（优先级最高，不进编辑）
                  if (e.ctrlKey || e.metaKey || e.shiftKey) {
                    if (onToggleMulti) onToggleMulti(r, c);
                    return;
                  }
                  setSelected({ r, c });
                  onCellClick(r, c);
                }}
                onDoubleClick={() => { setSelected({ r, c }); onCellDoubleClick(r, c); }}
                className={`relative flex items-center justify-center font-mono cursor-pointer text-center ${
                  isSel ? 'ring-2 ring-blue-500 z-10' : ''
                }`}
                style={{
                  width: zoom,
                  height: zoom,
                  border: '1px solid rgba(0,0,0,0.22)',
                  fontSize: Math.max(8, Math.round(zoom * 0.3)),
                  color: '#111827',
                  // 纯色图纸层（在底图之上）：覆盖一层产品色
                  background: fillColor || 'transparent',
                  // 高亮优先级：青色(多选) > 黄色(物料代码高亮) > 红色(空白格)
                  boxShadow: isMulti
                    ? 'inset 0 0 0 2px #06b6d4, 0 0 8px 2px rgba(6,182,212,0.95)'
                    : isCodeHL
                    ? 'inset 0 0 0 2px #ffd400, 0 0 8px 2px rgba(255,212,0,0.95)'
                    : showEmptyHighlight
                    ? 'inset 0 0 0 2px #ff0033, 0 0 6px 1px rgba(255,0,51,0.85)'
                    : undefined,
                }}
                title={code || '未识别（双击编辑）'}
              >
                {isEditing ? (
                  <CellEditor
                    initial={code}
                    onCommit={(v) => onCommit(r, c, v)}
                    onCancel={onCancelEdit}
                  />
                ) : (
                  // 隐藏物料代码层：不显示代码文本，只露底层图纸方便对照
                  !hideCodeLayer && (
                    <span className="px-0.5 pointer-events-none" style={{ textShadow: '0 0 3px rgba(255,255,255,0.95), 0 0 5px rgba(255,255,255,0.7)' }}>
                      {code || ''}
                    </span>
                  )
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

/**
 * 单元格预览弹窗：查看识别为某个物料代码的所有格子（从拉正画布分割出来）。
 * 顶部展示一个同尺寸方格（物料代码 + 对应产品色背景），下方网格列出所有识别为该 code 的格子图。
 */
const CellPreviewModal: React.FC<{
  code: string;
  codeGrid: string[][];
  warpedCanvas: HTMLCanvasElement | null;
  /** 物料对应的产品色（用于顶部方格背景） */
  color?: string;
  /** 拉正画布每格像素（与生成背景时一致） */
  cellPx: number;
  /** 产品库（批量修改时的代码搜索） */
  products: DrawingGridOcrProduct[];
  onClose: () => void;
  /** 批量修改：把选中的格子统一改成 newCode */
  onBatchFix: (cells: Array<{ r: number; c: number }>, newCode: string) => void;
}> = ({ code, codeGrid, warpedCanvas, color, cellPx, products, onClose, onBatchFix }) => {
  const [cellImgs, setCellImgs] = useState<Array<{ r: number; c: number; url: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // key "r,c"
  const [targetCode, setTargetCode] = useState('');
  const [openSuggest, setOpenSuggest] = useState(false);

  // 从拉正画布提取所有识别为该 code 的格子为 dataURL
  useEffect(() => {
    if (!warpedCanvas) { setCellImgs([]); return; }
    const out: Array<{ r: number; c: number; url: string }> = [];
    for (let r = 0; r < codeGrid.length; r++) {
      for (let c = 0; c < codeGrid[r].length; c++) {
        if (codeGrid[r][c] === code) {
          try {
            const cv = document.createElement('canvas');
            cv.width = cellPx;
            cv.height = cellPx;
            const cx = cv.getContext('2d');
            if (cx) {
              cx.imageSmoothingEnabled = true;
              cx.imageSmoothingQuality = 'high';
              cx.drawImage(warpedCanvas, c * cellPx, r * cellPx, cellPx, cellPx, 0, 0, cellPx, cellPx);
              out.push({ r, c, url: cv.toDataURL('image/png') });
            }
          } catch (e) {
            // 单格提取失败跳过
          }
        }
      }
    }
    setCellImgs(out);
    setSelected(new Set()); // 切换 code 时清空选择
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleSel = (r: number, c: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = `${r},${c}`;
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const selAll = () => setSelected(new Set(cellImgs.map((c) => `${c.r},${c.c}`)));
  const selNone = () => setSelected(new Set());

  const selList = cellImgs.filter((c) => selected.has(`${c.r},${c.c}`));
  const trimmed = targetCode.trim();
  const norm = trimmed ? normalizeCodeLenient(targetCode) : '';
  // 合法性：空值（清空为空白）合法；非空时需匹配 CODE_REGEX
  const valid = !trimmed || CODE_REGEX.test(norm);
  const isClear = !trimmed;
  const term = trimmed.toUpperCase();
  const filtered = term
    ? products.filter((p) => p.code.toUpperCase().includes(term)).slice(0, 50)
    : products.slice(0, 50);

  const applyBatch = () => {
    if (!valid || selList.length === 0) return;
    onBatchFix(selList.map((c) => ({ r: c.r, c: c.c })), isClear ? '' : norm);
    onClose();
  };

  // 顶部方格尺寸与下方格子预览一致
  const tile = 96;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-[90vw] max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-base font-medium">物料 {code} 的识别格子（共 {cellImgs.length} 格）</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-sm">关闭</button>
        </div>
        <div className="p-5 overflow-y-auto">
          {/* 顶部：同尺寸方格，背景为产品色，显示物料代码 */}
          <div className="flex items-center gap-4 mb-4">
            <div
              className="flex items-center justify-center font-mono font-bold border border-gray-300 rounded"
              style={{
                width: tile,
                height: tile,
                fontSize: Math.max(14, tile * 0.32),
                backgroundColor: color || '#e5e7eb',
                color: color ? getReadableTextColor(color) : '#111827',
              }}
            >
              {code}
            </div>
            <div className="text-sm text-gray-500">
              <div>物料代码：<span className="font-mono font-medium text-gray-800">{code}</span></div>
              <div>识别为该物料的格子：{cellImgs.length} 格</div>
              {color && <div>产品色：<span className="font-mono">{color}</span></div>}
              <div className="mt-1">点击格子勾选，勾选后可批量改为正确代码</div>
            </div>
          </div>

          {/* 批量修改工具栏（选中后出现） */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded flex-wrap">
              <span className="text-sm text-blue-700">已选 {selected.size} 格</span>
              <button onClick={selAll} className="text-xs text-blue-600 hover:underline">全选</button>
              <button onClick={selNone} className="text-xs text-gray-500 hover:underline">取消选择</button>
              <div className="flex-1" />
              <div className="relative">
                <input
                  type="text"
                  value={targetCode}
                  onChange={(e) => { setTargetCode(e.target.value); setOpenSuggest(true); }}
                  onFocus={() => setOpenSuggest(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && valid) { e.preventDefault(); applyBatch(); }
                  }}
                  className="border rounded px-2 py-1 text-sm font-mono w-32"
                  placeholder="改为…（留空=清除）"
                />
                {openSuggest && (
                  <div className="absolute z-10 right-0 mt-1 bg-white border rounded max-h-44 overflow-auto shadow w-44">
                    {filtered.length === 0 ? (
                      <div className="p-2 text-xs text-gray-400">无匹配</div>
                    ) : filtered.map((p) => (
                      <div
                        key={p.id}
                        onMouseDown={() => { setTargetCode(p.code); setOpenSuggest(false); }}
                        className="p-1.5 hover:bg-gray-50 cursor-pointer flex items-center gap-2 text-xs"
                      >
                        <span className="inline-block w-3 h-3 rounded border border-gray-300" style={{ backgroundColor: p.color_hex || '#ccc' }} />
                        <span className="font-mono">{p.code}</span>
                        {p.category_name && <span className="text-gray-400">{p.category_name}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span className={`text-xs font-mono ${isClear ? 'text-amber-600' : (valid ? 'text-green-600' : 'text-gray-400')}`}>
                {isClear ? '→ 空白' : (valid ? `→ ${norm}` : '')}
              </span>
              <button
                onClick={() => { setTargetCode(''); setOpenSuggest(false); }}
                className="px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-700 border border-amber-300 rounded text-sm"
                title="清空输入框，应用后将把选中格子改为空白"
              >
                清空
              </button>
              <button
                onClick={applyBatch}
                disabled={!valid || selList.length === 0}
                className={`px-3 py-1 text-white rounded text-sm disabled:bg-gray-300 disabled:cursor-not-allowed ${isClear ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {isClear ? `清除 ${selList.length}` : '应用'}
              </button>
            </div>
          )}

          {/* 下方：所有识别为该 code 的格子图网格（点击勾选） */}
          {cellImgs.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              {warpedCanvas ? '没有找到识别为该物料的格子' : '图纸数据不可用，请返回重新识别'}
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tile}px, 1fr))` }}>
              {cellImgs.map((cell, idx) => {
                const key = `${cell.r},${cell.c}`;
                const isSel = selected.has(key);
                return (
                  <div
                    key={idx}
                    className={`relative cursor-pointer rounded overflow-hidden border-2 transition-all ${
                      isSel ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-300 hover:border-blue-300'
                    }`}
                    onClick={() => toggleSel(cell.r, cell.c)}
                  >
                    <img
                      src={cell.url}
                      alt={`r${cell.r}c${cell.c}`}
                      className="w-full block"
                      style={{ aspectRatio: '1', objectFit: 'fill' }}
                      draggable={false}
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5 font-mono">
                      {cell.r + 1},{cell.c + 1}
                    </div>
                    {/* 勾选标记 */}
                    {isSel && (
                      <div className="absolute top-1 right-1 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">✓</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** 根据背景色返回可读的文字色（黑或白） */
function getReadableTextColor(hex: string): string {
  const m = hex.replace('#', '');
  if (m.length < 6) return '#111827';
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  // 相对亮度（简化）
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#111827' : '#ffffff';
}

/** 单格行内编辑器：回车/失焦提交，Esc 取消 */
const CellEditor: React.FC<{
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}> = ({ initial, onCommit, onCancel }) => {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  // 标记已通过 Enter/ESC 显式结束编辑，避免卸载触发的 onBlur 再次提交/取消
  const committedRef = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          committedRef.current = true;
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          committedRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        // ESC/Enter 已显式处理，跳过 blur 提交
        if (committedRef.current) return;
        onCommit(value);
      }}
      className="w-full h-full text-center font-mono border-0 p-0 bg-white"
      style={{ fontSize: 'inherit', outline: '2px solid #3B82F6' }}
      placeholder="清空=删除"
    />
  );
};

/**
 * 批量修改代码弹窗：把多个选中格子统一改成某个物料代码。
 * 带产品库搜索下拉 + 规范化预览（输入 E5 → 显示 E05）。
 */
const BatchEditModal: React.FC<{
  count: number;
  products: DrawingGridOcrProduct[];
  onApply: (value: string) => void;
  onClose: () => void;
}> = ({ count, products, onApply, onClose }) => {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const term = value.trim().toUpperCase();
  const filtered = term
    ? products.filter((p) => p.code.toUpperCase().includes(term)).slice(0, 50)
    : products.slice(0, 50);
  const trimmed = value.trim();
  const normalized = trimmed ? normalizeCodeLenient(value) : '';
  // 合法性：空值（清空为空白）合法；非空时需匹配 CODE_REGEX
  const valid = !trimmed || CODE_REGEX.test(normalized);
  const isClear = !trimmed;

  // 统一的提交函数：空值 → ''；非空 → 规范化结果
  const apply = () => {
    if (!valid) return;
    onApply(isClear ? '' : normalized);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium mb-1">批量修改物料代码</h3>
        <p className="text-sm text-gray-500 mb-4">
          将选中的 <span className="font-medium text-blue-600">{count}</span> 个格子全部改为以下代码：
        </p>
        <div className="relative">
          <label className="block text-xs font-medium text-gray-600 mb-1">物料代码（留空表示清除为空白）</label>
          <input
            type="text"
            value={value}
            autoFocus
            onChange={(e) => { setValue(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) { e.preventDefault(); apply(); }
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
            className="w-full border rounded px-3 py-2 text-sm font-mono"
            placeholder="如 E05（留空 = 清除）"
          />
          {open && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded max-h-48 overflow-auto shadow">
              {filtered.length === 0 ? (
                <div className="p-2 text-sm text-gray-400">无匹配项</div>
              ) : (
                filtered.map((p) => (
                  <div
                    key={p.id}
                    onMouseDown={() => { setValue(p.code); setOpen(false); }}
                    className="p-2 hover:bg-gray-50 cursor-pointer flex items-center gap-2 text-sm"
                  >
                    <span className="inline-block w-3 h-3 rounded border border-gray-300" style={{ backgroundColor: p.color_hex || '#ccc' }} />
                    <span className="font-mono">{p.code}</span>
                    {p.category_name && <span className="text-xs text-gray-400">{p.category_name}</span>}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {isClear ? (
            <span className="text-amber-600 font-medium">将清除为空白（不计入 BOM 统计）</span>
          ) : (
            <>规范化结果：<span className={`font-mono ${valid ? 'text-green-600' : 'text-gray-400'}`}>{valid ? normalized : '（无效，需 单字母+数字）'}</span></>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-sm">
            取消
          </button>
          <button
            onClick={() => { setValue(''); setOpen(false); }}
            className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-700 border border-amber-300 rounded text-sm"
            title="清空输入框，应用后将把选中格子改为空白"
          >
            清空为空白
          </button>
          <button
            onClick={apply}
            disabled={!valid}
            className={`px-4 py-2 text-white rounded text-sm disabled:bg-gray-300 disabled:cursor-not-allowed ${isClear ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {isClear ? `清除 ${count} 格` : `应用到 ${count} 格`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DrawingGridOcrModal;
