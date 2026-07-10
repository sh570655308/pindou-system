// 拼豆图纸物料区自动检测
// 输入：图纸图片；输出：物料区的四角（自然像素坐标）+ 横向/竖向格子数（=框选区域内格子数）
//
// 核心思路：利用"物料区格子背景是饱和彩色，而编号行/列和白边几乎不饱和"这一特征。
//   1. 行方向饱和像素占比 → 合并相邻段（容忍网格线造成的间隙）→ 最长段 = 物料区上下边界
//   2. 在该行段内统计列方向饱和占比 → 同法得左右边界
//   3. 物料区内行方向饱和占比的自相关 → 单格像素宽（带倍频修正）→ 格子数 = 区域宽高/单格
//
// 自动格子数对照片质量敏感，结果仅供参考；页面会提示用户对照网格预览线核对/微调。

import type { Point4 } from './perspective';

export interface GridDetectResult {
  /** 物料区四角：左上、右上、右下、左下（自然像素坐标） */
  corners: Point4;
  /** 物料区横向格子数（=框选区域内列数） */
  cols: number;
  /** 物料区竖向格子数（=框选区域内行数） */
  rows: number;
  /** 检测到的单格像素宽（分析图坐标系） */
  cellPx: number;
  /** 0~1 置信度 */
  confidence: number;
}

const ANALYSIS_MAX_DIM = 2000;

/** 饱和度阈值：max(R,G,B)-min(R,G,B) > 此值视为饱和（彩色）像素 */
const SAT_THRESHOLD = 40;
/** 行/列饱和占比阈值：超过此值视为"该行/列属于物料区" */
const SAT_RATIO_THRESHOLD = 0.3;
/** 合并相邻饱和段的最大间隙（分析图像素）—— 容忍网格线把物料区切断 */
const MERGE_GAP = 30;
/** 单格像素上限：超过则视为倍频，尝试折半（2000 宽图上单格通常 15~50px） */
const MAX_CELL_PX = 50;

interface Range {
  start: number;
  end: number;
}

function getAnalysisImageData(
  img: HTMLImageElement
): { data: Uint8ClampedArray; width: number; height: number; scale: number } | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(nw, nh));
  const aw = Math.max(1, Math.round(nw * scale));
  const ah = Math.max(1, Math.round(nh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = aw;
  canvas.height = ah;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, aw, ah);
  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, aw, ah);
  } catch (e) {
    return null;
  }
  return { data: imgData.data, width: aw, height: ah, scale };
}

/** 该像素是否饱和（彩色） */
function isSaturated(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) > SAT_THRESHOLD;
}

/**
 * 找一维信号中超过阈值的段，合并间距 <= mergeGap 的相邻段，返回最长段。
 */
function longestMergedRange(sig: Float32Array, len: number, threshold: number, mergeGap: number): Range | null {
  const raw: Range[] = [];
  let start = -1;
  for (let i = 0; i <= len; i++) {
    const on = i < len && sig[i] > threshold;
    if (on && start < 0) start = i;
    else if (!on && start >= 0) {
      raw.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (start >= 0) raw.push({ start, end: len - 1 });
  if (raw.length === 0) return null;
  // 合并相邻
  const merged: Range[] = [{ ...raw[0] }];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    if (raw[i].start - last.end <= mergeGap) last.end = raw[i].end;
    else merged.push({ ...raw[i] });
  }
  // 取最长
  merged.sort((a, b) => b.end - b.start - (a.end - a.start));
  return merged[0];
}

/** 归一化自相关数组（ac[0]=1） */
function normalizedAutocorrelation(sig: Float32Array): Float32Array {
  const n = sig.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += sig[i];
  mean /= n;
  const dm = new Float32Array(n);
  for (let i = 0; i < n; i++) dm[i] = sig[i] - mean;
  let norm0 = 0;
  for (let i = 0; i < n; i++) norm0 += dm[i] * dm[i];
  norm0 = norm0 / n || 1;
  const maxLag = Math.floor(n / 2);
  const ac = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    let c = 0;
    for (let i = 0; i + lag < n; i++) {
      s += dm[i] * dm[i + lag];
      c++;
    }
    ac[lag] = (c > 0 ? s / c : 0) / norm0;
  }
  return ac;
}

/**
 * 在物料区内估单格像素宽：行方向饱和占比的自相关找主周期，带倍频修正。
 */
function estimateCellPx(rowSatInArea: Float32Array): number {
  const n = rowSatInArea.length;
  const ac = normalizedAutocorrelation(rowSatInArea);
  const lo = Math.max(8, Math.floor(n / 130));
  const hi = Math.floor(n / 8);
  let best = 0;
  let bestVal = 0;
  for (let lag = lo; lag <= hi && lag < ac.length; lag++) {
    if (ac[lag] > bestVal) {
      bestVal = ac[lag];
      best = lag;
    }
  }
  // 倍频修正：单格不会超过 MAX_CELL_PX，过大则尝试折半
  while (best > MAX_CELL_PX) {
    const half = Math.round(best / 2);
    if (half >= lo && ac[half] > bestVal * 0.4) best = half;
    else break;
  }
  return best;
}

/**
 * 主入口：自动检测物料区四角与格子数。
 * corners 为物料区四角；cols/rows 为框选区域内的格子数。
 */
export function detectGrid(img: HTMLImageElement): GridDetectResult {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;

  const fallback: GridDetectResult = {
    corners: [
      { x: 0, y: 0 },
      { x: nw, y: 0 },
      { x: nw, y: nh },
      { x: 0, y: nh },
    ],
    cols: 50,
    rows: 50,
    cellPx: 0,
    confidence: 0,
  };

  const analysis = getAnalysisImageData(img);
  if (!analysis) return fallback;
  const { data, width: aw, height: ah, scale } = analysis;

  // 行方向饱和占比（全图）
  const rowSat = new Float32Array(ah);
  for (let y = 0; y < ah; y++) {
    let c = 0;
    for (let x = 0; x < aw; x++) {
      const idx = (y * aw + x) * 4;
      if (isSaturated(data[idx], data[idx + 1], data[idx + 2])) c++;
    }
    rowSat[y] = c / aw;
  }

  // 物料区上下边界 = 行方向最长合并段
  const rowRange = longestMergedRange(rowSat, ah, SAT_RATIO_THRESHOLD, MERGE_GAP);
  if (!rowRange) return fallback;
  const top0 = rowRange.start;
  const bot0 = rowRange.end;
  const bandH = bot0 - top0 + 1;

  // 在 [top0,bot0] 内统计列方向饱和占比
  const colSat = new Float32Array(aw);
  for (let x = 0; x < aw; x++) {
    let c = 0;
    for (let y = top0; y <= bot0; y++) {
      const idx = (y * aw + x) * 4;
      if (isSaturated(data[idx], data[idx + 1], data[idx + 2])) c++;
    }
    colSat[x] = c / bandH;
  }
  const colRange = longestMergedRange(colSat, aw, SAT_RATIO_THRESHOLD, MERGE_GAP);
  if (!colRange) return fallback;

  // 物料区边界（加少量 pad 避免切到边格）
  const pad = Math.max(1, Math.round(Math.min(aw, ah) * 0.002));
  const left = Math.max(0, colRange.start - pad);
  const right = Math.min(aw - 1, colRange.end + pad);
  const top = Math.max(0, top0 - pad);
  const bottom = Math.min(ah - 1, bot0 + pad);
  const gw = right - left + 1;
  const gh = bottom - top + 1;

  // 物料区内行方向饱和占比（用于估周期）
  const rowSatArea = new Float32Array(gh);
  for (let y = 0; y < gh; y++) {
    let c = 0;
    for (let x = 0; x < gw; x++) {
      const idx = ((top + y) * aw + (left + x)) * 4;
      if (isSaturated(data[idx], data[idx + 1], data[idx + 2])) c++;
    }
    rowSatArea[y] = c / gw;
  }
  const cellPx = estimateCellPx(rowSatArea);

  let cols = 0;
  let rows = 0;
  let confidence = 0;
  if (cellPx > 0) {
    cols = Math.max(2, Math.round(gw / cellPx));
    rows = Math.max(2, Math.round(gh / cellPx));
    const colErr = Math.abs(gw / cellPx - cols);
    const rowErr = Math.abs(gh / cellPx - rows);
    const fit = 1 - Math.min(1, (colErr + rowErr) / 2);
    // 置信度：圆整度（fit）为主，自相关强度为辅
    const ac = normalizedAutocorrelation(rowSatArea);
    confidence = Math.max(0, Math.min(1, fit * 0.6 + Math.min(1, ac[cellPx] || 0) * 0.4));
  } else {
    cols = 50;
    rows = 50;
    confidence = 0.1;
  }

  // snap 到整数格：以区域中心为中心，宽=cols×cellPx、高=rows×cellPx
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const halfW = cellPx > 0 ? (cols * cellPx) / 2 : gw / 2;
  const halfH = cellPx > 0 ? (rows * cellPx) / 2 : gh / 2;

  const toNatural = (ax: number, ay: number) => ({
    x: Math.round(ax / scale),
    y: Math.round(ay / scale),
  });
  const corners: Point4 = [
    toNatural(cx - halfW, cy - halfH),
    toNatural(cx + halfW, cy - halfH),
    toNatural(cx + halfW, cy + halfH),
    toNatural(cx - halfW, cy + halfH),
  ];

  return { corners, cols, rows, cellPx, confidence };
}
