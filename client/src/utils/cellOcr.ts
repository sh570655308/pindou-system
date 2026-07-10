// 逐格 OCR：把图纸四角拉正成网格，逐格提取为图片，批量发到后端 /api/ocr/cells 识别。
//
// OCR 推理在后端 Node 跑 PaddleOCR V4 英文模型（onnxruntime-node 原生，快且准），
// 前端只负责透视拉正、分割格子、转 base64 发送，不加载任何模型/WASM。
//
// 物料代码格式：单字母 + 2位数字（如 D22、E01、C6→C06）。

import { warpImageToCanvas, type Point4 } from './perspective';

export interface CellOcrResult {
  /** rows × cols 的原始识别文本 */
  rawGrid: string[][];
  /** 后处理后的物料代码网格（无效格为 ""） */
  codeGrid: string[][];
  /** 物料代码 → 出现次数（不含空/无效格） */
  stats: Array<{ code: string; count: number }>;
  /** 总物料格数 */
  totalCells: number;
  /** 有效识别格数 */
  recognizedCells: number;
}

export interface CellOcrProgress {
  done: number;
  total: number;
  /** 当前正在识别的格子坐标（物料区，0-based） */
  current?: { row: number; col: number };
}

/** 每格在拉正画布上的像素（拉正后单格大小）。识别时再放大 3 倍发后端 */
export const CELL_WARP_PX = 64;
/** 发后端识别时每格放大的倍数（PaddleOCR 对放大后的图识别更准） */
export const RECOG_SCALE = 3;

/** 物料代码格式：单字母 + 2位数字（如 D22、E01、C6→C06） */
export const CODE_REGEX = /^[A-Z]\d{2}$/;

/**
 * 后处理单格 OCR 文本，规范化为 物料代码（单字母+2位数字）。
 * 后端已做过一次规范化，这里再兜底（用户手动修正时也会用到）。
 */
export function normalizeCode(raw: string): string {
  const r = normalizeCodeLenient(raw);
  return CODE_REGEX.test(r) ? r : '';
}

export function normalizeCodeLenient(raw: string): string {
  let s = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  const letterToDigit: Record<string, string> = { O: '0', S: '5', I: '1', B: '8', Z: '2', G: '6' };
  const digitToLetter: Record<string, string> = { '0': 'D', '5': 'S', '1': 'I', '8': 'B', '2': 'Z', '6': 'G' };
  const tryExtract = (str: string): string => {
    const m = str.match(/([A-Z]+)(\d+)/);
    if (!m) return '';
    let letters = m[1];
    let digits = m[2];
    if (letters.length > 1) letters = letters.slice(-1);
    digits = digits.replace(/[OSIBZG]/g, (ch) => letterToDigit[ch] ?? ch);
    return letters + digits;
  };
  let best = tryExtract(s);
  if (best) return padDigits(best);
  if (/^\d/.test(s) && digitToLetter[s[0]]) {
    best = tryExtract(digitToLetter[s[0]] + s.slice(1));
    if (best) return padDigits(best);
  }
  return '';
}

function padDigits(code: string): string {
  const m = code.match(/^([A-Z]+)(\d+)$/);
  if (!m) return code;
  let letters = m[1];
  if (letters.length > 1) letters = letters.slice(-1);
  let digits = m[2];
  if (digits.length === 1) digits = '0' + digits;
  else if (digits.length > 2) digits = digits.slice(0, 2);
  return letters + digits;
}

/** 从拉正大画布截取单格区域，放大后转 dataURL（base64 PNG） */
function extractCellDataUrl(
  src: HTMLCanvasElement,
  cellX: number,
  cellY: number,
  cellPx: number,
  scale: number
): string {
  const outPx = cellPx * scale;
  const canvas = document.createElement('canvas');
  canvas.width = outPx;
  canvas.height = outPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, cellX, cellY, cellPx, cellPx, 0, 0, outPx, outPx);
  return canvas.toDataURL('image/png');
}

/**
 * 主入口：识别整张图纸网格。
 *
 * @param img       源图片
 * @param corners   物料区四角（左上、右上、右下、左下，自然像素坐标）
 * @param cols      物料区横向格子数（=框选区域内列数）
 * @param rows      物料区竖向格子数（=框选区域内行数）
 * @param onProgress 进度回调
 */
export async function recognizeGrid(
  img: HTMLImageElement,
  corners: Point4,
  cols: number,
  rows: number,
  onProgress?: (p: CellOcrProgress) => void,
  /** 取消检查：每批发送前调用，返回 true 则立即停止并 reject */
  shouldCancel?: () => boolean
): Promise<CellOcrResult> {
  // 1. 透视拉正成大画布（cols×rows 格，每格 CELL_WARP_PX）
  const warped = warpImageToCanvas(img, corners, cols, rows, CELL_WARP_PX, 6);

  // 2. 提取每格 dataURL，构建任务列表
  interface CellItem { row: number; col: number; dataUrl: string; }
  const cells: CellItem[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dataUrl = extractCellDataUrl(warped, c * CELL_WARP_PX, r * CELL_WARP_PX, CELL_WARP_PX, RECOG_SCALE);
      if (dataUrl) cells.push({ row: r, col: c, dataUrl });
    }
  }
  const totalCells = cells.length;

  // 3. 分批发送到后端 /api/ocr/cells，每批返回后更新进度
  const rawGrid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(''));
  const codeGrid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(''));
  let done = 0;

  const token = localStorage.getItem('token') || '';
  const BATCH = 30; // 每批格子数，控制单次请求体积 + 提供进度反馈粒度

  for (let i = 0; i < cells.length; i += BATCH) {
    // 取消检查：发请求前检查，避免取消后仍在跑剩余批次
    if (shouldCancel && shouldCancel()) {
      throw new Error('CANCELLED');
    }
    const batch = cells.slice(i, i + BATCH);
    let resp: Response;
    try {
      resp = await fetch('/api/ocr/cells', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ cells: batch }),
      });
    } catch (e) {
      throw new Error('无法连接后端 OCR 服务: ' + (e as Error).message);
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error('后端 OCR 失败: ' + resp.status + ' ' + errText.slice(0, 200));
    }
    const data = await resp.json();
    const results: Array<{ row: number; col: number; text: string; code: string }> = data.results || [];
    for (const r of results) {
      if (r.row >= 0 && r.row < rows && r.col >= 0 && r.col < cols) {
        rawGrid[r.row][r.col] = r.text || '';
        codeGrid[r.row][r.col] = r.code || '';
      }
    }
    done += batch.length;
    onProgress?.({ done, total: totalCells });
  }

  // 4. 汇总统计
  const map = new Map<string, number>();
  let recognized = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const code = codeGrid[r][c];
      if (code) {
        map.set(code, (map.get(code) || 0) + 1);
        recognized++;
      }
    }
  }
  const stats = Array.from(map.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  return { rawGrid, codeGrid, stats, totalCells, recognizedCells: recognized };
}

/**
 * 检查后端 OCR 引擎是否就绪（模型加载完成）。
 * 返回 'ready' | 'loading' | 'error'
 */
export async function getOcrStatus(): Promise<'ready' | 'loading' | 'error'> {
  try {
    const token = localStorage.getItem('token') || '';
    const resp = await fetch('/api/ocr/status', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) return 'error';
    const data = await resp.json();
    if (data.ready) return 'ready';
    if (data.loading) return 'loading';
    return 'error';
  } catch (e) {
    return 'error';
  }
}

/** 重新统计（用户手动修正某格后调用） */
export function recomputeStats(codeGrid: string[][]): CellOcrResult['stats'] {
  const map = new Map<string, number>();
  for (let r = 0; r < codeGrid.length; r++) {
    for (let c = 0; c < codeGrid[r].length; c++) {
      const code = codeGrid[r][c];
      if (code) map.set(code, (map.get(code) || 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
}
