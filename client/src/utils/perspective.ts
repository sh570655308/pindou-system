// 透视变换工具：homography 求解 + 反向采样拉正 + mm↔px 单位换算
// 用途：把用户在原图上点选的 4 个角（任意四边形）拉正成 W×H 网格的彩色像素图，
//       用于"打印对齐图纸"功能。

export interface Point {
  x: number;
  y: number;
}

/** 4 个源点（顺序：左上、右上、右下、左下） */
export type Point4 = [Point, Point, Point, Point];

/**
 * 高斯消元法求解线性方程组 A·x = b
 * A: n×n 系数矩阵, b: n×1 常数向量
 * 返回解向量 x，若奇异返回 null
 */
function gaussianElimination(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // 增广矩阵 [A | b]
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // 选主元
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > maxVal) {
        maxVal = Math.abs(aug[r][col]);
        maxRow = r;
      }
    }
    if (maxVal < 1e-12) return null; // 奇异矩阵

    // 交换行
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    // 消元
    const pivot = aug[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col] / pivot;
      for (let c = col; c <= n; c++) {
        aug[r][c] -= factor * aug[col][c];
      }
    }
  }

  // 回代求解
  const x: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = aug[i][n] / aug[i][i];
  }
  return x;
}

/**
 * 求解单应性矩阵 H（3×3），使得 dst ~ H · src（齐次坐标）
 * 通过求解 8 个未知数 h11..h32（h33=1）的线性方程组。
 *
 * 返回长度为 9 的数组 [h11,h12,h13, h21,h22,h23, h31,h32,h33]，失败返回 null。
 */
export function solveHomography(src: Point4, dst: Point4): number[] | null {
  // 对每个点对建立 2 个方程，共 8 个方程解 8 个未知数
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    // 方程1: h11*sx + h12*sy + h13 - h31*sx*dx - h32*sy*dx = dx
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);

    // 方程2: h21*sx + h22*sy + h23 - h31*sx*dy - h32*sy*dy = dy
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }

  const h = gaussianElimination(A, b);
  if (!h) return null;

  // h33 = 1
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** 应用 3×3 单应性矩阵到一个点，返回变换后的坐标 */
export function applyHomography(H: number[], p: Point): Point {
  const x = H[0] * p.x + H[1] * p.y + H[2];
  const y = H[3] * p.x + H[4] * p.y + H[5];
  const w = H[6] * p.x + H[7] * p.y + H[8];
  if (Math.abs(w) < 1e-12) return { x: 0, y: 0 };
  return { x: x / w, y: y / w };
}

/**
 * 求矩阵的逆（3×3），用于反向映射
 */
export function invertHomography(H: number[]): number[] | null {
  // 行列式
  const det =
    H[0] * (H[4] * H[8] - H[5] * H[7]) -
    H[1] * (H[3] * H[8] - H[5] * H[6]) +
    H[2] * (H[3] * H[7] - H[4] * H[6]);
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1 / det;
  // 伴随矩阵转置 / det
  return [
    (H[4] * H[8] - H[5] * H[7]) * invDet,
    (H[2] * H[7] - H[1] * H[8]) * invDet,
    (H[1] * H[5] - H[2] * H[4]) * invDet,
    (H[5] * H[6] - H[3] * H[8]) * invDet,
    (H[0] * H[8] - H[2] * H[6]) * invDet,
    (H[2] * H[3] - H[0] * H[5]) * invDet,
    (H[3] * H[7] - H[4] * H[6]) * invDet,
    (H[1] * H[6] - H[0] * H[7]) * invDet,
    (H[0] * H[4] - H[1] * H[3]) * invDet,
  ];
}

export type RGB = { r: number; g: number; b: number; a: number };

/** rgb 转 #hex 字符串 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 透视拉正：把源图像中由 4 个角组成的任意四边形区域，反向采样成 gridW×gridH 的像素网格。
 *
 * @param img        源图片（已加载的 HTMLImageElement）
 * @param corners    源图中的 4 个角（左上、右上、右下、左下，任意四边形）
 * @param gridW      输出网格宽（格子数）
 * @param gridH      输出网格高（格子数）
 * @param transparentThreshold  透明度阈值（0~255），低于此值的格子返回 null（透明）
 * @returns          gridH×gridW 的二维数组，每格 {hex, productId?} 或 null（透明）
 */
export function warpPerspective(
  img: HTMLImageElement,
  corners: Point4,
  gridW: number,
  gridH: number,
  transparentThreshold = 30
): Array<{ hex: string | null }> {
  // 把目标网格的 4 个角（0,0)-(gridW,0)-(gridW,gridH)-(0,gridH) 映射回源图
  // 求 H: src -> dst（dst=网格坐标），然后求 H^-1 做 dst->src 反向采样
  const dstCorners: Point4 = [
    { x: 0, y: 0 },
    { x: gridW, y: 0 },
    { x: gridW, y: gridH },
    { x: 0, y: gridH },
  ];

  const H = solveHomography(corners, dstCorners);
  if (!H) {
    // 退化情况：用简单的边界框采样
    return simpleBoxSample(img, corners, gridW, gridH, transparentThreshold);
  }
  const Hinv = invertHomography(H);
  if (!Hinv) {
    return simpleBoxSample(img, corners, gridW, gridH, transparentThreshold);
  }

  // 读取源图像素
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return simpleBoxSample(img, corners, gridW, gridH, transparentThreshold);
  }
  ctx.drawImage(img, 0, 0);
  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
  } catch (e) {
    // 跨域图片无法读取像素，退化为简单采样
    return simpleBoxSample(img, corners, gridW, gridH, transparentThreshold);
  }
  const data = imgData.data;
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  // 反向采样：对每个目标格子中心点，映射回源图采样
  const result: Array<{ hex: string | null }> = new Array(gridH * gridW);
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const p = applyHomography(Hinv, { x: gx + 0.5, y: gy + 0.5 });
      const sx = Math.round(p.x);
      const sy = Math.round(p.y);
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
        result[gy * gridW + gx] = { hex: null };
        continue;
      }
      const idx = (sy * w + sx) * 4;
      const a = data[idx + 3];
      if (a < transparentThreshold) {
        result[gy * gridW + gx] = { hex: null };
      } else {
        result[gy * gridW + gx] = {
          hex: rgbToHex(data[idx], data[idx + 1], data[idx + 2]),
        };
      }
    }
  }
  return result;
}

/** 退化路径：当透视矩阵无法求解时，用 4 角边界框做最近邻采样 */
function simpleBoxSample(
  img: HTMLImageElement,
  corners: Point4,
  gridW: number,
  gridH: number,
  transparentThreshold: number
): Array<{ hex: string | null }> {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const bw = maxX - minX;
  const bh = maxY - minY;

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const result: Array<{ hex: string | null }> = new Array(gridH * gridW).fill({ hex: null });
  if (!ctx || bw <= 0 || bh <= 0) return result;

  ctx.drawImage(img, 0, 0);
  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
  } catch (e) {
    return result;
  }
  const data = imgData.data;
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const sx = Math.round(minX + ((gx + 0.5) / gridW) * bw);
      const sy = Math.round(minY + ((gy + 0.5) / gridH) * bh);
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
      const idx = (sy * w + sx) * 4;
      if (data[idx + 3] < transparentThreshold) continue;
      result[gy * gridW + gx] = {
        hex: rgbToHex(data[idx], data[idx + 1], data[idx + 2]),
      };
    }
  }
  return result;
}

/**
 * 把源图的某个三角形区域 (s0,s1,s2) 仿射绘制到目标三角形 (d0,d1,d2)。
 * 利用 ctx.setTransform 设置仿射矩阵，然后用三角形 clip 限定绘制范围，
 * drawImage 时源像素直接映射，保留原图清晰度。
 */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s0: Point, s1: Point, s2: Point,
  d0: Point, d1: Point, d2: Point
) {
  ctx.save();
  // 目标三角形裁剪区域
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();

  // 求仿射变换 [a b c d e f]：dst = M·src
  // 由 3 个点对解 2x2 线性矩阵 + 平移
  const ux = s1.x - s0.x, uy = s1.y - s0.y;
  const vx = s2.x - s0.x, vy = s2.y - s0.y;
  const dux = d1.x - d0.x, duy = d1.y - d0.y;
  const dvx = d2.x - d0.x, dvy = d2.y - d0.y;
  const det = ux * vy - uy * vx;
  if (Math.abs(det) < 1e-10) {
    ctx.restore();
    return;
  }
  // M = [a c; b d] 满足 M·(u)=du, M·(v)=dv
  const aa = (dux * vy - dvx * uy) / det;
  const ac = (dvx * ux - dux * vx) / det;
  const ab = (duy * vy - dvy * uy) / det;
  const ad = (dvy * ux - duy * vx) / det;
  const e = d0.x - aa * s0.x - ac * s0.y;
  const f = d0.y - ab * s0.x - ad * s0.y;
  ctx.setTransform(aa, ab, ac, ad, e, f);
  // 把整个源图绘制上去（clip 已限制到目标三角形，源坐标由仿射对齐）
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * 透视拉正为完整 canvas（保留原图分辨率，零颜色失真）。
 *
 * 原理：把目标网格细分为 N×N 子网格，每个子网格的源→目标角点用 homography 算出，
 * 然后把每个子四边形拆成 2 个三角形，用 drawTriangle 做仿射纹理映射。
 * 子网格越细，越接近真实透视；像素直接来自原图 drawImage，不做采样/重画。
 *
 * @param img        源图片
 * @param corners    源图中的 4 个角（左上、右上、右下、左下）
 * @param gridW      输出宽（格子数）
 * @param gridH      输出高（格子数）
 * @param outScale   输出 canvas 的每格像素数（越大越清晰，默认每格 20px）
 * @param subdiv     细分数（默认 8，越大越精准但越慢）
 * @returns          HTMLCanvasElement，尺寸 = gridW·outScale × gridH·outScale
 */
export function warpImageToCanvas(
  img: HTMLImageElement,
  corners: Point4,
  gridW: number,
  gridH: number,
  outScale = 20,
  subdiv = 8
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = gridW * outScale;
  out.height = gridH * outScale;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  // 透明背景
  ctx.clearRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // H: 源 → 目标（目标坐标 = 格子数 × outScale）
  const dstCorners: Point4 = [
    { x: 0, y: 0 },
    { x: out.width, y: 0 },
    { x: out.width, y: out.height },
    { x: 0, y: out.height },
  ];
  const H = solveHomography(corners, dstCorners);
  if (!H) {
    // 退化：直接边界框缩放
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    ctx.drawImage(
      img,
      Math.min(...xs), Math.min(...ys),
      Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys),
      0, 0, out.width, out.height
    );
    return out;
  }
  const Hinv = invertHomography(H);
  if (!Hinv) {
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    ctx.drawImage(
      img,
      Math.min(...xs), Math.min(...ys),
      Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys),
      0, 0, out.width, out.height
    );
    return out;
  }

  // 细分子网格：每个子四边形对应目标和源的一组 4 角
  // 目标网格点 (gx, gy) ∈ [0..subdiv]
  const cellW = out.width / subdiv;
  const cellH = out.height / subdiv;
  for (let gy = 0; gy < subdiv; gy++) {
    for (let gx = 0; gx < subdiv; gx++) {
      // 目标子四边形 4 角
      const td0 = { x: gx * cellW, y: gy * cellH };
      const td1 = { x: (gx + 1) * cellW, y: gy * cellH };
      const td2 = { x: (gx + 1) * cellW, y: (gy + 1) * cellH };
      const td3 = { x: gx * cellW, y: (gy + 1) * cellH };
      // 反查源图对应 4 角
      const ts0 = applyHomography(Hinv, td0);
      const ts1 = applyHomography(Hinv, td1);
      const ts2 = applyHomography(Hinv, td2);
      const ts3 = applyHomography(Hinv, td3);
      // 拆成 2 个三角形
      drawTriangle(ctx, img, ts0, ts1, ts2, td0, td1, td2);
      drawTriangle(ctx, img, ts0, ts2, ts3, td0, td2, td3);
    }
  }
  return out;
}

// ============ 单位换算 ============

/** CSS 标准基准：1in = 96px = 25.4mm */
const PX_PER_MM = 96 / 25.4;

export function mmToPx(mm: number): number {
  return mm * PX_PER_MM;
}

export function pxToMm(px: number): number {
  return px / PX_PER_MM;
}

/** A4 尺寸（mm） */
export const A4 = { width: 210, height: 297 };
