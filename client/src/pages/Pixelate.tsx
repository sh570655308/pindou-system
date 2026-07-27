import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import api from '../utils/api';
import PixelGrid, { PixelCell, SelectionTool, SelectionState } from '../components/PixelGrid';
import StatsPanel from '../components/StatsPanel';
import PixelToolbar from '../components/PixelToolbar';
import LayerPanel, { Layer } from '../components/LayerPanel';
import MaterialPickerModal from '../components/MaterialPickerModal';
import MappingEditorModal, { MappingChange } from '../components/MappingEditorModal';
import { useLocalStorageState } from '../utils/useLocalStorageState';
import { useBrushPresets } from '../hooks/useBrushPresets';
import { debounce } from '../utils/debounce';

interface DrawingItem {
  id: number;
  title: string;
  thumbnail?: string;
}

const PixelatePage: React.FC = () => {
  // 非持久化状态（临时状态）
  const [loading, setLoading] = useState(false);
  const panelDrag = React.useRef<{ startX: number; startY: number; dragging: boolean; moved?: boolean } | null>(null);

  // 持久化状态（页面刷新后保留）
  // Layer System
  const [layers, setLayers] = useLocalStorageState<Layer[]>('pixelate-layers', []);
  const [activeLayerId, setActiveLayerId] = useLocalStorageState<string>('pixelate-activeLayerId', 'layer-1');
  const [layerPanelPos, setLayerPanelPos] = useLocalStorageState<{ x: number; y: number }>('pixelate-layerPanelPos', { x: window.innerWidth - 280, y: 100 });
  const [layerPanelVisible, setLayerPanelVisible] = useLocalStorageState<boolean>('pixelate-layerPanelVisible', true);

  // Migration for legacy pixels
  useEffect(() => {
    const legacyPixels = localStorage.getItem('pixelate-pixels');
    if (layers.length === 0 && legacyPixels) {
      try {
        const parsed = JSON.parse(legacyPixels);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLayers([{ id: 'layer-1', name: '图层 1', visible: true, locked: false, pixels: parsed }]);
          setActiveLayerId('layer-1');
          // clear legacy to avoid double migration
          localStorage.removeItem('pixelate-pixels');
        }
      } catch (e) { }
    } else if (layers.length === 0) {
      // Init default 104x104 grid
      const defaultPixels = Array.from({ length: 104 }, () =>
        Array.from({ length: 104 }, () => ({ hex: null, productId: null }))
      );
      setLayers([{ id: 'layer-1', name: '图层 1', visible: true, locked: false, pixels: defaultPixels }]);
      setActiveLayerId('layer-1');
    }
  }, []);

  // Ensure active layer exists
  useEffect(() => {
    if (layers.length > 0 && !layers.find(l => l.id === activeLayerId)) {
      setActiveLayerId(layers[layers.length - 1].id);
    }
  }, [layers, activeLayerId]);

  // Derived pixels for active layer specifically
  const activeLayerPixels = React.useMemo(() => {
    const active = layers.find(l => l.id === activeLayerId);
    return active ? active.pixels : [];
  }, [layers, activeLayerId]);

  // Derived pixels for rendering (Composition)
  const pixels = React.useMemo(() => {
    if (layers.length === 0) return [];
    // Find dimensions from first layer
    const base = layers[0].pixels;
    const rows = base.length;
    const cols = base[0]?.length || 0;
    if (rows === 0) return [];

    const result: PixelCell[][] = [];
    for (let r = 0; r < rows; r++) {
      const rowArr: PixelCell[] = [];
      for (let c = 0; c < cols; c++) rowArr.push({ hex: null, productId: null });
      result.push(rowArr);
    }

    layers.forEach(layer => {
      if (!layer.visible) return;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const p = layer.pixels[r]?.[c];
          if (p && (p.hex || p.productId !== null && p.productId !== undefined)) {
            result[r][c] = { ...p };
          }
        }
      }
    });
    return result;
  }, [layers]);

  // Compatibility setPixels (Update Active Layer)
  // Handles dimension sync across all layers if newPixels has different size
  // shiftR/shiftC are used when the expansion happened at top/left, moving the (0,0) origin
  const setPixels = (newPixels: PixelCell[][], shiftR = 0, shiftC = 0) => {
    setLayers(prev => {
      if (newPixels.length === 0) {
        return prev.map(l => l.id === activeLayerId ? { ...l, pixels: [] } : l);
      }

      const newRows = newPixels.length;
      const newCols = newPixels[0]?.length || 0;

      return prev.map(l => {
        if (l.id === activeLayerId) {
          return { ...l, pixels: newPixels };
        }

        // Always sync dimensions for non-active layers
        const syncedPixels: PixelCell[][] = [];
        for (let r = 0; r < newRows; r++) {
          const rowArr: PixelCell[] = [];
          for (let c = 0; c < newCols; c++) {
            const oldR = r - shiftR;
            const oldC = c - shiftC;
            rowArr.push(l.pixels[oldR]?.[oldC] || { hex: null, productId: null });
          }
          syncedPixels.push(rowArr);
        }
        return { ...l, pixels: syncedPixels };
      });
    });
  };
  const [stats, setStats] = useLocalStorageState<any[]>('pixelate-stats', []);
  const [highlightedProductId, setHighlightedProductId] = useLocalStorageState<number | null>('pixelate-highlightedProductId', null);
  const [statsVisible, setStatsVisible] = useLocalStorageState<boolean>('pixelate-statsVisible', true);
  const [mappingEditorVisible, setMappingEditorVisible] = useState(false);
  const [maxPixels, setMaxPixels] = useLocalStorageState<number>('pixelate-maxPixels', 52);
  const [colorCount, setColorCount] = useLocalStorageState<number>('pixelate-colorCount', 16);
  const [previewUrl, setPreviewUrl] = useLocalStorageState<string | null>('pixelate-previewUrl', null);
  const [showOriginalPreview, setShowOriginalPreview] = useLocalStorageState<boolean>('pixelate-showOriginalPreview', true);
  const [removeBg, setRemoveBg] = useLocalStorageState<boolean>('pixelate-removeBg', false);
  const [panelPos, setPanelPos] = useLocalStorageState<{ x: number; y: number }>('pixelate-panelPos', { x: 20, y: 80 });
  const [panelCollapsed, setPanelCollapsed] = useLocalStorageState<boolean>('pixelate-panelCollapsed', false);
  const [previewPos, setPreviewPos] = useLocalStorageState<{ left: number; top: number }>('pixelate-previewPos', { left: 24, top: Math.max(40, typeof window !== 'undefined' ? window.innerHeight - 200 : 200) });
  const [pastePreviewPos, setPastePreviewPos] = useLocalStorageState<{ left: number; top: number }>('pixelate-pastePreviewPos', { left: 24, top: 24 });
  const [showMaterialCodes, setShowMaterialCodes] = useLocalStorageState<boolean>('pixelate-showMaterialCodes', false);
  const [darkBackground, setDarkBackground] = useLocalStorageState<boolean>('pixelate-darkBackground', false);
  // gridOffset: 虚拟坐标偏移量，pixels[0][0] 对应的虚拟坐标是 (gridOffset.row, gridOffset.col)
  const [gridOffset, setGridOffset] = useLocalStorageState<{ row: number; col: number }>('pixelate-gridOffset', { row: 0, col: 0 });
  const previewDrag = React.useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);

  // 持久化文件信息（用于刷新功能）
  const [lastFileInfo, setLastFileInfo] = useLocalStorageState<{
    name: string;
    size: number;
    type: string;
    lastModified: number;
    url: string;
  } | null>('pixelate-lastFileInfo', null);

  // 上次像素化时的参数（用于检测参数变化）
  const [lastPixelateParams, setLastPixelateParams] = useLocalStorageState<{
    maxPixels: number;
    colorCount: number;
  } | null>('pixelate-lastParams', null);

  // 用户修改记录（删除mask和改色overlay）
  const [deletionMask, setDeletionMask] = useLocalStorageState<Map<string, boolean>>(
    'pixelate-deletionMask',
    new Map(),
    {
      serialize: (map) => JSON.stringify(Array.from(map.entries())),
      deserialize: (str) => new Map(JSON.parse(str))
    }
  );
  const [colorOverrides, setColorOverrides] = useLocalStorageState<Map<string, { hex: string; productId?: number | null }>>(
    'pixelate-colorOverrides',
    new Map(),
    {
      serialize: (map) => JSON.stringify(Array.from(map.entries())),
      deserialize: (str) => new Map(JSON.parse(str))
    }
  );

  // 新增的工具和选择相关状态
  const [currentTool, setCurrentTool] = useLocalStorageState<SelectionTool>('pixelate-currentTool', 'hand');
  const [selectionState, setSelectionState] = useState<SelectionState>({ selectedCells: new Set(), isSelecting: false });
  const [toolbarPos, setToolbarPos] = useLocalStorageState<{ x: number; y: number }>('pixelate-toolbarPos', { x: window.innerWidth / 2 - 200, y: window.innerHeight - 120 });
  const [toolbarCollapsed, setToolbarCollapsed] = useLocalStorageState<boolean>('pixelate-toolbarCollapsed', false);
  const [availableMaterials, setAvailableMaterials] = useState<any[]>([]);

  // 剪贴板状态 - 用于复制粘贴功能
  interface ClipboardData {
    pixels: Map<string, { hex: string | null; productId: number | null }>; // 使用 "row,col" 作为key
    width: number; // 宽度（列数）
    height: number; // 高度（行数）
    minRow: number; // 原始左上角行
    minCol: number; // 原始左上角列
  }
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);

  // History System
  interface HistoryState {
    layers: Layer[];
    activeLayerId: string;
    deletionMask: Array<[string, boolean]>;
    colorOverrides: Array<[string, { hex: string; productId?: number | null }]>;
  }

  const [undoStack, setUndoStack] = useState<HistoryState[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryState[]>([]);

  const saveToHistory = () => {
    const s: HistoryState = {
      layers: JSON.parse(JSON.stringify(layers)),
      activeLayerId,
      deletionMask: Array.from(deletionMask.entries()),
      colorOverrides: Array.from(colorOverrides.entries())
    };
    setUndoStack(prev => {
      const next = [...prev, s];
      if (next.length > 100) next.shift();
      return next;
    });
    setRedoStack([]);
  };

  const performUndo = () => {
    if (undoStack.length === 0) return;
    const currentS: HistoryState = {
      layers: JSON.parse(JSON.stringify(layers)),
      activeLayerId,
      deletionMask: Array.from(deletionMask.entries()),
      colorOverrides: Array.from(colorOverrides.entries())
    };
    const prevS = undoStack[undoStack.length - 1];
    const newUndo = undoStack.slice(0, -1);

    setRedoStack(prev => [...prev, currentS]);
    setUndoStack(newUndo);

    restoreState(prevS);
  };

  const performRedo = () => {
    if (redoStack.length === 0) return;
    const currentS: HistoryState = {
      layers: JSON.parse(JSON.stringify(layers)),
      activeLayerId,
      deletionMask: Array.from(deletionMask.entries()),
      colorOverrides: Array.from(colorOverrides.entries())
    };
    const nextS = redoStack[redoStack.length - 1];
    const newRedo = redoStack.slice(0, -1);

    setUndoStack(prev => [...prev, currentS]);
    setRedoStack(newRedo);

    restoreState(nextS);
  };

  const restoreState = (s: HistoryState) => {
    setLayers(s.layers);
    setActiveLayerId(s.activeLayerId);
    setDeletionMask(new Map(s.deletionMask));
    setColorOverrides(new Map(s.colorOverrides));
  };

  // Effect to update stats when layers change (since history restores layers)
  // 依赖含 availableMaterials：物料列表异步加载完成后也需重算，否则 code 会 fallback 成纯数字
  useEffect(() => {
    if (pixels.length > 0 && statsVisible) {
      try {
        const recomputed = computeStatsFromPixels(pixels);
        setStats(recomputed);
      } catch (e) { }
    }
  }, [pixels, availableMaterials]);

  const [showSaveDialog, setShowSaveDialog] = useState<boolean>(false);
  const [saveDrawingName, setSaveDrawingName] = useState<string>('');
  const [savingDrawing, setSavingDrawing] = useState<boolean>(false);
  // export options for generated sample image
  // - exportMinCellSize: minimum pixel size (in output pixels) for each logical grid cell.
  //   Increase this for crisper, larger exported images (cost: larger file & wider dimensions).
  // - maxWidth (used inside generator): caps overall exported image width to avoid extremely large files.
  const [exportFormat, setExportFormat] = useLocalStorageState<'png' | 'jpeg'>('pixelate-exportFormat', 'jpeg');
  const [exportQuality, setExportQuality] = useLocalStorageState<number>('pixelate-exportQuality', 0.85);
  const [exportMinCellSize, setExportMinCellSize] = useLocalStorageState<number>('pixelate-exportMinCellSize', 36); // recommended default: 24 (increased from 24 to 36 for 1.5x resolution)
  // 背板尺寸（拼豆底板）：0 表示使用“自适应裁剪”（保留旧行为）；> 0 表示把图按 boardSize×boardSize 居中放置
  const [boardSize, setBoardSize] = useLocalStorageState<number>('pixelate-boardSize', 0);
  // 自适应模式下的边距模式：'margin' = 内容四周留 1 格空白边（默认）；'none' = 内容贴边无留白
  // 仅自适应模式生效；背板模式下内容由背板尺寸 + 居中决定，与此选项无关
  const [marginMode, setMarginMode] = useLocalStorageState<'margin' | 'none'>('pixelate-marginMode', 'margin');
  // 每格细线开关：开启时每个格子都有淡而细的边线，方便数格子
  const [cellGridLines, setCellGridLines] = useLocalStorageState<boolean>('pixelate-cellGridLines', true);
  // 背板标尺线开关：开启时绘制每 10 格粗实线 + 每 5 格粗虚线
  const [boardRulerEnabled, setBoardRulerEnabled] = useLocalStorageState<boolean>('pixelate-boardRulerEnabled', true);
  // 空白格棋盘格开关：开启后没有物料的格子用 PS 透明棋盘格样式（灰白交替）表示
  const [transparentEmpty, setTransparentEmpty] = useLocalStorageState<boolean>('pixelate-transparentEmpty', false);
  // 水平镜像开关：导出/保存到档案时左右翻转像素内容（坐标标尺、网格框架不翻转）
  const [mirrorExport, setMirrorExport] = useLocalStorageState<boolean>('pixelate-mirrorExport', false);
  // 仅导出到本地时：是否同步下载 .pindou 项目文件
  const [syncPindouOnExport, setSyncPindouOnExport] = useState<boolean>(false);

  // 计算当前像素内容“自动裁剪 + 1 格边距”后的尺寸，用于保存对话框校验背板能否放下
  // 与 generateSampleImageBlob 内部的裁剪逻辑保持一致
  const { contentRows: contentRowsForSave, contentCols: contentColsForSave } = useMemo(() => {
    if (!pixels || pixels.length === 0) return { contentRows: 0, contentCols: 0 };
    const totalRows = pixels.length;
    const totalCols = pixels[0]?.length || 0;
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < totalCols; c++) {
        if (pixels[r]?.[c]?.hex) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    if (maxR < 0) return { contentRows: 0, contentCols: 0 };
    const cropMinR = Math.max(0, minR - 1);
    const cropMaxR = Math.min(totalRows - 1, maxR + 1);
    const cropMinC = Math.max(0, minC - 1);
    const cropMaxC = Math.min(totalCols - 1, maxC + 1);
    return {
      contentRows: cropMaxR - cropMinR + 1,
      contentCols: cropMaxC - cropMinC + 1,
    };
  }, [pixels]);
  // 背板尺寸不足，无法放下当前内容时禁止保存
  const boardSizeInvalid = boardSize > 0 && (boardSize < contentColsForSave || boardSize < contentRowsForSave);

  // clear highlighted product when tool is switched away from 'hand'
  useEffect(() => {
    if (currentTool !== 'hand') {
      setHighlightedProductId(null);
    }
  }, [currentTool, setHighlightedProductId]);

  // 使用 position: fixed 锁定 body（进入像素化页面时），保存并恢复滚动位置以避免刷新跳到底部
  useEffect(() => {
    try {
      const body = document.body;
      const prevPosition = body.style.position;
      const prevTop = body.style.top;
      const prevLeft = body.style.left;
      const prevWidth = body.style.width;
      const prevOverflow = body.style.overflow;
      const prevPaddingRight = body.style.paddingRight;
      // 如果是从图纸页面跳转过来并希望滚动到顶部，优先使用该标志
      const forceTop = sessionStorage.getItem('pixelate-scroll-to-top') === '1';
      const scrollY = forceTop ? 0 : (window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0);
      if (forceTop) sessionStorage.removeItem('pixelate-scroll-to-top');

      // 防止布局抖动：在锁定时保留滚动条宽度
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        body.style.paddingRight = `${scrollbarWidth}px`;
      }

      // 锁定页面位置
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';

      // 如果强制到顶部，确保视觉上滚动到顶部（补偿 fixed top）
      if (forceTop) {
        try { window.scrollTo(0, 0); } catch (e) { }
      }

      const onTouchMove = (e: TouchEvent) => { e.preventDefault(); };
      document.addEventListener('touchmove', onTouchMove, { passive: false });

      return () => {
        document.removeEventListener('touchmove', onTouchMove as any);
        // 恢复 body 样式并回到之前位置
        body.style.position = prevPosition || '';
        body.style.top = prevTop || '';
        body.style.left = prevLeft || '';
        body.style.width = prevWidth || '';
        body.style.overflow = prevOverflow || '';
        body.style.paddingRight = prevPaddingRight || '';
        try { window.scrollTo(0, scrollY); } catch (err) { }
      };
    } catch (err) {
      // 在非浏览器环境或出错时忽略
    }
  }, []);

  // 检查是否有自动上传的文件（从图纸页面跳转过来）
  useEffect(() => {
    const autoUploadData = sessionStorage.getItem('pixelate-auto-upload');
    if (autoUploadData) {
      try {
        const { imageUrl, fileName } = JSON.parse(autoUploadData);

        // 清除sessionStorage
        sessionStorage.removeItem('pixelate-auto-upload');

        // 滚动到页面顶部
        window.scrollTo(0, 0);

        // 下载图片并自动上传
        const autoUploadImage = async () => {
          try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const file = new File([blob], fileName, { type: blob.type });

            // 对于从图纸页面跳转过来的情况，设置previewUrl为原始URL而不是blob URL
            setPreviewUrl(imageUrl);

            // 自动上传图片
            await handleUpload(file, imageUrl);
          } catch (err) {
            console.error('自动上传图片失败', err);
            alert('自动上传图片失败');
          }
        };

        autoUploadImage();
      } catch (err) {
        console.error('解析自动上传数据失败', err);
        sessionStorage.removeItem('pixelate-auto-upload');
      }
    }
  }, []);

  // load materials for picker
  const loadAvailableMaterials = async () => {
    try {
      const res = await api.get('/inventory/products/all');
      setAvailableMaterials(res.data || []);
    } catch (err) {
      console.error('加载物料列表失败', err);
      setAvailableMaterials([]);
    }
  };

  useEffect(() => {
    loadAvailableMaterials();
  }, []);

  // 当窗口重新获得焦点时刷新物料数据（以便在其他页面更新颜色后能同步）
  useEffect(() => {
    const handleFocus = () => {
      loadAvailableMaterials();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const handleUpload = async (file?: File, customPreviewUrl?: string) => {
    if (!file) return;
    setLoading(true);
    try {
      // prepare file: if removeBg enabled, try client-side removal in worker first
      const prepareFile = async (srcFile: File) => {
        if (!removeBg) return srcFile;
        try {
          // create worker lazily
          if (!(window as any)._removeBgWorker) {
            // eslint-disable-next-line no-undef
            (window as any)._removeBgWorker = new Worker(new URL('../workers/removeBgWorker.js', import.meta.url), { type: 'module' });
            (window as any)._removeBgWorker._nextId = 1;
            (window as any)._removeBgWorker._promises = new Map();
            (window as any)._removeBgWorker.onmessage = (e: MessageEvent) => {
              const { id, success, blob, error } = e.data || {};
              const p = (window as any)._removeBgWorker._promises.get(id);
              if (p) {
                if (success) p.resolve(new File([blob], srcFile.name.replace(/\.[^/.]+$/, '') + '_bg.png', { type: 'image/png' }));
                else p.resolve(null);
                (window as any)._removeBgWorker._promises.delete(id);
              }
            };
          }
          const worker = (window as any)._removeBgWorker;
          const id = worker._nextId++;
          const promise = new Promise<File | null>((resolve) => {
            worker._promises.set(id, { resolve });
          });
          // post file directly (cloning)
          worker.postMessage({ id, file: srcFile, maxDim: 1024 });
          const result = await promise;
          return result || srcFile;
        } catch (err) {
          console.warn('client remove bg failed, upload original', err);
          return srcFile;
        }
      };
      const fileToUpload = await prepareFile(file);
      const fd = new FormData();
      fd.append('image', fileToUpload);
      fd.append('max_pixels', String(maxPixels));
      fd.append('color_count', String(colorCount));
      // if we already pre-processed (fileToUpload !== original), tell server not to run light removal
      fd.append('remove_bg', fileToUpload !== file ? '0' : (removeBg ? '1' : '0'));
      const res = await api.post('/pixelate', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const newPixels = res.data.pixels || [];
      setLayers([{ id: 'layer-1', name: '图层 1', visible: true, locked: false, pixels: newPixels }]);
      setActiveLayerId('layer-1');
      // setPixels(res.data.pixels || []); -> removed coverage
      setStats(res.data.stats || []);
      setHighlightedProductId(null);
      setStatsVisible(true);

      // 像素化成功后自动弹出映射编辑，让用户修正自动映射的结果
      if (newPixels.length > 0 && (res.data.stats || []).length > 0) {
        setMappingEditorVisible(true);
      }

      // 清除之前图片的修改记录（新图片上传时）
      setDeletionMask(new Map());
      setColorOverrides(new Map());

      // 保存文件信息到持久化状态
      const fileInfo = {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        url: customPreviewUrl || URL.createObjectURL(file)
      };
      setLastFileInfo(fileInfo);

      // 记录当前像素化参数
      setLastPixelateParams({ maxPixels, colorCount });

      // preview - 使用保存的URL
      setPreviewUrl(fileInfo.url);
    } catch (err) {
      console.error('pixelate failed', err);
      alert('获取像素化数据失败');
      setPixels([]);
      setStats([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!lastFileInfo) {
      alert('请先上传图片再刷新');
      return;
    }

    // 检查参数是否改变
    const currentParams = { maxPixels, colorCount };
    const paramsChanged = lastPixelateParams &&
      (lastPixelateParams.maxPixels !== currentParams.maxPixels ||
        lastPixelateParams.colorCount !== currentParams.colorCount);

    if (paramsChanged && (deletionMask.size > 0 || colorOverrides.size > 0)) {
      const keepModifications = window.confirm(
        `检测到像素化参数已改变（分辨率: ${lastPixelateParams.maxPixels} → ${currentParams.maxPixels}, 颜色数: ${lastPixelateParams.colorCount} → ${currentParams.colorCount}）。\n\n` +
        `您的删除和改色修改可能无法正确应用到新的像素网格中。\n\n` +
        `是否保留这些修改？\n` +
        `• 选择"确定": 保留修改（可能位置不准确）\n` +
        `• 选择"取消": 清除所有修改后刷新`
      );

      if (!keepModifications) {
        // 清除所有修改记录
        setDeletionMask(new Map());
        setColorOverrides(new Map());
      }
    }

    // 从持久化的文件信息恢复文件
    try {
      const response = await fetch(lastFileInfo.url);
      const blob = await response.blob();
      const file = new File([blob], lastFileInfo.name, {
        type: lastFileInfo.type,
        lastModified: lastFileInfo.lastModified
      });

      // 上传并应用修改
      await handleUploadWithModifications(file);

      // 更新参数记录
      setLastPixelateParams(currentParams);
    } catch (error) {
      console.error('恢复文件失败:', error);
      alert('恢复文件失败，请重新上传图片');
    }
  };

  // 上传并应用用户修改的函数
  const handleUploadWithModifications = async (file: File) => {
    setLoading(true);
    try {
      // prepare file: if removeBg enabled, try client-side removal in worker first
      const prepareFile = async (srcFile: File) => {
        if (!removeBg) return srcFile;
        try {
          // create worker lazily
          if (!(window as any)._removeBgWorker) {
            // eslint-disable-next-line no-undef
            (window as any)._removeBgWorker = new Worker(new URL('../workers/removeBgWorker.js', import.meta.url), { type: 'module' });
            (window as any)._removeBgWorker._nextId = 1;
            (window as any)._removeBgWorker._promises = new Map();
            (window as any)._removeBgWorker.onmessage = (e: MessageEvent) => {
              const { id, success, blob, error } = e.data || {};
              const p = (window as any)._removeBgWorker._promises.get(id);
              if (p) {
                if (success) p.resolve(new File([blob], srcFile.name.replace(/\.[^/.]+$/, '') + '_bg.png', { type: 'image/png' }));
                else p.resolve(null);
                (window as any)._removeBgWorker._promises.delete(id);
              }
            };
          }
          const worker = (window as any)._removeBgWorker;
          const id = worker._nextId++;
          const promise = new Promise<File | null>((resolve) => {
            worker._promises.set(id, { resolve });
          });
          // post file directly (cloning)
          worker.postMessage({ id, file: srcFile, maxDim: 1024 });
          const result = await promise;
          return result || srcFile;
        } catch (err) {
          console.warn('client remove bg failed, upload original', err);
          return srcFile;
        }
      };

      const fileToUpload = await prepareFile(file);
      const fd = new FormData();
      fd.append('image', fileToUpload);
      fd.append('max_pixels', String(maxPixels));
      fd.append('color_count', String(colorCount));
      // if we already pre-processed (fileToUpload !== original), tell server not to run light removal
      fd.append('remove_bg', fileToUpload !== file ? '0' : (removeBg ? '1' : '0'));
      const res = await api.post('/pixelate', fd, { headers: { 'Content-Type': 'multipart/form-data' } });

      let pixelsData = res.data.pixels || [];

      // 应用删除mask
      if (deletionMask.size > 0) {
        pixelsData = pixelsData.map((row: PixelCell[], rowIndex: number) =>
          row.map((cell: PixelCell, colIndex: number) => {
            const key = `${rowIndex},${colIndex}`;
            if (deletionMask.has(key)) {
              return { hex: null, productId: null };
            }
            return cell;
          })
        );
      }

      // 应用改色overlay
      if (colorOverrides.size > 0) {
        pixelsData = pixelsData.map((row: PixelCell[], rowIndex: number) =>
          row.map((cell: PixelCell, colIndex: number) => {
            const key = `${rowIndex},${colIndex}`;
            const override = colorOverrides.get(key);
            if (override) {
              return { hex: override.hex, productId: override.productId };
            }
            return cell;
          })
        );
      }

      setLayers([{ id: 'layer-1', name: '图层 1', visible: true, locked: false, pixels: pixelsData }]);
      setActiveLayerId('layer-1');
      // setPixels(pixelsData);

      // 重新计算统计信息
      const recomputedStats = computeStatsFromPixels(pixelsData);
      setStats(recomputedStats);

      setHighlightedProductId(null);
      setStatsVisible(true);

      // 更新预览URL
      setPreviewUrl(lastFileInfo?.url || null);

    } catch (err) {
      console.error('pixelate failed', err);
      alert('获取像素化数据失败');
      setPixels([]);
      setStats([]);
    } finally {
      setLoading(false);
    }
  };

  // draggable panel handlers
  const onPanelPointerDown = (e: React.PointerEvent) => {
    panelDrag.current = { startX: e.clientX, startY: e.clientY, dragging: true, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPanelPointerMove = (e: React.PointerEvent) => {
    if (!panelDrag.current || !panelDrag.current.dragging) return;
    const dx = e.clientX - panelDrag.current.startX;
    const dy = e.clientY - panelDrag.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) panelDrag.current.moved = true;
    setPanelPos((p) => ({ x: Math.max(0, p.x + dx), y: Math.max(0, p.y + dy) }));
    panelDrag.current.startX = e.clientX;
    panelDrag.current.startY = e.clientY;
  };
  const onPanelPointerUp = (e: React.PointerEvent) => {
    if (!panelDrag.current) return;
    panelDrag.current.dragging = false;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch (err) { }
    // persist panel position
    try { localStorage.setItem('pixelate_panel_pos', JSON.stringify(panelPos)); } catch (err) { }
  };
  // wrapper handlers for clicking/dragging the panel top/empty area
  const onPanelAreaPointerDown = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    // don't start dragging when interacting with controls
    if (el && el.closest && el.closest('input,button,label,select,textarea,svg')) return;
    onPanelPointerDown(e);
  };
  const onPanelAreaPointerMove = (e: React.PointerEvent) => {
    // only forward to drag handler if dragging started
    if (!panelDrag.current || !panelDrag.current.dragging) return;
    onPanelPointerMove(e);
  };
  const onPanelAreaPointerUp = (e: React.PointerEvent) => {
    onPanelPointerUp(e);
  };
  const onPreviewPointerDown = (e: React.PointerEvent) => {
    previewDrag.current = { dragging: true, startX: e.clientX, startY: e.clientY };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPreviewPointerMove = (e: React.PointerEvent) => {
    if (!previewDrag.current || !previewDrag.current.dragging) return;
    const dx = e.clientX - previewDrag.current.startX;
    const dy = e.clientY - previewDrag.current.startY;
    setPreviewPos((p) => ({ left: Math.max(0, p.left + dx), top: Math.max(0, p.top + dy) }));
    previewDrag.current.startX = e.clientX;
    previewDrag.current.startY = e.clientY;
  };
  const onPreviewPointerUp = (e: React.PointerEvent) => {
    if (!previewDrag.current) return;
    previewDrag.current.dragging = false;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch (err) { }
    try { localStorage.setItem('pixelate_preview_pos', JSON.stringify(previewPos)); } catch (err) { }
  };

  const pastePreviewDrag = React.useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);
  const onPastePreviewPointerDown = (e: React.PointerEvent) => {
    pastePreviewDrag.current = { dragging: true, startX: e.clientX, startY: e.clientY };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPastePreviewPointerMove = (e: React.PointerEvent) => {
    if (!pastePreviewDrag.current || !pastePreviewDrag.current.dragging) return;
    const dx = e.clientX - pastePreviewDrag.current.startX;
    const dy = e.clientY - pastePreviewDrag.current.startY;
    setPastePreviewPos((p) => ({ left: Math.max(0, p.left + dx), top: Math.max(0, p.top + dy) }));
    pastePreviewDrag.current.startX = e.clientX;
    pastePreviewDrag.current.startY = e.clientY;
  };
  const onPastePreviewPointerUp = (e: React.PointerEvent) => {
    if (!pastePreviewDrag.current) return;
    pastePreviewDrag.current.dragging = false;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch (err) { }
  };

  // 客户端轻量抠图：基于边缘采样估算背景色，按距离阈值把接近背景的像素设为透明
  // 返回一个新的 File（PNG），或者在失败时返回 null
  const removeBackgroundClient = async (file: File): Promise<File | null> => {
    return new Promise<File | null>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          // limit max dimension for performance
          const maxDim = 1024;
          const scale = Math.min(1, Math.max(0.001, Math.min(maxDim / img.width, maxDim / img.height)));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { URL.revokeObjectURL(url); return resolve(null); }
          ctx.drawImage(img, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const data = imageData.data;
          // sample border pixels
          const borderSamples: number[][] = [];
          const stepX = Math.max(1, Math.floor(w / 40));
          const stepY = Math.max(1, Math.floor(h / 40));
          for (let x = 0; x < w; x += stepX) {
            let idx = (0 * w + x) * 4;
            borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
            idx = ((h - 1) * w + x) * 4;
            borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
          }
          for (let y = 0; y < h; y += stepY) {
            let idx = (y * w + 0) * 4;
            borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
            idx = (y * w + (w - 1)) * 4;
            borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
          }
          // compute mean and variance
          const sum = borderSamples.reduce((s, p) => { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; return s; }, [0, 0, 0]);
          const n = Math.max(1, borderSamples.length);
          const mean = [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
          let acc = 0;
          for (const p of borderSamples) {
            const dr = p[0] - mean[0];
            const dg = p[1] - mean[1];
            const db = p[2] - mean[2];
            acc += dr * dr + dg * dg + db * db;
          }
          const avgDist = acc / n;
          const thresholdSq = Math.max(900, Math.round(avgDist * 3)); // tunable
          // apply mask: set alpha = 0 if close to bg mean or already nearly transparent
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            if (a < 16) { data[i + 3] = 0; continue; }
            const dr = r - mean[0], dg = g - mean[1], db = b - mean[2];
            const d2 = dr * dr + dg * dg + db * db;
            if (d2 <= thresholdSq) {
              data[i + 3] = 0;
            }
          }
          ctx.putImageData(imageData, 0, 0);
          // export to blob (PNG preserves alpha)
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (!blob) return resolve(null);
            const outName = file.name.replace(/\.[^/.]+$/, '') + '_bg.png';
            const outFile = new File([blob], outName, { type: 'image/png' });
            resolve(outFile);
          }, 'image/png');
        } catch (err) {
          URL.revokeObjectURL(url);
          console.warn('removeBackgroundClient error', err);
          resolve(null);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  };

  // 工具面板事件处理函数
  const handleClearSelection = () => {
    setSelectionState({ selectedCells: new Set(), isSelecting: false });
  };

  const handleFillSelection = (color: string, productId?: number | null) => {
    // if color empty string => open picker instead of immediate fill
    if (color === '') {
      setShowFillPicker(true);
      return;
    }
    if (selectionState.selectedCells.size === 0) return;

    // 虚拟坐标 → 数组索引：arrayRow = virtualRow - gridOffset.row
    // 先算选区在数组坐标中的边界（与 handleDeleteSelection 一致）
    let minR = Infinity, maxR = -Infinity;
    let minC = Infinity, maxC = -Infinity;
    selectionState.selectedCells.forEach(k => {
      const [rs, cs] = k.split(',');
      const r = parseInt(rs, 10) - gridOffset.row;
      const c = parseInt(cs, 10) - gridOffset.col;
      if (!Number.isNaN(r) && !Number.isNaN(c)) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    });
    if (minR === Infinity) return;

    // 确保像素矩阵覆盖选区边界（自动扩展 + 计算 shiftR/shiftC）
    const expandResult = expandPixelsToInclude(activeLayerPixels, maxR, maxC, Math.min(minR, 0), Math.min(minC, 0));
    const ensured = expandResult.pixels;
    const shiftR = expandResult.shiftR;
    const shiftC = expandResult.shiftC;

    const newColorOverrides = new Map(colorOverrides);
    const newDeletionMask = new Map(deletionMask);

    // 填充选区（虚拟坐标 → 扩展后数组索引）
    selectionState.selectedCells.forEach(cellKey => {
      const [rowStr, colStr] = cellKey.split(',');
      const row = parseInt(rowStr, 10);
      const col = parseInt(colStr, 10);
      const eRow = row - gridOffset.row + shiftR;
      const eCol = col - gridOffset.col + shiftC;
      if (!Number.isNaN(row) && !Number.isNaN(col) && ensured[eRow] && typeof ensured[eRow][eCol] !== 'undefined') {
        ensured[eRow][eCol].hex = color;
        ensured[eRow][eCol].productId = typeof productId === 'number' ? productId : null;

        // colorOverrides/deletionMask 的 key 用虚拟坐标（与 handleDeleteSelection 一致）
        newColorOverrides.set(cellKey, {
          hex: color,
          productId: typeof productId === 'number' ? productId : null
        });
        newDeletionMask.delete(cellKey);
      }
    });

    saveToHistory();

    setPixels(ensured, shiftR, shiftC);
    if (shiftR !== 0 || shiftC !== 0) {
      setGridOffset(prev => ({ row: prev.row - shiftR, col: prev.col - shiftC }));
    }
    setColorOverrides(newColorOverrides);
    setDeletionMask(newDeletionMask);

    setSelectionState({ selectedCells: new Set(), isSelecting: false });
  };

  const handleDeleteSelection = () => {
    if (selectionState.selectedCells.size === 0) return;

    // ensure pixel matrix covers selection bounds (virtual coords → array indices)
    let maxR = -Infinity;
    let maxC = -Infinity;
    let minR = Infinity;
    let minC = Infinity;
    selectionState.selectedCells.forEach(k => {
      const [rs, cs] = k.split(',');
      const r = parseInt(rs, 10) - gridOffset.row;
      const c = parseInt(cs, 10) - gridOffset.col;
      if (!Number.isNaN(r) && !Number.isNaN(c)) {
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
        if (r < minR) minR = r;
        if (c < minC) minC = c;
      }
    });
    const expandResult = expandPixelsToInclude(activeLayerPixels, maxR, maxC, Math.min(minR, 0), Math.min(minC, 0));
    const ensured = expandResult.pixels;
    const shiftR = expandResult.shiftR;
    const shiftC = expandResult.shiftC;

    // 更新删除mask
    const newDeletionMask = new Map(deletionMask);
    // 清除之前的改色记录（如果有的话）
    const newColorOverrides = new Map(colorOverrides);

    selectionState.selectedCells.forEach(cellKey => {
      const [rowStr, colStr] = cellKey.split(',');
      const row = parseInt(rowStr, 10);
      const col = parseInt(colStr, 10);
      // 虚拟坐标转数组索引
      const eRow = row - gridOffset.row + shiftR;
      const eCol = col - gridOffset.col + shiftC;
      if (!Number.isNaN(row) && !Number.isNaN(col) && ensured[eRow] && typeof ensured[eRow][eCol] !== 'undefined') {
        ensured[eRow][eCol].hex = null;
        ensured[eRow][eCol].productId = null;

        // 记录删除操作
        newDeletionMask.set(cellKey, true);
        // 清除对应的改色记录
        newColorOverrides.delete(cellKey);
      }
    });

    saveToHistory();

    setPixels(ensured, shiftR, shiftC);
    if (shiftR !== 0 || shiftC !== 0) {
      setGridOffset(prev => ({ row: prev.row - shiftR, col: prev.col - shiftC }));
    }
    setDeletionMask(newDeletionMask);
    setColorOverrides(newColorOverrides);

    setSelectionState({ selectedCells: new Set(), isSelecting: false });
  };

  // 复制选中的像素
  const handleCopySelection = () => {
    if (selectionState.selectedCells.size === 0) return;

    // 计算选中区域的边界
    let minRow = Infinity, maxRow = -Infinity;
    let minCol = Infinity, maxCol = -Infinity;

    selectionState.selectedCells.forEach(cellKey => {
      const [row, col] = cellKey.split(',').map(Number);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
    });

    // 提取选中的像素数据
    const pixelsMap = new Map<string, { hex: string | null; productId: number | null }>();
    selectionState.selectedCells.forEach(cellKey => {
      const [row, col] = cellKey.split(',').map(Number);
      if (row >= 0 && row < activeLayerPixels.length && col >= 0 && col < activeLayerPixels[row].length) {
        const cell = activeLayerPixels[row][col];
        // 存储相对位置
        const relRow = row - minRow;
        const relCol = col - minCol;
        pixelsMap.set(`${relRow},${relCol}`, { hex: cell.hex, productId: cell.productId });
      }
    });

    // 保存到剪贴板
    setClipboard({
      pixels: pixelsMap,
      width: maxCol - minCol + 1,
      height: maxRow - minRow + 1,
      minRow,
      minCol
    });
  };

  // 粘贴像素到指定位置
  const handlePaste = (targetRow: number, targetCol: number) => {
    if (!clipboard) return;

    // 确保像素矩阵足够大
    const maxRow = targetRow + clipboard.height - 1;
    const maxCol = targetCol + clipboard.width - 1;
    const expandResult = expandPixelsToInclude(activeLayerPixels, maxRow, maxCol, Math.min(targetRow, 0), Math.min(targetCol, 0));
    const ensured = expandResult.pixels;
    const shiftR = expandResult.shiftR;
    const shiftC = expandResult.shiftC;

    // 应用粘贴
    const newColorOverrides = new Map(colorOverrides);
    const newDeletionMask = new Map(deletionMask);

    clipboard.pixels.forEach((cell, relKey) => {
      const [relRow, relCol] = relKey.split(',').map(Number);
      const row = targetRow + relRow + shiftR;
      const col = targetCol + relCol + shiftC;

      if (row >= 0 && row < ensured.length && col >= 0 && col < ensured[row].length) {
        ensured[row][col].hex = cell.hex;
        ensured[row][col].productId = cell.productId;

        // 记录改色操作（使用虚拟坐标）
        const vRow = targetRow + relRow;
        const vCol = targetCol + relCol;
        const cellKey = `${vRow},${vCol}`;
        newColorOverrides.set(cellKey, {
          hex: cell.hex || '',
          productId: cell.productId
        });
        // 清除删除记录
        newDeletionMask.delete(cellKey);
      }
    });

    saveToHistory();

    setPixels(ensured, shiftR, shiftC);
    if (shiftR !== 0 || shiftC !== 0) {
      setGridOffset(prev => ({ row: prev.row - shiftR, col: prev.col - shiftC }));
    }
    setColorOverrides(newColorOverrides);
    setDeletionMask(newDeletionMask);
  };

  // 用于跟踪画笔绘画状态的 ref
  const brushDrawingRef = useRef(false);
  // 缓存最新的活跃图层像素，确保快速连续绘制时不会因 React 异步渲染丢失数据
  const latestPixelsRef = useRef<PixelCell[][]>(activeLayerPixels);
  latestPixelsRef.current = activeLayerPixels;

  // 画笔绘画处理
  const handleBrushDraw = (cells: Array<{ row: number; col: number }>) => {
    if (!activeBrush.color && !activeBrush.productId) {
      alert('请先选择画笔颜色');
      return;
    }

    // 在开始新的绘画时保存历史记录（只在第一次调用时保存）
    if (!brushDrawingRef.current) {
      saveToHistory();
      brushDrawingRef.current = true;
    }

    // 确保像素矩阵覆盖所有绘画区域（cells 是虚拟坐标，需转为数组索引）
    // 使用 ref 获取最新像素数据，避免快速连续绘制时数据丢失
    const currentPixels = latestPixelsRef.current;
    let maxR = -Infinity;
    let maxC = -Infinity;
    let minR = Infinity;
    let minC = Infinity;
    cells.forEach(({ row, col }) => {
      const arrRow = row - gridOffset.row;
      const arrCol = col - gridOffset.col;
      if (arrRow > maxR) maxR = arrRow;
      if (arrCol > maxC) maxC = arrCol;
      if (arrRow < minR) minR = arrRow;
      if (arrCol < minC) minC = arrCol;
    });

    const expandResult = expandPixelsToInclude(currentPixels, maxR, maxC, Math.min(minR, 0), Math.min(minC, 0));
    const ensured = expandResult.pixels;
    const shiftR = expandResult.shiftR;
    const shiftC = expandResult.shiftC;

    // 应用画笔颜色
    const newColorOverrides = new Map(colorOverrides);
    const newDeletionMask = new Map(deletionMask);

    cells.forEach(({ row, col }) => {
      const arrRow = row - gridOffset.row + shiftR;
      const arrCol = col - gridOffset.col + shiftC;
      if (arrRow >= 0 && arrRow < ensured.length && arrCol >= 0 && arrCol < ensured[arrRow].length) {
        ensured[arrRow][arrCol].hex = activeBrush.color;
        ensured[arrRow][arrCol].productId = activeBrush.productId;

        // 记录改色操作（使用虚拟坐标）
        const cellKey = `${row},${col}`;
        newColorOverrides.set(cellKey, {
          hex: activeBrush.color || '',
          productId: activeBrush.productId
        });
        // 清除删除记录
        newDeletionMask.delete(cellKey);
      }
    });

    // 立即更新 ref，确保下一次 handleBrushDraw 调用能拿到最新数据
    latestPixelsRef.current = ensured;

    setPixels(ensured, shiftR, shiftC);
    if (shiftR !== 0 || shiftC !== 0) {
      setGridOffset(prev => ({ row: prev.row - shiftR, col: prev.col - shiftC }));
    }
    setColorOverrides(newColorOverrides);
    setDeletionMask(newDeletionMask);
  };

  // 画笔完成时的回调 - 用于重置绘画状态
  const handleBrushEnd = () => {
    brushDrawingRef.current = false;
  };

  // 橡皮擦擦除处理
  const handleBrushErase = (cells: Array<{ row: number; col: number }>) => {
    if (!brushDrawingRef.current) {
      saveToHistory();
      brushDrawingRef.current = true;
    }

    const currentPixels = latestPixelsRef.current;
    const ensured = currentPixels.map(row => row.map(cell => ({ ...cell })));

    const newDeletionMask = new Map(deletionMask);

    cells.forEach(({ row, col }) => {
      const arrRow = row - gridOffset.row;
      const arrCol = col - gridOffset.col;
      if (arrRow >= 0 && arrRow < ensured.length && arrCol >= 0 && arrCol < ensured[arrRow].length) {
        if (ensured[arrRow][arrCol].hex !== null) {
          ensured[arrRow][arrCol].hex = null;
          ensured[arrRow][arrCol].productId = null;
          newDeletionMask.set(`${row},${col}`, true);
        }
      }
    });

    latestPixelsRef.current = ensured;
    setPixels(ensured);
    setDeletionMask(newDeletionMask);
  };

  // 打开画笔颜色选择器
  const handleOpenBrushColorPicker = () => {
    setShowBrushColorPicker(true);
  };

  // 导出原始像素图（PNG透明通道，无压缩）
  const exportPixelPng = () => {
    const pxs = activeLayerPixels;
    if (!pxs || pxs.length === 0) return;

    // 找到有效像素的边界（自动裁剪空白区域）
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (let r = 0; r < pxs.length; r++) {
      for (let c = 0; c < (pxs[r]?.length || 0); c++) {
        if (pxs[r][c]?.hex) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    if (minR === Infinity) return; // 没有有效像素

    const cropRows = maxR - minR + 1;
    const cropCols = maxC - minC + 1;

    const canvas = document.createElement('canvas');
    canvas.width = cropCols;
    canvas.height = cropRows;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 逐像素绘制，空像素保持透明
    for (let r = 0; r < cropRows; r++) {
      for (let c = 0; c < cropCols; c++) {
        const cell = pxs[r + minR]?.[c + minC];
        if (cell?.hex) {
          ctx.fillStyle = cell.hex;
          ctx.fillRect(c, r, 1, 1);
        }
      }
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pixel-art-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  // 确认画笔颜色
  const handleConfirmBrushColor = (productId: number | null, color: string) => {
    updateBrush(activeBrushId, { color, productId });
    setShowBrushColorPicker(false);
    setBrushPreviewColor(null);
    setBrushPreviewProductId(null);
  };

  // 获取可用的颜色列表（从当前像素中提取）
  const getAvailableColors = () => {
    const colors = new Set<string>();
    pixels.forEach(row => {
      row.forEach(cell => {
        if (cell.hex) {
          colors.add(cell.hex);
        }
      });
    });
    return Array.from(colors);
  };

  // recompute stats structure from pixel matrix
  const computeStatsFromPixels = (pxs: PixelCell[][]) => {
    const map = new Map<string, { productId?: number | null; hex?: string | null; count: number }>();
    for (let r = 0; r < pxs.length; r++) {
      for (let c = 0; c < (pxs[r]?.length || 0); c++) {
        const cell = pxs[r][c];
        if (!cell || !cell.hex) continue;
        const key = (typeof cell.productId === 'number') ? `p:${cell.productId}` : `h:${cell.hex!.toLowerCase()}`;
        if (!map.has(key)) {
          map.set(key, { productId: typeof cell.productId === 'number' ? cell.productId : null, hex: cell.hex, count: 0 });
        }
        const entry = map.get(key)!;
        entry.count += 1;
      }
    }
    // convert to StatsPanel expected format: { productId, code, hex, count }
    const out = Array.from(map.values()).map((it) => {
      let code = '';
      if (typeof it.productId === 'number') {
        const prod = availableMaterials.find(m => m.id === it.productId);
        code = prod?.code || String(it.productId);
      } else {
        code = it.hex || '自定义';
      }
      return { productId: it.productId, code, hex: it.hex || undefined, count: it.count };
    });
    // sort by count desc for nicer UI
    out.sort((a, b) => b.count - a.count);
    return out;
  };

  // 应用映射编辑：把 pixels 里指定 productId/hex 的格子批量换成新物料
  const handleApplyMapping = (changes: Map<number | string, MappingChange>) => {
    if (changes.size === 0) { setMappingEditorVisible(false); return; }
    setLayers((prev) => prev.map((layer) => {
      if (layer.id !== activeLayerId) return layer;
      const newPixels = layer.pixels.map((row) =>
        row.map((cell) => {
          if (!cell || !cell.hex) return cell;
          // 按 productId 或 hex 查找是否在修改列表里
          const key = typeof cell.productId === 'number' ? cell.productId : cell.hex.toLowerCase();
          const change = changes.get(key);
          if (change) return { hex: change.hex, productId: change.productId };
          return cell;
        })
      );
      return { ...layer, pixels: newPixels };
    }));
    // stats 重算由已有的 pixels 变化 effect 自动触发
    setMappingEditorVisible(false);
  };

  // expand pixels matrix so that it includes at least up to maxRow/maxCol (no negative handling)
  const expandPixelsToInclude = (pxs: PixelCell[][], maxRow: number, maxCol: number, minRow: number = 0, minCol: number = 0): { pixels: PixelCell[][], shiftR: number, shiftC: number } => {
    const oldRows = pxs.length;
    const oldCols = pxs[0]?.length || 0;

    // Calculate expansion needed in each direction
    const topPad = minRow < 0 ? -minRow : 0;
    const leftPad = minCol < 0 ? -minCol : 0;
    const newRows = topPad + Math.max(oldRows, maxRow + 1);
    const newCols = leftPad + Math.max(oldCols, maxCol + 1);

    if (newRows === oldRows && newCols === oldCols && topPad === 0 && leftPad === 0) {
      return { pixels: pxs.map(row => row.map(cell => ({ ...cell }))), shiftR: 0, shiftC: 0 };
    }

    const newPixels: PixelCell[][] = [];
    for (let r = 0; r < newRows; r++) {
      const rowArr: PixelCell[] = [];
      for (let c = 0; c < newCols; c++) {
        const oldR = r - topPad;
        const oldC = c - leftPad;
        rowArr.push(oldR >= 0 && oldR < oldRows && oldC >= 0 && oldC < oldCols
          ? { ...pxs[oldR][oldC] }
          : { hex: null, productId: null });
      }
      newPixels.push(rowArr);
    }
    return { pixels: newPixels, shiftR: topPad, shiftC: leftPad };
  };

  // fill picker modal state & preview
  const [showFillPicker, setShowFillPicker] = useState<boolean>(false);
  const [previewFillColor, setPreviewFillColor] = useState<string | null>(null);
  const [previewFillProductId, setPreviewFillProductId] = useState<number | null>(null);

  // 多画笔系统
  const {
    brushes,
    activeBrushId,
    activeBrush,
    setActiveBrushId,
    updateBrush,
    loadFromProject,
    exportForProject
  } = useBrushPresets();

  // 快捷键：Q/W 切换画笔颜色，1-8 切换画笔，E 橡皮擦
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Ctrl+Z 撤销，Ctrl+Y 重做
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        performUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        performRedo();
        return;
      }

      // E: 切换橡皮擦
      if (e.key === 'e' || e.key === 'E') {
        setCurrentTool(currentTool === 'eraser' ? 'brush' : 'eraser');
        return;
      }

      // I: 切换深色背景
      if (e.key === 'i' || e.key === 'I') {
        setDarkBackground(prev => !prev);
        return;
      }

      // 1-8: 切换画笔1-8
      const num = parseInt(e.key);
      if (num >= 1 && num <= 8 && brushes.some(b => b.id === num)) {
        setCurrentTool('brush');
        setActiveBrushId(num);
        return;
      }

      // Q/W: 仅在画笔工具时切换物料颜色
      if (currentTool !== 'brush') return;
      const isPrev = e.key === 'q' || e.key === 'Q';
      const isNext = e.key === 'w' || e.key === 'W';
      if (!isPrev && !isNext) return;

      if (availableMaterials.length === 0) return;

      const curIdx = availableMaterials.findIndex(m => m.id === activeBrush.productId);
      let nextIdx: number;
      if (curIdx === -1) {
        nextIdx = isNext ? 0 : availableMaterials.length - 1;
      } else {
        nextIdx = isNext
          ? (curIdx + 1) % availableMaterials.length
          : (curIdx - 1 + availableMaterials.length) % availableMaterials.length;
      }

      const mat = availableMaterials[nextIdx];
      if (mat) {
        updateBrush(activeBrushId, { color: mat.color_hex || null, productId: mat.id });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTool, activeBrush, activeBrushId, availableMaterials, updateBrush, brushes, setActiveBrushId, setCurrentTool, performUndo, performRedo, setDarkBackground]);

  const [showBrushColorPicker, setShowBrushColorPicker] = useState<boolean>(false);
  const [brushPreviewColor, setBrushPreviewColor] = useState<string | null>(null);
  const [brushPreviewProductId, setBrushPreviewProductId] = useState<number | null>(null);

  // compute preview pixels if picker open and preview color selected
  const computePreviewPixels = () => {
    if (!showFillPicker || !previewFillColor || selectionState.selectedCells.size === 0) return pixels;
    // 预览只做临时覆盖，不扩展网格。虚拟坐标 → 数组索引：减去 gridOffset。
    const newPixels = pixels.map(row => row.map(cell => ({ ...cell })));
    selectionState.selectedCells.forEach(cellKey => {
      const [rs, cs] = cellKey.split(',');
      const r = parseInt(rs, 10) - gridOffset.row;
      const c = parseInt(cs, 10) - gridOffset.col;
      if (!Number.isNaN(r) && !Number.isNaN(c) && newPixels[r] && typeof newPixels[r][c] !== 'undefined') {
        newPixels[r][c].hex = previewFillColor;
        newPixels[r][c].productId = previewFillProductId;
      }
    });
    return newPixels;
  };
  const displayedPixels = computePreviewPixels();
  // helper: compare material codes so that codes starting with letters A-Z come before codes starting with digits 0-9,
  // then perform a case-insensitive locale compare (numeric-aware) for full code ordering.
  const compareMaterialCodes = (a?: string, b?: string): number => {
    const ca = (a || '').toLowerCase();
    const cb = (b || '').toLowerCase();
    const fa = ca.charAt(0) || '';
    const fb = cb.charAt(0) || '';
    const isLetterA = /[a-z]/.test(fa);
    const isLetterB = /[a-z]/.test(fb);
    // letters before non-letters (digits)
    if (isLetterA !== isLetterB) return isLetterA ? -1 : 1;
    // same class: compare full strings with numeric-aware comparison
    return ca.localeCompare(cb, undefined, { numeric: true, sensitivity: 'base' });
  };

  // generate sample image blob: top = pixelated preview (with grid & axis), bottom = swatches with code and count
  // options: format = 'png' | 'jpeg', quality for jpeg, minCellSize ensures resolution not too low
  //   boardSize: 0 = 自适应裁剪（旧行为）；> 0 = 把内容居中放在 boardSize×boardSize 的背板上
  const generateSampleImageBlob = async (
    pxs: PixelCell[][],
    statsList: any[],
    materials: any[] = [],
    options?: {
      format?: 'png' | 'jpeg';
      quality?: number;
      minCellSize?: number;
      maxWidth?: number;
      boardSize?: number;
      marginMode?: 'margin' | 'none';      // 自适应模式下的边距：'margin' = 留 1 格边（默认），'none' = 无边
      cellGridLines?: boolean;              // 每格细线开关
      boardRulerEnabled?: boolean;          // 背板标尺线（10 格实线 + 5 格虚线）开关
      transparentEmpty?: boolean;           // 空白格用 PS 棋盘格样式表示
      mirror?: boolean;                     // 水平镜像：导出时左右翻转像素内容（坐标/网格框架不动）
    }
  ): Promise<Blob | null> => {
    try {
      const totalCols = pxs[0]?.length || 0;
      const totalRows = pxs.length || 0;

      // Auto-crop: find bounding box of effective (colored) pixels
      let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
      for (let r = 0; r < totalRows; r++) {
        for (let c = 0; c < totalCols; c++) {
          if (pxs[r]?.[c]?.hex) {
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
            if (c < minC) minC = c;
            if (c > maxC) maxC = c;
          }
        }
      }

      // If no colored pixels, return null
      if (maxR < 0) return null;

      // 边距模式（仅自适应模式生效）：
      // - 'margin'：内容四周留 1 格空白边（视觉上让图与背板边界有缓冲，符合拼豆图纸习惯）
      // - 'none'：内容贴边，无任何留白
      // 注意：旧代码用 Math.max(0, minR-1) 在"原画布坐标系"加边距，当内容贴在原画布边缘时
      //       边距会被截断为 0，导致"有的图有边、有的图没边"的不一致现象。
      //       现在改为"先裁出纯内容，再在纯内容四周统一加 1 格空白"，行为可预测且四边对称。
      const marginOpt = options?.marginMode === 'none' ? 'none' : 'margin';
      const wantMargin = marginOpt === 'margin';
      // 纯内容边界（不含边距）
      const pureContentRows = maxR - minR + 1;
      const pureContentCols = maxC - minC + 1;
      // 最终内容尺寸 = 纯内容 + 边距（margin 模式下四周各 1 格）
      const contentRows = wantMargin ? pureContentRows + 2 : pureContentRows;
      const contentCols = wantMargin ? pureContentCols + 2 : pureContentCols;
      // cropMinR/C 仍是"在 pxs 原始数组中的取数起点"（纯内容左上角）
      // 边距通过下方 boardOffsetRow/Col 类似机制实现：自适应模式下也引入 contentOffset
      const cropMinR = minR;
      const cropMaxR = maxR;
      const cropMinC = minC;
      const cropMaxC = maxC;

      // 背板模式：boardSize > 0 时使用 boardSize×boardSize 作为画布尺寸，并把内容居中
      const boardOpt = typeof options?.boardSize === 'number' ? options.boardSize : 0;
      const useBoard = boardOpt > 0;
      const rows = useBoard ? boardOpt : contentRows;
      const cols = useBoard ? boardOpt : contentCols;
      // 内容在最终画布中的左上角偏移（行/列）：
      // - 背板模式：按 (boardSize - contentSize) / 2 居中（contentSize 已含边距）
      // - 自适应 + margin 模式：偏移 = 1（在纯内容四周留 1 格空白边）
      // - 自适应 + none 模式：偏移 = 0（内容贴边）
      const contentOffsetRow = useBoard ? Math.floor((boardOpt - contentRows) / 2) : (wantMargin ? 1 : 0);
      const contentOffsetCol = useBoard ? Math.floor((boardOpt - contentCols) / 2) : (wantMargin ? 1 : 0);
      // 兼容旧变量名（下方像素绘制 / 标尺坐标转换仍用 boardOffsetRow/Col 命名）
      const boardOffsetRow = contentOffsetRow;
      const boardOffsetCol = contentOffsetCol;

      const padding = 12;
      const format = options?.format || exportFormat || 'jpeg';
      const quality = typeof options?.quality === 'number' ? options!.quality : (exportQuality || 0.85);
      const minCellSize = options?.minCellSize || exportMinCellSize || 24;
      const maxWidth = options?.maxWidth || 2400;

      // determine cellSize —— 必须保证 cols * cellSize <= maxWidth，否则会被画布裁剪（X 轴截断 bug 的根因）
      // 旧行为会把 cellSize 强行抬高到 minCellSize，导致 100 列时总宽超过 maxWidth 被截断。
      // 新行为：先用 maxWidth / cols 限制 cellSize 上限，再用 minCellSize 限制下限（仅在列数较少时生效）。
      const cellFromMaxWidth = Math.max(1, Math.floor(maxWidth / Math.max(1, cols)));
      const cellFromMinAuto = cols > 0 ? Math.ceil(800 / Math.max(1, cols)) : minCellSize;
      // 小图（列数少）时希望保持 minCellSize 清晰度；大图（列数多）时以 maxWidth 为硬上限
      let cellSize = Math.max(1, Math.min(cellFromMaxWidth, Math.max(minCellSize, cellFromMinAuto)));
      cellSize = Math.max(1, cellSize);
      // 注意：不再用 Math.min(maxWidth, cols * cellSize) 截断 topWidth，否则画布宽度 < 实际绘制宽度会造成右侧裁剪
      const topWidth = cols * cellSize;
      const topHeight = rows * cellSize;

      // header for axis labels (virtual coordinates)
      const headerW = Math.max(36, Math.floor(cellSize * 1.6));
      const headerH = Math.max(24, Math.floor(cellSize * 1.2));

      // prepare canvas width & bottom layout
      const swatchSize = Math.max(20, Math.floor(cellSize * 1.6));
      const gap = 8;
      const lineHeight = Math.max(swatchSize, 20) + gap;

      const sorted = [...statsList].sort((a, b) => compareMaterialCodes(a.code, b.code));

      // create a temporary canvas context to measure text widths (using same font)
      const measureCanvas = document.createElement('canvas');
      const measureCtx = measureCanvas.getContext('2d');
      const measureFont = `${Math.max(12, Math.floor(cellSize * 0.9))}px monospace`;
      if (!measureCtx) return null;
      measureCtx.font = measureFont;

      // compute measured widths for each item (respect padding and capped count width)
      const measuredWidths: number[] = [];
      const texts: string[] = [];
      for (const item of sorted) {
        let countStr = String(item.count);
        if (countStr.length > 5) countStr = countStr.slice(0, 5);
        const paddedCount = countStr.padStart(5, ' ');
        const text = `${item.code} (${paddedCount})`;
        texts.push(text);
        const w = Math.min(1000, measureCtx.measureText(text).width);
        measuredWidths.push(w);
      }

      // estimate canvas width (grid area + headers + padding)
      // 左侧 headerW（行号标尺）+ 内容 topWidth + 右侧 headerW（行号标尺，方便大图拖到右下角时读坐标）
      const canvasWidth = headerW + topWidth + headerW + padding * 2;
      // available width for bottom items (excluding left+right header area)
      const availableWidth = canvasWidth - padding * 2 - headerW * 2;

      // === 列网格布局：所有列等宽，上下行严格对齐，避免流式布局的不对齐问题 ===
      // 取最宽的 block 作为统一列宽，保证每个 item 都能完整放入一个格子
      const maxBlockW = measuredWidths.length > 0 ? Math.max(...measuredWidths) + gap * 2 : 0;
      // 列数：至少 1 列；当列宽较大时也不要少于一定数量以利用横向空间
      const numCols = maxBlockW > 0 ? Math.max(1, Math.floor(availableWidth / maxBlockW)) : 1;
      // 真正的统一列宽：把可用宽度均匀分给各列（≥ maxBlockW，确保不溢出）
      const colWidth = numCols > 0 ? Math.floor(availableWidth / numCols) : availableWidth;
      const bottomRows = numCols > 0 ? Math.ceil(sorted.length / numCols) : 1;
      const bottomHeight = bottomRows * lineHeight + padding * 2;

      const totalWidth = canvasWidth;
      // 顶部 headerH（列号标尺）+ 内容 topHeight + 底部 headerH（列号标尺，方便大图拖到右下角时读坐标）+ 物料区
      const totalHeight = padding + headerH + topHeight + headerH + padding + bottomHeight;

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(totalWidth));
      canvas.height = Math.max(1, Math.floor(totalHeight));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

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

      // background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // compute content origin (where grid starts)
      const contentOriginX = padding + headerW;
      const contentOriginY = padding + headerH;

      // draw grid background
      ctx.fillStyle = '#f9fafb';
      ctx.fillRect(contentOriginX, contentOriginY, topWidth, topHeight);

      // 空白格棋盘格开关：开启后没有物料的格子用 PS 透明棋盘格样式（灰白交替）表示
      // PS 透明棋盘格的经典配色：浅灰 #e5e5e5 + 中灰 #bfbfbf（或更接近原版的 #d4d4d4 / #999）
      // 这里采用 #d8d8d8 / #a8a8a8，对比清晰但不刺眼，不与物料颜色混淆
      const transparentEmptyEnabled = options?.transparentEmpty === true;
      // 水平镜像：开启后画布列 c 对应的源列左右翻转（坐标标尺/网格线框架不变）
      const mirrorEnabled = options?.mirror === true;
      const mapOrigCol = (c: number): number => {
        const mc = mirrorEnabled ? cols - 1 - c : c;
        return mc - boardOffsetCol + cropMinC;
      };

      // 预先绘制棋盘格（只在 transparentEmptyEnabled 时生效）。
      // 思路：先把整个网格区域画成棋盘格，然后在上面的像素绘制循环里用物料颜色覆盖有物料的格子。
      // 棋盘格按画布坐标 (r,c) 连续分布，让相邻空格的图案无缝衔接，视觉上像一整块透明背景。
      if (transparentEmptyEnabled) {
        const light = '#e5e5e5'; // 棋盘格浅色
        const dark = '#b0b0b0';  // 棋盘格深色
        // 子格大小：每格内分 2×2 个棋盘子格，所以 subSize = cellSize / 2（保证至少 1px）
        const subSize = Math.max(1, Math.floor(cellSize / 2));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const origR = r - boardOffsetRow + cropMinR;
            const origC = mapOrigCol(c);
            const cell = pxs[origR]?.[origC];
            // 有物料的格子稍后用物料色覆盖，这里跳过以省绘制（也可全画再覆盖，等价但更慢）
            if (cell && cell.hex) continue;
            const x0 = contentOriginX + c * cellSize;
            const y0 = contentOriginY + r * cellSize;
            // 2×2 棋盘格，按画布 (r,c) 奇偶决定起始色，让相邻格子图案连续
            const baseLight = (r + c) % 2 === 0;
            ctx.fillStyle = baseLight ? light : dark;
            ctx.fillRect(x0, y0, subSize, subSize);
            ctx.fillStyle = baseLight ? dark : light;
            ctx.fillRect(x0 + subSize, y0, subSize, subSize);
            ctx.fillStyle = baseLight ? dark : light;
            ctx.fillRect(x0, y0 + subSize, subSize, subSize);
            ctx.fillStyle = baseLight ? light : dark;
            ctx.fillRect(x0 + subSize, y0 + subSize, subSize, subSize);
          }
        }
      }

      // draw pixel cells
      // 画布坐标 (r, c) → pxs 数组坐标：统一公式 origR = r - boardOffsetRow + cropMinR
      //   - 背板模式：boardOffsetRow 为居中偏移，超出内容范围的格子为空白背板
      //   - 自适应 margin 模式：boardOffsetRow = 1，第 0 行/列是边距（空白），第 1 行起才是内容
      //   - 自适应 none 模式：boardOffsetRow = 0，画布第 0 行直接对应 pxs[cropMinR]
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const origR = r - boardOffsetRow + cropMinR;
          const origC = mapOrigCol(c);
          const cell = pxs[origR]?.[origC];
          if (!cell || !cell.hex) continue;
          ctx.fillStyle = cell.hex;
          ctx.fillRect(contentOriginX + c * cellSize, contentOriginY + r * cellSize, cellSize, cellSize);

          // 绘制材料代码文字
          const materialCode = getMaterialCode(cell.productId);
          if (materialCode) {
            ctx.save();
            const textColor = getTextColor(cell.hex);
            ctx.fillStyle = textColor;
            // 根据cellSize调整字体大小，确保文字不会太大
            const fontSize = Math.min(cellSize * 0.6, Math.max(8, cellSize * 0.4));
            ctx.font = `bold ${fontSize}px "Microsoft YaHei", "微软雅黑", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // 在单元格中心绘制文字
            const centerX = contentOriginX + c * cellSize + cellSize / 2;
            const centerY = contentOriginY + r * cellSize + cellSize / 2;
            ctx.fillText(materialCode, centerX, centerY);
            ctx.restore();
          }
        }
      }

      // === 标尺（绘制在像素格之上）===
      // 设计：
      // - 每格细线（可选）：每个格子都画一条淡而细的边线，方便数格子
      // - 每 10 格一根粗实线（背板/区块边界，可选）
      // - 每 5 格一根粗虚线（中间刻度，不含 10 的倍数位置，避免与实线重叠，可选）
      // - 标尺线统一使用全黑（在彩色像素上对比度最高，视觉效果最佳）
      // 标尺开关
      const cellGridEnabled = options?.cellGridLines !== false;   // 默认开启
      const boardRulerEnabled = options?.boardRulerEnabled !== false; // 默认开启
      // 全黑模式：所有标尺线统一用黑色（无需按底色判断）
      const lineColorForH = (_c1: number, _c2: number, _r: number): string => '#000000';
      const lineColorForV = (_r1: number, _r2: number, _c: number): string => '#000000';

      // === 网格线位置计算 ===
      // symmetric=true（标准背板 52/78/104/120 等）：非 10 倍数时把余数平分为两侧边距，
      //   让网格区间在尺寸内对称分布（上下/左右间距相等）。
      //   - 50 格（10 倍数）：位置 0,10,...,50
      //   - 52 格：margin=1，位置 0,1,11,21,31,41,51,52（左右各 1 格边距）
      //   - 78 格：margin=4，位置 0,4,14,...,74,78
      //   - 104 格：margin=2，位置 0,2,12,...,102,104
      //   - 120 格：10 倍数，位置 0,10,...,120
      // symmetric=false（自适应裁剪）：从左上角顶格开始计数，每 10 格一条线，末端补 size。
      //   不做对称处理，符合"自适应 = 内容紧贴左上角"的直觉。
      const calcRulerLines = (size: number, symmetric: boolean): number[] => {
        const remainder = size % 10;
        // 10 的倍数、或小图、或非对称模式：从 0 顶格开始，每 10 格一条，末端兜底补 size
        if (remainder === 0 || size < 10 || !symmetric) {
          const pos: number[] = [];
          for (let i = 0; i <= size; i += 10) pos.push(i);
          if (pos[pos.length - 1] !== size) pos.push(size);
          return pos;
        }
        // 标准背板 + 非 10 倍数：余数平分为两侧边距
        const margin = Math.floor(remainder / 2);
        const pos: number[] = [0]; // 左/上外框
        for (let p = margin; p <= size - margin; p += 10) {
          if (p !== 0 && p !== size) pos.push(p);
        }
        pos.push(size); // 右/下外框
        return Array.from(new Set(pos)).sort((a, b) => a - b);
      };
      // 虚线位置策略（与实线配套）：
      // - 标准背板（对称模式）：实线因余数平分边距而整体偏移（如 104 格实线在 2,12,22,...），
      //   此时虚线必须落在"相邻两条实线的正中间"，否则会紧贴实线造成视觉错乱
      //   （如旧版 104 格实线在 2，虚线却固定在 5，距离 2 只有 3 格，看起来像从实线开始）。
      //   规则：取每个 ≥6 格区间的整数中点；半格中点（奇数区间）和小边距区间不画。
      // - 自适应（顶格模式）：实线固定在 0,10,20,...，虚线固定在 5 的倍数即可，顶格对齐。
      // 两种模式虚线都落在整数格边界，绝不会出现在格子中间（如 43.5）。
      const calcDashedLines = (solid: number[], size: number, symmetric: boolean): number[] => {
        const dashed: number[] = [];
        if (!symmetric) {
          // 自适应：5 的倍数（非实线位置）
          const solidSet = new Set(solid.map((s) => Math.round(s)));
          for (let p = 5; p < size; p += 10) {
            if (!solidSet.has(p)) dashed.push(p);
          }
        } else {
          // 标准背板：相邻实线的整数中点（区间 ≥6 格才画，避免边距小区间）
          for (let i = 0; i < solid.length - 1; i++) {
            const a = solid[i];
            const b = solid[i + 1];
            if (b - a < 6) continue;
            const mid = (a + b) / 2;
            if (Number.isInteger(mid) && mid > 0 && mid < size) dashed.push(mid);
          }
        }
        return dashed;
      };
      // 标准背板模式用对称分布；自适应模式顶格开始（含留边情况，留边只是整体平移，不影响计数起点）
      const solidRows = calcRulerLines(rows, useBoard);
      const solidCols = calcRulerLines(cols, useBoard);
      const dashedRows = calcDashedLines(solidRows, rows, useBoard);
      const dashedCols = calcDashedLines(solidCols, cols, useBoard);

      // 每格细线（方便数格子）：每个格子都画一条细而淡的边线
      // 颜色同样按底色自适应（auto）或全黑（black），但线宽更细、不透明度更低，避免喧宾夺主
      if (cellGridEnabled) {
        ctx.save();
        ctx.lineWidth = Math.max(0.5, cellSize * 0.02);
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.35;
        // 水平细线（含外框，r=0..rows）
        for (let r = 0; r <= rows; r++) {
          const y = contentOriginY + r * cellSize;
          ctx.beginPath();
          ctx.strokeStyle = lineColorForH(0, cols, r);
          ctx.moveTo(contentOriginX, y);
          ctx.lineTo(contentOriginX + cols * cellSize, y);
          ctx.stroke();
        }
        // 垂直细线
        for (let c = 0; c <= cols; c++) {
          const x = contentOriginX + c * cellSize;
          ctx.beginPath();
          ctx.strokeStyle = lineColorForV(0, rows, c);
          ctx.moveTo(x, contentOriginY);
          ctx.lineTo(x, contentOriginY + rows * cellSize);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 背板标尺线（每 5 格虚线 + 每 10 格实线），可通过 boardRulerEnabled 关闭
      // 虚线/实线位置使用对称居中分布（calcRulerLines/calcDashedLines），
      // 让非 10 倍数背板（52/78/104/120 等）的网格线左右上下间距相等。
      if (boardRulerEnabled) {
        // 虚线（相邻实线的中点）
        ctx.save();
        ctx.lineWidth = Math.max(1.5, cellSize * 0.06);
        ctx.setLineDash([Math.max(4, cellSize * 0.25), Math.max(3, cellSize * 0.18)]);
        ctx.lineCap = 'butt';
        // 水平虚线
        for (const r of dashedRows) {
          const y = contentOriginY + r * cellSize;
          ctx.beginPath();
          ctx.strokeStyle = lineColorForH(0, cols, Math.round(r));
          ctx.moveTo(contentOriginX, y);
          ctx.lineTo(contentOriginX + cols * cellSize, y);
          ctx.stroke();
        }
        // 垂直虚线
        for (const c of dashedCols) {
          const x = contentOriginX + c * cellSize;
          ctx.beginPath();
          ctx.strokeStyle = lineColorForV(0, rows, Math.round(c));
          ctx.moveTo(x, contentOriginY);
          ctx.lineTo(x, contentOriginY + rows * cellSize);
          ctx.stroke();
        }
        ctx.restore();
      } // end boardRulerEnabled (dashed)

      // 每 10 格粗实线（外框 + 内部分割线，对称居中分布）
      if (boardRulerEnabled) {
        ctx.save();
        ctx.lineWidth = Math.max(2, cellSize * 0.1);
        ctx.setLineDash([]);
        // 水平实线（solidRows 已含 0 和 rows，覆盖外框）
        for (const r of solidRows) {
          const y = contentOriginY + r * cellSize;
          ctx.beginPath();
          ctx.strokeStyle = lineColorForH(0, cols, Math.round(r));
          ctx.moveTo(contentOriginX, y);
          ctx.lineTo(contentOriginX + cols * cellSize, y);
          ctx.stroke();
        }
        // 垂直实线（solidCols 已含 0 和 cols，覆盖外框）
        for (const c of solidCols) {
          const x = contentOriginX + c * cellSize;
          ctx.beginPath();
          ctx.strokeStyle = lineColorForV(0, rows, Math.round(c));
          ctx.moveTo(x, contentOriginY);
          ctx.lineTo(x, contentOriginY + rows * cellSize);
          ctx.stroke();
        }
        ctx.restore();
      } // end boardRulerEnabled (solid + outer frame)

      // axis labels with virtual coordinates
      // 行列坐标统一从 1 开始计数（行/列均从 1），不考虑像素化时的 gridOffset 或裁剪起点。
      // 导出的样图是独立的图纸，应按自身坐标系重新计数，不继承像素化页面的画布偏移。
      const fontSize = Math.max(10, Math.floor(cellSize * 0.45));
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (let c = 0; c < cols; c++) {
        const virtualCol = c + 1;
        const text = String(virtualCol);
        const x = contentOriginX + (c * cellSize + cellSize / 2);
        const y = padding + headerH / 2;
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
        ctx.fillStyle = 'rgba(55,65,81,0.95)';
        ctx.fillText(text, x, y);
      }
      ctx.textAlign = 'right';
      for (let r = 0; r < rows; r++) {
        const virtualRow = r + 1;
        const text = String(virtualRow);
        const y = contentOriginY + (r * cellSize + cellSize / 2);
        const metrics = ctx.measureText(text);
        const textW = metrics.width;
        const padX = 6;
        const padY = 4;
        const rectW = textW + padX * 2;
        const rectH = fontSize + padY * 2;
        const rectRight = padding + headerW - 6;
        const rectX = Math.round(rectRight - rectW);
        const rectY = Math.round(y - rectH / 2);
        ctx.fillStyle = 'white';
        ctx.fillRect(rectX, rectY, rectW, rectH);
        ctx.fillStyle = 'rgba(55,65,81,0.95)';
        ctx.fillText(text, rectRight - padX, y);
      }

      // 右侧行号标尺（对称于左侧，方便大图拖到右下角时读行号）
      ctx.textAlign = 'left';
      for (let r = 0; r < rows; r++) {
        const virtualRow = r + 1;
        const text = String(virtualRow);
        const y = contentOriginY + (r * cellSize + cellSize / 2);
        const metrics = ctx.measureText(text);
        const textW = metrics.width;
        const padX = 6;
        const padY = 4;
        const rectW = textW + padX * 2;
        const rectH = fontSize + padY * 2;
        const rectLeft = padding + headerW + topWidth + 6;
        const rectX = Math.round(rectLeft);
        const rectY = Math.round(y - rectH / 2);
        ctx.fillStyle = 'white';
        ctx.fillRect(rectX, rectY, rectW, rectH);
        ctx.fillStyle = 'rgba(55,65,81,0.95)';
        ctx.fillText(text, rectLeft + padX, y);
      }

      // 下侧列号标尺（对称于上侧，方便大图拖到右下角时读列号）
      ctx.textAlign = 'center';
      const bottomRulerY = padding + headerH + topHeight + headerH / 2;
      for (let c = 0; c < cols; c++) {
        const virtualCol = c + 1;
        const text = String(virtualCol);
        const x = contentOriginX + (c * cellSize + cellSize / 2);
        const metrics = ctx.measureText(text);
        const textW = metrics.width;
        const padX = 6;
        const padY = 4;
        const rectW = textW + padX * 2;
        const rectH = fontSize + padY * 2;
        const rectX = Math.round(x - rectW / 2);
        const rectY = Math.round(bottomRulerY - rectH / 2);
        ctx.fillStyle = 'white';
        ctx.fillRect(rectX, rectY, rectW, rectH);
        ctx.fillStyle = 'rgba(55,65,81,0.95)';
        ctx.fillText(text, x, bottomRulerY);
      }
      // 恢复 textAlign 默认值，避免影响后续绘制
      ctx.textAlign = 'left';

      // draw separator between top and bottom (位于下标尺下方、物料区上方)
      const sepY = padding + headerH + topHeight + headerH + padding / 2;
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(padding, sepY, canvas.width - padding * 2, 2);

      // draw swatches & stats below —— 列网格布局，所有列等宽，上下行严格对齐
      // 微软雅黑粗体，笔画清晰利于 OCR 识别；物料代码与上方图纸保持一致
      ctx.font = `${Math.max(12, Math.floor(cellSize * 0.9))}px "Microsoft YaHei", "微软雅黑", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#111827';
      // 物料区域整体水平居中：让最后一行的右侧空白均匀分布
      const gridStartX = padding + headerW;
      const gridTotalW = colWidth * numCols;
      // 居中偏移（≥ 0），让网格在可用区域内居中
      const centerOffsetX = Math.max(0, Math.floor((availableWidth - gridTotalW) / 2));
      const textHeight = Math.max(16, swatchSize * 0.8);
      // 物料区起点 = 顶部padding + 上列标尺headerH + 内容topHeight + 下列标尺headerH + 分隔padding + gap
      const startY = padding + headerH + topHeight + headerH + padding + gap;

      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const text = texts[i];
        const measured = ctx.measureText(text);
        // 每个格子内文字最大可用宽度：colWidth 减去左右内边距
        const cellInnerW = Math.max(0, colWidth - gap * 2);
        // 限制文字宽度防止溢出（理论上 measured.width ≤ maxBlockW - 2*gap ≤ cellInnerW，这里只是兜底）
        const textW = Math.min(measured.width, cellInnerW);

        // 该 item 在网格中的行列号
        const rowIdx = Math.floor(i / numCols);
        const colIdx = i % numCols;
        // 该列左上角 x 坐标
        const cellX = gridStartX + centerOffsetX + colIdx * colWidth;
        const cellY = startY + rowIdx * lineHeight;
        // 色块和文字共同的垂直中心 = 整行（lineHeight）的中心
        // 旧版用 textHeight/2 偏移，当 lineHeight > textHeight 时会让色块挤在行顶部，视觉不居中
        const centerY = cellY + lineHeight / 2;
        // 色块上下范围（围绕 centerY 对称）
        const bgY = centerY - textHeight / 2;
        // 文字绘制 y：textBaseline='middle' 对中文字体会略偏上（em-box 中心 ≠ 视觉中心）
        // 加一个小修正（约字体大小的 12%）让文字视觉与色块中心对齐
        const fontPx = Math.max(12, Math.floor(cellSize * 0.9));
        const textY = centerY + fontPx * 0.12;
        // 文字绘制 x：在格子内左对齐，留 gap 内边距
        const textX = cellX + gap;

        // draw colored rounded background for text
        const bgPadding = 6;
        const bgX = textX - bgPadding;
        // 背景宽度也限制在格子内，防止超出列右边界
        const bgW = Math.min(textW + bgPadding * 2, colWidth - gap);
        const bgH = textHeight;
        const radius = Math.max(4, Math.min(12, Math.floor(bgH / 4)));

        // rounded rect path
        ctx.beginPath();
        const r = Math.min(radius, bgH / 2, bgW / 2);
        ctx.moveTo(bgX + r, bgY);
        ctx.arcTo(bgX + bgW, bgY, bgX + bgW, bgY + bgH, r);
        ctx.arcTo(bgX + bgW, bgY + bgH, bgX, bgY + bgH, r);
        ctx.arcTo(bgX, bgY + bgH, bgX, bgY, r);
        ctx.arcTo(bgX, bgY, bgX + bgW, bgY, r);
        ctx.closePath();

        ctx.save();
        ctx.fillStyle = item.hex || '#ffffff';
        ctx.fill();
        // add subtle border to text background
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // draw text with appropriate color for contrast
        const textColor = getTextColor(item.hex || '#ffffff');
        ctx.fillStyle = textColor;
        ctx.textAlign = 'left';
        ctx.fillText(text, textX, textY);
      }

      // export blob with chosen format/quality
      return await new Promise<Blob | null>((resolve) => {
        if (format === 'jpeg') {
          // ensure quality in [0.1, 1]
          const q = Math.max(0.1, Math.min(1, quality || 0.85));
          canvas.toBlob((b) => resolve(b), 'image/jpeg', q);
        } else {
          canvas.toBlob((b) => resolve(b), 'image/png');
        }
      });
    } catch (err) {
      console.error('生成样图出错', err);
      return null;
    }
  };

  // 仅导出图纸为本地文件（不创建档案记录、不上传）
  // 使用场景：分享给外部、或单独生成图片去替换已有档案
  // 文件名优先用图纸名称，没填则用时间戳
  const handleExportSample = async () => {
    if (!pixels || pixels.length === 0) {
      alert('请先生成像素化图再导出');
      return;
    }
    // 背板尺寸校验：与保存档案保持一致
    if (boardSize > 0 && (boardSize < contentColsForSave || boardSize < contentRowsForSave)) {
      alert(`背板尺寸 ${boardSize}×${boardSize} 小于图纸内容尺寸 ${contentColsForSave}×${contentRowsForSave}，无法放下。请调大背板尺寸或设为 0 使用自适应裁剪。`);
      return;
    }
    setSavingDrawing(true);
    try {
      const statsToUse = (stats && stats.length > 0) ? stats : computeStatsFromPixels(pixels);
      const effectiveMaxWidth = boardSize > 0 ? Math.max(2400, boardSize * exportMinCellSize) : 2400;
      const blob = await generateSampleImageBlob(pixels, statsToUse, availableMaterials, { format: exportFormat, quality: exportQuality, minCellSize: exportMinCellSize, maxWidth: effectiveMaxWidth, boardSize, marginMode, cellGridLines, boardRulerEnabled, transparentEmpty, mirror: mirrorExport });
      if (!blob) {
        alert('生成图纸失败');
        return;
      }
      const ext = exportFormat === 'png' ? 'png' : 'jpg';
      const baseName = (saveDrawingName && saveDrawingName.trim()) ? saveDrawingName.trim().replace(/[\\/:*?"<>|]/g, '_') : `pixelate_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
      const filename = `${baseName}.${ext}`;
      // 触发浏览器下载图纸图片
      downloadBlob(blob, filename);
      // 勾选「同步保存项目文件」时，额外下载 .pindou 项目文件
      if (syncPindouOnExport && layers && layers.length > 0) {
        try {
          const pjson = JSON.stringify(buildProjectData(), null, 2);
          const pblob = new Blob([pjson], { type: 'application/json' });
          // 稍延迟触发，避免浏览器把两次下载合并/拦截
          setTimeout(() => downloadBlob(pblob, `${baseName}.pindou`), 300);
        } catch (e) {
          console.warn('同步下载项目文件失败', e);
        }
      }
    } catch (err) {
      console.error('导出图纸失败', err);
      alert('导出失败');
    } finally {
      setSavingDrawing(false);
    }
  };

  const handleSaveToDrawings = async () => {
    if (!saveDrawingName || saveDrawingName.trim() === '') {
      alert('请输入图纸名称');
      return;
    }
    if (!pixels || pixels.length === 0) {
      alert('请先生成像素化图再保存');
      return;
    }
    // 背板尺寸校验：必须能放下当前内容
    if (boardSize > 0 && (boardSize < contentColsForSave || boardSize < contentRowsForSave)) {
      alert(`背板尺寸 ${boardSize}×${boardSize} 小于图纸内容尺寸 ${contentColsForSave}×${contentRowsForSave}，无法放下。请调大背板尺寸或设为 0 使用自适应裁剪。`);
      return;
    }
    setSavingDrawing(true);
    try {
      const statsToUse = (stats && stats.length > 0) ? stats : computeStatsFromPixels(pixels);
      // materials with productIds
      const materialsPayload = statsToUse
        .filter((s) => typeof s.productId === 'number' && s.productId !== null)
        .map((s) => ({ product_id: s.productId, quantity: s.count }));

      // description: include hex-only items
      const hexOnly = statsToUse.filter((s) => !s.productId);
      const descriptionLines = [];
      if (hexOnly.length > 0) {
        descriptionLines.push('自动生成颜色清单（无法匹配物料的颜色以 HEX 显示）:');
        hexOnly.forEach((h) => {
          descriptionLines.push(`${h.code} x ${h.count}`);
        });
      }

      // create drawing
      const payload: any = {
        title: saveDrawingName,
        description: descriptionLines.join('\n'),
        status: 'recorded',
        materials: materialsPayload,
      };
      const res = await api.post('/drawings', payload);
      const newDrawing = res.data?.drawing;
      const drawingId = newDrawing?.id;
      if (!drawingId) {
        throw new Error('未能创建图纸');
      }

      // generate sample image and upload as blueprint (use selected export options)
      // pass explicit maxWidth to control exported image total width (recommended 2400)
      // 当用户设置了背板尺寸时传给生成函数；maxWidth 按背板尺寸自适应放大，避免大背板时 cellSize 太小
      const effectiveMaxWidth = boardSize > 0 ? Math.max(2400, boardSize * exportMinCellSize) : 2400;
      const blob = await generateSampleImageBlob(pixels, statsToUse, availableMaterials, { format: exportFormat, quality: exportQuality, minCellSize: exportMinCellSize, maxWidth: effectiveMaxWidth, boardSize, marginMode, cellGridLines, boardRulerEnabled, transparentEmpty, mirror: mirrorExport });
      if (blob) {
        const mime = exportFormat === 'png' ? 'image/png' : 'image/jpeg';
        const ext = exportFormat === 'png' ? 'png' : 'jpg';
        const file = new File([blob], `${drawingId}_sample.${ext}`, { type: mime });
        const form = new FormData();
        form.append('blueprint', file);
        try {
          await api.post(`/drawings/${drawingId}/images`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (err) {
          console.warn('样图上传失败', err);
        }
      }

      // 同步上传 .pindou 项目文件，绑定到刚上传的图纸图片（blueprint）
      // 项目文件按图片存储，需先拿到 blueprint 的 imageId
      if (layers && layers.length > 0) {
        try {
          const detail = await api.get(`/drawings/${drawingId}`);
          const bp = (detail.data?.images || []).find((im: any) => im.image_type === 'blueprint');
          if (bp && bp.id) {
            const pjson = JSON.stringify(buildProjectData(), null, 2);
            const pblob = new Blob([pjson], { type: 'application/json' });
            const pfile = new File([pblob], `${(saveDrawingName.trim().replace(/[\\/:*?"<>|]/g, '_')) || 'pixelate'}.pindou`, { type: 'application/json' });
            const pform = new FormData();
            pform.append('project', pfile);
            await api.post(`/drawings/${drawingId}/images/${bp.id}/project-file`, pform, { headers: { 'Content-Type': 'multipart/form-data' } });
          }
        } catch (err) {
          console.warn('项目文件上传失败', err);
        }
      }

      // persist selected drawing so Drawings page can auto-select it
      try {
        localStorage.setItem('drawings-selectedDrawing', JSON.stringify({ id: drawingId, title: saveDrawingName }));
      } catch (err) { }

      alert('已保存至图纸档案（状态：仅记录）');
      // navigate to drawings page to show created record
      try { window.location.href = '/drawings'; } catch (err) { }
    } catch (err) {
      console.error('保存图纸失败', err);
      alert('保存失败');
    } finally {
      setSavingDrawing(false);
      setShowSaveDialog(false);
      setSaveDrawingName('');
    }
  };

  // 构建 .pindou 项目数据对象（供下载、保存到档案、上传复用）
  const buildProjectData = () => {
    return {
      version: '2.1', // 升级版本号以支持多画笔
      timestamp: Date.now(),
      layers, // 保存图层数据而不是合并后的pixels
      activeLayerId, // 保存当前活动图层ID
      stats,
      config: {
        maxPixels,
        colorCount,
        removeBg,
        showMaterialCodes,
        statsVisible
      },
      edits: {
        deletionMask: Array.from(deletionMask.entries()),
        colorOverrides: Array.from(colorOverrides.entries())
      },
      // 保存画笔设置
      brushes: exportForProject()
    };
  };

  // 触发浏览器下载一个 Blob（filename 由调用方指定）
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleSaveProject = () => {
    if (!layers || layers.length === 0) {
      alert('没有可保存的内容');
      return;
    }
    const json = JSON.stringify(buildProjectData(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `pixel-project-${Date.now()}.pindou`);
  };

  const handleLoadProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);

        // 支持新版本（v2.0+）包含图层数据
        if (data.version && data.version >= '2.0' && data.layers) {
          // 恢复图层数据
          setLayers(data.layers);
          if (data.activeLayerId) {
            setActiveLayerId(data.activeLayerId);
          }
        } else if (data.pixels) {
          // 兼容旧版本（v1.0）只有pixels数据，转换为图层1
          setLayers([{ id: 'layer-1', name: '图层 1', visible: true, locked: false, pixels: data.pixels }]);
          setActiveLayerId('layer-1');
        } else {
          throw new Error('Invalid project file');
        }

        // 恢复配置
        if (data.config) {
          if (typeof data.config.maxPixels === 'number') setMaxPixels(data.config.maxPixels);
          if (typeof data.config.colorCount === 'number') setColorCount(data.config.colorCount);
          if (typeof data.config.removeBg === 'boolean') setRemoveBg(data.config.removeBg);
          if (typeof data.config.showMaterialCodes === 'boolean') setShowMaterialCodes(data.config.showMaterialCodes);
          if (typeof data.config.statsVisible === 'boolean') setStatsVisible(data.config.statsVisible);
        }

        // 恢复画笔设置（v2.1+）
        if (data.brushes && (data.version >= '2.1' || data.brushes.brushes)) {
          loadFromProject(data.brushes.brushes, data.brushes.activeBrushId);
        }

        // 恢复编辑记录
        if (data.edits) {
          if (Array.isArray(data.edits.deletionMask)) {
            setDeletionMask(new Map(data.edits.deletionMask));
          }
          if (Array.isArray(data.edits.colorOverrides)) {
            setColorOverrides(new Map(data.edits.colorOverrides));
          }
        }

        // 重新计算统计数据以确保一致性
        try {
          // 如果是图层数据，需要先合并；如果是旧版本的pixels直接使用
          let pixelsForStats: PixelCell[][];
          if (data.layers) {
            // 合并所有可见图层的像素数据（与第62-89行的逻辑相同）
            if (data.layers.length === 0) {
              pixelsForStats = [];
            } else {
              const base = data.layers[0].pixels;
              const rows = base.length;
              const cols = base[0]?.length || 0;
              if (rows === 0) {
                pixelsForStats = [];
              } else {
                const result: PixelCell[][] = [];
                for (let r = 0; r < rows; r++) {
                  const rowArr: PixelCell[] = [];
                  for (let c = 0; c < cols; c++) rowArr.push({ hex: null, productId: null });
                  result.push(rowArr);
                }
                data.layers.forEach((layer: Layer) => {
                  if (!layer.visible) return;
                  for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                      const p = layer.pixels[r]?.[c];
                      if (p && (p.hex || p.productId !== null && p.productId !== undefined)) {
                        result[r][c] = { ...p };
                      }
                    }
                  }
                });
                pixelsForStats = result;
              }
            }
          } else {
            pixelsForStats = data.pixels;
          }
          const recomputed = computeStatsFromPixels(pixelsForStats);
          setStats(recomputed);
        } catch (e) { }

        // 重置文件信息，因为我们只加载了像素数据，原始文件可能已经不存在
        setLastFileInfo(null);
        setPreviewUrl(null);

        alert('项目加载成功');

      } catch (err) {
        console.error('Load project failed', err);
        alert('项目文件读取失败');
      }
    };
    reader.readAsText(file);
  };

  const handleLayerImport = (importedLayer: Layer) => {
    const baseGrid = layers[0]?.pixels;
    if (!baseGrid) {
      alert('请先创建基础图层');
      return;
    }

    const baseRows = baseGrid.length;
    const baseCols = baseGrid[0]?.length || 0;
    const importedRows = importedLayer.pixels.length;
    const importedCols = importedLayer.pixels[0]?.length || 0;

    // 尺寸不匹配时的处理
    if (importedRows !== baseRows || importedCols !== baseCols) {
      const shouldResize = window.confirm(
        `导入图层尺寸 (${importedRows}x${importedCols}) 与当前画布 (${baseRows}x${baseCols}) 不匹配。\n` +
        `是否自动调整（裁剪/扩展）？`
      );

      if (!shouldResize) return;

      // 调整尺寸
      const adjustedPixels: PixelCell[][] = [];
      for (let r = 0; r < baseRows; r++) {
        const row: PixelCell[] = [];
        for (let c = 0; c < baseCols; c++) {
          if (r < importedRows && c < importedCols) {
            row.push({ ...importedLayer.pixels[r][c] });
          } else {
            row.push({ hex: null, productId: null });
          }
        }
        adjustedPixels.push(row);
      }

      importedLayer.pixels = adjustedPixels;
    }

    // 保存历史记录
    saveToHistory();

    // 确保 ID 唯一
    const newLayer = {
      ...importedLayer,
      id: `layer-${Date.now()}`
    };

    setLayers([...layers, newLayer]);
    setActiveLayerId(newLayer.id);
    alert(`图层 "${newLayer.name}" 导入成功`);
  };

  return (
    <div className="w-full h-screen overflow-hidden bg-gray-50">
      <div className="max-w-full mx-auto px-6 h-full">
        {/* Main canvas area */}
        <div className="mt-2 border rounded relative" style={{ height: 'calc(100vh - 100px)', overflow: 'hidden' }}>
          <div className="absolute inset-0">
            {pixels && pixels.length > 0 ? (
              <div className="w-full h-full">
                <div
                  className="w-full h-full border rounded overflow-hidden"
                  style={{ height: '100%' }}
                  onWheel={(e) => { e.preventDefault(); }}
                >
                  <PixelGrid
                    pixels={displayedPixels}
                    cellSize={18}
                    gap={0}
                    highlightedProductId={highlightedProductId}
                    onCellClick={(c, row, col) => {
                      if (currentTool === 'hand') {
                        if (typeof c.productId === 'number') {
                          setHighlightedProductId(c.productId);
                        } else {
                          // fallback: try match by hex color to find a productId in current stats
                          const hex = c.hex ? c.hex.toLowerCase() : null;
                          const matched = hex ? stats.find(s => s.hex && s.hex.toLowerCase() === hex) : undefined;
                          setHighlightedProductId(matched?.productId ?? null);
                        }
                      } else if (currentTool === 'paste' && clipboard) {
                        // 粘贴工具：在点击位置粘贴剪贴板内容
                        if (typeof row === 'number' && typeof col === 'number') {
                          handlePaste(row, col);
                        }
                      }
                    }}
                    onBackgroundClick={() => {
                      if (currentTool === 'hand') {
                        setHighlightedProductId(null);
                      }
                    }}
                    currentTool={currentTool}
                    selectionState={selectionState}
                    onSelectionChange={setSelectionState}
                    materials={availableMaterials}
                    showMaterialCodes={showMaterialCodes}
                    darkBackground={darkBackground}
                    brushSettings={activeBrush}
                    onBrushDraw={handleBrushDraw}
                    onBrushErase={handleBrushErase}
                    onBrushEnd={handleBrushEnd}
                    gridOffset={gridOffset}
                    onCellSelect={(r, c, mode) => {
                      const key = `${r},${c}`;
                      const newSet = new Set(selectionState.selectedCells);

                      if (mode === 'color') {
                        // Select all cells with the same color/product as the clicked cell
                        // r, c 是数组索引，选区 key 需要用虚拟坐标
                        const targetCell = pixels[r]?.[c];
                        if (targetCell) {
                          const targetHex = targetCell.hex;
                          const targetPid = targetCell.productId;

                          pixels.forEach((row, rowIndex) => {
                            row.forEach((cell, colIndex) => {
                              if (cell.hex === null && cell.productId === null) return;

                              let match = false;
                              if (targetPid !== undefined && targetPid !== null) {
                                if (cell.productId === targetPid) match = true;
                              } else if (targetHex) {
                                if (cell.hex === targetHex) match = true;
                              }

                              if (match) {
                                // 数组索引转虚拟坐标
                                const vr = rowIndex + gridOffset.row;
                                const vc = colIndex + gridOffset.col;
                                newSet.add(`${vr},${vc}`);
                              }
                            });
                          });
                        }
                        setSelectionState({ selectedCells: newSet, isSelecting: false });
                      } else if (mode === 'add') {
                        newSet.add(key);
                        setSelectionState({ selectedCells: newSet, isSelecting: true });
                      } else if (mode === 'remove') {
                        newSet.delete(key);
                        setSelectionState({ selectedCells: newSet, isSelecting: true });
                      } else if (mode === 'toggle') {
                        if (newSet.has(key)) newSet.delete(key);
                        else newSet.add(key);
                        setSelectionState({ selectedCells: newSet, isSelecting: true });
                      }
                      // For 'rect' and 'flood', logic is typically handled inside PixelGrid or complex handlers
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">请上传图片以生成像素化预览</div>
            )}
          </div>
        </div>

        {/* Floating draggable control panel (collapsible) */}
        {panelCollapsed ? (
          <div
            className="fixed z-50"
            style={{ left: panelPos.x, top: panelPos.y }}
          >
            <div
              className="w-12 h-12 flex items-center justify-center bg-white/90 backdrop-blur-sm shadow-lg rounded-full cursor-pointer transition-all duration-200 hover:scale-105"
              onPointerDown={onPanelPointerDown}
              onPointerMove={onPanelPointerMove}
              onPointerUp={(e) => { onPanelPointerUp(e); if (!(panelDrag.current && panelDrag.current.moved)) setPanelCollapsed(false); }}
              aria-label="还原控制面板"
            >
              <svg className="w-6 h-6 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </div>
          </div>
        ) : (
          <div
            className="bg-white/95 backdrop-blur-sm shadow-xl rounded-lg border border-gray-200 z-50 transition-all duration-200 hover:shadow-2xl"
            style={{ position: 'fixed', left: panelPos.x, top: panelPos.y, width: 260 }}
          >
            {/* 折叠按钮 */}
            <button
              className="absolute -right-3 -top-3 w-8 h-8 bg-white border border-gray-300 rounded-full shadow-md flex items-center justify-center text-gray-600 hover:text-gray-800 hover:bg-gray-50 transition-all duration-200 z-10"
              onClick={() => setPanelCollapsed(true)}
              title="最小化"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            {/* 标题栏 */}
            <div className="p-4 pb-2">
              <div
                className="flex items-center cursor-move select-none"
                onPointerDown={onPanelPointerDown}
                onPointerMove={onPanelPointerMove}
                onPointerUp={onPanelPointerUp}
              >
                <h3 className="text-lg font-semibold text-gray-800">控制面板</h3>
              </div>
            </div>

            {/* 内容区域 */}
            <div className="px-4 pb-4">
            <div className="space-y-3">
              {/* 上传和刷新按钮行 */}
              <div className="flex items-center space-x-1">
                <input type="file" accept="image/*" id="pixelate-file-panel" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) handleUpload(f); }} />
                <label htmlFor="pixelate-file-panel" className="p-2 bg-indigo-600 text-white rounded cursor-pointer" title="上传图片">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                </label>
                <button
                  className="p-2 bg-gray-100 rounded"
                  onClick={handleRefresh}
                  title="刷新"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>

              {/* 分辨率和颜色数量 - 同一行 */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div className="flex items-center justify-end space-x-1">
                  <label className="text-xs text-gray-600 whitespace-nowrap">分辨率</label>
                  <input
                    type="number"
                    value={maxPixels}
                    onChange={(e) => {
                      const parsed = parseInt(e.target.value || '', 10);
                      const safe = Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
                      setMaxPixels(safe);
                    }}
                    className="w-14 border rounded p-1 text-sm text-center"
                  />
                </div>
                <div className="flex items-center justify-end space-x-1">
                  <label className="text-xs text-gray-600 whitespace-nowrap">颜色数</label>
                  <input
                    type="number"
                    value={colorCount}
                    onChange={(e) => setColorCount(Math.max(2, Math.min(256, parseInt(e.target.value || '16'))))}
                    className="w-14 border rounded p-1 text-sm text-center"
                  />
                </div>
              </div>

              {/* 编辑映射按钮 */}
              <button
                className="w-full py-1.5 text-xs rounded bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => setMappingEditorVisible(true)}
                disabled={stats.length === 0}
              >
                🎨 编辑颜色映射
              </button>

              {/* 选项复选框 */}
              <div className="flex flex-col space-y-1">
                <label className="inline-flex items-center">
                  <input type="checkbox" checked={showOriginalPreview} onChange={(e) => setShowOriginalPreview(e.target.checked)} className="mr-2" />
                  <span className="text-xs">显示原图预览</span>
                </label>
                <label className="inline-flex items-center">
                  <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} className="mr-2" />
                  <span className="text-xs">抠图（移除背景）</span>
                </label>
                <label className="inline-flex items-center">
                  <input type="checkbox" checked={darkBackground} onChange={(e) => setDarkBackground(e.target.checked)} className="mr-2" />
                  <span className="text-xs">深色背景</span>
                </label>
                <label className="inline-flex items-center">
                  <input type="checkbox" checked={showMaterialCodes} onChange={(e) => setShowMaterialCodes(e.target.checked)} className="mr-2" />
                  <span className="text-xs">显示物料代码</span>
                </label>
                <label className="inline-flex items-center">
                  <input type="checkbox" checked={statsVisible} onChange={(e) => setStatsVisible(e.target.checked)} className="mr-2" />
                  <span className="text-xs">显示颜色统计</span>
                </label>
                <label className="inline-flex items-center">
                  <input type="checkbox" checked={layerPanelVisible} onChange={(e) => setLayerPanelVisible(e.target.checked)} className="mr-2" />
                  <span className="text-xs">显示图层面板</span>
                </label>
              </div>

              {/* 操作按钮行 - 使用图标 */}
              <div className="flex items-center justify-between space-x-1 border-t pt-2">
                <button
                  className="p-2 bg-gray-100 rounded disabled:opacity-50"
                  onClick={performUndo}
                  disabled={undoStack.length === 0}
                  title="撤销"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                </button>
                <button
                  className="p-2 bg-gray-100 rounded disabled:opacity-50"
                  onClick={performRedo}
                  disabled={redoStack.length === 0}
                  title="还原"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" /></svg>
                </button>
                <button
                  className="w-8 h-8 flex items-center justify-center bg-emerald-600 text-white rounded text-[10px] font-bold"
                  onClick={exportPixelPng}
                  title="导出像素图（PNG透明）"
                >
                  PNG
                </button>
                <button
                  className="p-2 bg-indigo-600 text-white rounded"
                  onClick={() => setShowSaveDialog(true)}
                  title="生成图纸（导出 / 保存至档案）"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                </button>
                <button
                  className="p-2 bg-red-500 text-white rounded"
                  onClick={() => {
                    saveToHistory();
                    const defaultPixels = Array.from({ length: 104 }, () =>
                      Array.from({ length: 104 }, () => ({ hex: null, productId: null }))
                    );
                    setPixels(defaultPixels);
                    setStats([]);
                    setPreviewUrl(null);
                    setLastFileInfo(null);
                    setLastPixelateParams(null);
                    setDeletionMask(new Map());
                    setColorOverrides(new Map());
                    setLayers([{ id: 'layer-1', name: '图层 1', visible: true, locked: false, pixels: defaultPixels }]);
                    setActiveLayerId('layer-1');
                  }}
                  title="清除"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>

              {loading && <div className="text-xs text-gray-500">处理中...</div>}

              {/* Local File Save / Load */}
              <div className="pt-2 border-t mt-2">
                <input
                  type="file"
                  accept=".pindou,.json"
                  id="pixelate-load-project"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    if (f) handleLoadProject(f);
                    // clear input so same file can be loaded again if needed
                    e.target.value = '';
                  }}
                />
                <div className="flex space-x-2">
                  <button className="flex-1 px-3 py-1 bg-green-600 text-white rounded text-sm" onClick={() => handleSaveProject()}>
                    保存项目
                  </button>
                  <label htmlFor="pixelate-load-project" className="flex-1 px-3 py-1 bg-blue-600 text-white rounded text-sm text-center cursor-pointer">
                    读取项目
                  </label>
                </div>
              </div>
            </div>
            </div>
          </div>
        )}

        {/* original preview floating area (toggleable & draggable) */}
        {showOriginalPreview && previewUrl && (
          <div
            style={{ position: 'fixed', left: previewPos.left, top: previewPos.top, width: 180 }}
            className="bg-white border rounded shadow p-2 z-40 hover:scale-105 transition-transform"
            onPointerDown={onPreviewPointerDown}
            onPointerMove={onPreviewPointerMove}
            onPointerUp={onPreviewPointerUp}
          >
            <div className="text-sm text-gray-600 mb-2">原图预览</div>
            <img src={previewUrl} alt="preview" className="w-full h-auto object-contain rounded" />
          </div>
        )}

        {/* Paste preview floating area (shows when clipboard has content) */}
        {clipboard && currentTool === 'paste' && (
          <div
            style={{ position: 'fixed', left: pastePreviewPos.left, top: pastePreviewPos.top, width: 150 }}
            className="bg-white border border-gray-300 rounded shadow-lg p-2 z-50 hover:scale-105 transition-transform"
            onPointerDown={onPastePreviewPointerDown}
            onPointerMove={onPastePreviewPointerMove}
            onPointerUp={onPastePreviewPointerUp}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-600">粘贴预览</div>
              <div className="text-xs text-gray-400">{clipboard.width}×{clipboard.height}</div>
            </div>
            {/* Render small preview grid */}
            <div
              className="border rounded bg-white overflow-hidden"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${clipboard.width}, 1fr)`,
                gap: 0,
                aspectRatio: `${clipboard.width} / ${clipboard.height}`,
                maxHeight: 100
              }}
            >
              {Array.from({ length: clipboard.height }, (_, row) =>
                Array.from({ length: clipboard.width }, (_, col) => {
                  const key = `${row},${col}`;
                  const cell = clipboard.pixels.get(key);
                  return (
                    <div
                      key={key}
                      style={{
                        backgroundColor: cell?.hex || 'transparent',
                        minHeight: 4
                      }}
                    />
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* stats panel reuse (it renders fixed right panel) */}
        <StatsPanel visible={statsVisible} stats={stats} totalCells={stats.reduce((s, it) => s + (it.count || 0), 0)} onClose={() => setStatsVisible(false)} onSelectMaterial={(pid) => setHighlightedProductId((prev) => (prev === pid ? null : (pid ?? null)))} draggable initialPos={{ left: window.innerWidth - 320 - 20, top: 80 }} highlightedProductId={highlightedProductId} />

        {/* 映射关系编辑弹窗 */}
        <MappingEditorModal
          visible={mappingEditorVisible}
          entries={stats.map((s: any) => ({ productId: s.productId, code: s.code, hex: s.hex || '#CCCCCC', count: s.count }))}
          availableMaterials={availableMaterials}
          onClose={() => setMappingEditorVisible(false)}
          onApply={handleApplyMapping}
        />

        {/* Pixel Toolbar */}
        <PixelToolbar
          position={toolbarPos}
          collapsed={toolbarCollapsed}
          onPositionChange={setToolbarPos}
          onCollapsedChange={setToolbarCollapsed}
          currentTool={currentTool}
          onToolChange={setCurrentTool}
          selectionState={selectionState}
          onClearSelection={handleClearSelection}
          onFillSelection={handleFillSelection}
          onDeleteSelection={handleDeleteSelection}
          onCopySelection={handleCopySelection}
          hasClipboard={clipboard !== null}
          brushes={brushes}
          activeBrushId={activeBrushId}
          activeBrush={activeBrush}
          onBrushSelect={setActiveBrushId}
          onBrushUpdate={updateBrush}
          onOpenBrushColorPicker={handleOpenBrushColorPicker}
          availableMaterials={availableMaterials}
        />
        {/* Fill picker modal */}
        <MaterialPickerModal
          visible={showFillPicker}
          initialPos={{ left: toolbarPos.x, top: toolbarPos.y - 240 }}
          availableMaterials={availableMaterials}
          onClose={() => { setShowFillPicker(false); setPreviewFillColor(null); setPreviewFillProductId(null); }}
          onSelectPreview={(pid, hex) => { setPreviewFillColor(hex); setPreviewFillProductId(pid); }}
          onConfirm={(pid, hex) => {
            // apply final fill and close
            setShowFillPicker(false);
            setPreviewFillColor(null);
            setPreviewFillProductId(null);
            handleFillSelection(hex, pid);
          }}
        />

        {/* Brush color picker modal */}
        <MaterialPickerModal
          visible={showBrushColorPicker}
          initialPos={{ left: toolbarPos.x, top: toolbarPos.y - 240 }}
          availableMaterials={availableMaterials}
          onClose={() => { setShowBrushColorPicker(false); setBrushPreviewColor(null); setBrushPreviewProductId(null); }}
          onSelectPreview={(pid, hex) => { setBrushPreviewColor(hex); setBrushPreviewProductId(pid); }}
          onConfirm={(pid, hex) => {
            handleConfirmBrushColor(pid, hex);
          }}
        />


        {/* Layer Panel */}
        <LayerPanel
          visible={layerPanelVisible}
          position={layerPanelPos}
          onPositionChange={setLayerPanelPos}
          layers={layers}
          activeLayerId={activeLayerId}
          onClose={() => setLayerPanelVisible(false)}
          onActiveLayerChange={setActiveLayerId}
          onLayerChange={(newVal) => {
            // Handle special 'ADD_NEW' signal from child (quick hack to avoid changing prop type)
            if (newVal === 'ADD_NEW' as any) {
              saveToHistory();
              const idx = layers.length + 1;
              const currentGrid = layers[0].pixels; // grab dimensions from base
              const rows = currentGrid.length;
              const cols = currentGrid[0]?.length || 0;
              // Create empty grid
              const emptyGrid: PixelCell[][] = [];
              for (let r = 0; r < rows; r++) {
                const row: PixelCell[] = [];
                for (let c = 0; c < cols; c++) row.push({ hex: null, productId: null });
                emptyGrid.push(row);
              }
              const newLayer = {
                id: `layer-${Date.now()}`,
                name: `图层 ${idx}`,
                visible: true,
                locked: false,
                pixels: emptyGrid
              };
              setLayers([...layers, newLayer]);
              setActiveLayerId(newLayer.id);
            } else {
              // Check if layers are being deleted (length decreased)
              if (newVal.length < layers.length) {
                saveToHistory();
              }
              setLayers(newVal);
            }
          }}
          onLayerImport={handleLayerImport}
        />

        {/* Save / Export Drawing Dialog */}
        {showSaveDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-medium">生成图纸</h3>
                <button className="text-gray-500" onClick={() => setShowSaveDialog(false)}>关闭</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm">图纸名称（仅"保存至档案"需要填写）<HelpTip text="导出到本地时会作为文件名；留空则用时间戳命名。" /></label>
                  <input value={saveDrawingName} onChange={(e) => setSaveDrawingName(e.target.value)} className="mt-1 w-full border rounded p-2" placeholder="例如：卡通人物-草莓熊" />
                </div>
                <div>
                  <label className="block text-sm">背板尺寸（边长格数，0 = 自适应裁剪不使用背板）<HelpTip text={`填写后图纸将按 ${boardSize || '—'}×${boardSize || '—'} 背板居中放置，行列坐标从 1 开始计数。当前内容尺寸约 ${contentColsForSave}×${contentRowsForSave}（自动裁剪 + 1 格边距）。`} /></label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={boardSize}
                      onChange={(e) => {
                        const v = parseInt(e.target.value || '0', 10);
                        setBoardSize(Number.isFinite(v) ? Math.max(0, v) : 0);
                      }}
                      className="w-24 border rounded p-2"
                    />
                    <span className="text-xs text-gray-500">常用：</span>
                    {[52, 78, 104].map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`px-2 py-1 text-xs rounded border ${boardSize === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                        onClick={() => setBoardSize(s)}
                      >
                        {s}×{s}
                      </button>
                    ))}
                  </div>
                  {boardSize > 0 && (boardSize < contentColsForSave || boardSize < contentRowsForSave) && (
                    <div className="text-xs text-red-600 mt-1 font-medium">
                      ⚠ 背板尺寸小于图纸内容尺寸（{contentColsForSave}×{contentRowsForSave}），无法放下，请调大背板尺寸或设为 0 使用自适应裁剪。
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm">导出格式</label>
                    <select value={exportFormat} onChange={(e) => setExportFormat((e.target.value as any) || 'jpeg')} className="mt-1 block w-full border rounded p-2">
                      <option value="jpeg">JPG（压缩）</option>
                      <option value="png">PNG（无损）</option>
                    </select>
                  </div>
                <div>
                  <label className="block text-sm">JPG质量（0.5-1.0）</label>
                  <input type="number" step="0.05" min={0.5} max={1} value={exportQuality} onChange={(e) => setExportQuality(Math.max(0.5, Math.min(1, parseFloat(e.target.value || '0.85'))))} className="mt-1 block w-full border rounded p-2" />
                </div>
              </div>
              {/* 镜像 + 边距模式 */}
              <div className="flex items-center gap-4 flex-wrap">
                <label className={`flex items-center gap-2 px-3 py-1 border rounded cursor-pointer ${mirrorExport ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}>
                  <input
                    type="checkbox"
                    checked={mirrorExport}
                    onChange={(e) => setMirrorExport(e.target.checked)}
                    className="accent-indigo-600"
                  />
                  <span className="text-sm">水平镜像</span>
                  <HelpTip text="勾选后导出的图纸左右翻转像素内容（适合需要镜像复用的对称图案）。坐标标尺、网格框架不翻转。" />
                </label>
                <label className={`flex items-center gap-2 px-3 py-1 border rounded cursor-pointer ${syncPindouOnExport ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}>
                  <input
                    type="checkbox"
                    checked={syncPindouOnExport}
                    onChange={(e) => setSyncPindouOnExport(e.target.checked)}
                    className="accent-indigo-600"
                  />
                  <span className="text-sm">同步保存项目文件</span>
                  <HelpTip text="仅对「仅导出到本地」生效：导出图纸图片的同时，额外下载一份 .pindou 项目文件，可在像素化模块重新加载继续编辑。「保存至档案」始终会一并上传项目文件。" />
                </label>
              </div>
              {/* 边距模式：仅自适应模式生效，背板模式下内容由背板尺寸+居中决定 */}
              <div className={boardSize > 0 ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-sm">边距模式（仅自适应模式生效）<HelpTip text="留边模式下内容四周各空 1 格；无边模式下内容直接贴画布边缘。" /></label>
                <div className="flex items-center gap-4 mt-1">
                  <label className={`flex items-center gap-2 px-3 py-1 border rounded cursor-pointer ${marginMode === 'margin' ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}>
                    <input
                      type="radio"
                      name="marginMode"
                      checked={marginMode === 'margin'}
                      onChange={() => setMarginMode('margin')}
                      className="accent-indigo-600"
                    />
                    <span className="text-sm">留 1 格边</span>
                  </label>
                  <label className={`flex items-center gap-2 px-3 py-1 border rounded cursor-pointer ${marginMode === 'none' ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}>
                    <input
                      type="radio"
                      name="marginMode"
                      checked={marginMode === 'none'}
                      onChange={() => setMarginMode('none')}
                      className="accent-indigo-600"
                    />
                    <span className="text-sm">无边（贴边）</span>
                  </label>
                </div>
              </div>
                {/* 格子线 / 背板线开关 */}
                <div>
                  <label className="block text-sm">网格线<HelpTip text="两者可独立开关；都关闭则只输出纯像素色块。标尺线统一使用全黑，在彩色像素上对比度最高。" /></label>
                  <div className="flex flex-col gap-1 mt-1">
                    <label className={`flex items-center gap-2 px-3 py-1 border rounded cursor-pointer ${cellGridLines ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}>
                      <input
                        type="checkbox"
                        checked={cellGridLines}
                        onChange={(e) => setCellGridLines(e.target.checked)}
                        className="accent-indigo-600"
                      />
                      <span className="text-sm">每格细线（淡，方便数格子）</span>
                    </label>
                    <label className={`flex items-center gap-2 px-3 py-1 border rounded cursor-pointer ${boardRulerEnabled ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}>
                      <input
                        type="checkbox"
                        checked={boardRulerEnabled}
                        onChange={(e) => setBoardRulerEnabled(e.target.checked)}
                        className="accent-indigo-600"
                      />
                      <span className="text-sm">背板标尺线（每 10 格粗实线 + 每 5 格粗虚线）</span>
                    </label>
                  </div>
                </div>
                {/* 空白格棋盘格开关 */}
                <div>
                  <label className="block text-sm">空白格样式<HelpTip text="开启棋盘格后没有物料的格子用灰白棋盘格表示，类似 Photoshop 的透明背景效果，方便区分空白区域。" /></label>
                  <div className="flex flex-col gap-1 mt-1">
                    <label className={`flex items-center gap-2 px-3 py-1 border rounded cursor-pointer ${!transparentEmpty ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}>
                      <input
                        type="radio"
                        name="transparentEmpty"
                        checked={!transparentEmpty}
                        onChange={() => setTransparentEmpty(false)}
                        className="accent-indigo-600"
                      />
                      <span className="text-sm">纯色背景（默认浅灰）</span>
                    </label>
                    <label className={`flex items-center gap-2 px-3 py-1 border rounded cursor-pointer ${transparentEmpty ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}>
                      <input
                        type="radio"
                        name="transparentEmpty"
                        checked={transparentEmpty}
                        onChange={() => setTransparentEmpty(true)}
                        className="accent-indigo-600"
                      />
                      <span className="text-sm">棋盘格（PS 透明效果，灰白交替）</span>
                    </label>
                  </div>
                </div>
                <div className="text-sm text-gray-500">提示：为保证清晰度，导出时每格像素最小为 <strong>{exportMinCellSize}px</strong>，如果需要可在设置中调整。</div>
                <div className="text-xs text-gray-500 leading-relaxed border-l-2 border-gray-200 pl-2">
                  <div><strong className="text-gray-700">仅导出到本地</strong>：只生成图纸图片并下载，不创建档案记录。适合分享到外部或替换已有档案。</div>
                  <div className="mt-1"><strong className="text-gray-700">保存至档案</strong>：自动生成 BOM 清单，创建"仅记录"状态图纸，同时上传样图。</div>
                </div>
                <div className="flex items-center justify-end space-x-3 pt-1">
                  <button className="px-3 py-2 bg-gray-200 rounded" onClick={() => setShowSaveDialog(false)}>取消</button>
                  <button
                    className="px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    onClick={handleExportSample}
                    disabled={savingDrawing || boardSizeInvalid}
                    title="只下载图纸图片，不保存到档案"
                  >
                    {savingDrawing ? '生成中...' : '仅导出到本地'}
                  </button>
                  <button
                    className="px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    onClick={handleSaveToDrawings}
                    disabled={savingDrawing || boardSizeInvalid || !saveDrawingName.trim()}
                    title={!saveDrawingName.trim() ? '请先填写图纸名称' : '创建图纸档案并上传样图'}
                  >
                    {savingDrawing ? '保存中...' : '保存至档案'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PixelatePage;

/** 问号图标 + 鼠标悬停显示说明文字（替代原先常驻的注释行，节省纵向空间） */
const HelpTip: React.FC<{ text: string }> = ({ text }) => (
  <span className="relative inline-flex group align-middle ml-1">
    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-300 text-white text-[9px] font-bold cursor-help select-none">
      ?
    </span>
    <span className="hidden group-hover:block absolute left-1/2 bottom-full z-50 mb-1 -translate-x-1/2 w-max max-w-xs px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg leading-relaxed">
      {text}
    </span>
  </span>
);


