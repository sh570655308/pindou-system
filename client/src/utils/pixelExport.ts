// 像素化项目导出工具：把 OCR 识别网格转成 .pindou 项目文件，
// 可在像素化模块里加载继续编辑。
//
// .pindou 格式 = JSON，结构参照 Pixelate.tsx 的 handleSaveProject：
//   { version, timestamp, layers: [{id,name,visible,locked,pixels}], activeLayerId, stats }
//
// pixels 是 PixelCell[][] = { hex: string|null, productId?: number|null }。
// 每个格子：有代码 → 取产品色 hex + productId；无代码 → hex=null。

export interface ExportProduct {
  id: number;
  code: string;
  color_hex?: string;
  category_name?: string;
}

interface PixelCell {
  hex: string | null;
  productId?: number | null;
}

interface StatsItem {
  productId?: number | null;
  code: string;
  hex?: string;
  count: number;
}

interface PindouProject {
  version: string;
  timestamp: number;
  layers: Array<{
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    pixels: PixelCell[][];
  }>;
  activeLayerId: string;
  stats: StatsItem[];
  config: {
    maxPixels: number;
    colorCount: number;
    removeBg: boolean;
    showMaterialCodes: boolean;
    statsVisible: boolean;
  };
}

/**
 * 把识别网格 + 产品库转成 .pindou 项目 JSON。
 * 自动裁剪掉四周全空的行/列（只保留有效物料区 + 1 格边距）。
 */
export function buildPindouProject(
  codeGrid: string[][],
  products: ExportProduct[]
): PindouProject | null {
  const totalRows = codeGrid.length || 0;
  const totalCols = totalRows ? codeGrid[0].length : 0;
  if (!totalRows || !totalCols) return null;

  // code → product 映射
  const productByCode = new Map<string, ExportProduct>();
  products.forEach((p) => productByCode.set(p.code, p));

  // 找有效格边界框（有代码的格）
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      if (codeGrid[r][c]) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR < 0) return null; // 没有任何有效格

  // 四周留 1 格边距
  const cropMinR = Math.max(0, minR - 1);
  const cropMaxR = Math.min(totalRows - 1, maxR + 1);
  const cropMinC = Math.max(0, minC - 1);
  const cropMaxC = Math.min(totalCols - 1, maxC + 1);

  // 构建像素矩阵
  const pixels: PixelCell[][] = [];
  const statMap = new Map<string, StatsItem>();
  for (let r = cropMinR; r <= cropMaxR; r++) {
    const row: PixelCell[] = [];
    for (let c = cropMinC; c <= cropMaxC; c++) {
      const code = codeGrid[r][c];
      if (!code) {
        row.push({ hex: null, productId: null });
      } else {
        const prod = productByCode.get(code);
        const hex = prod?.color_hex || null;
        const productId = prod?.id ?? null;
        row.push({ hex, productId });
        // 统计：按 productId 或 hex 聚合（与 stats.worker 一致）
        const key = productId != null ? `p:${productId}` : `h:${(hex || '').toLowerCase()}`;
        const ex = statMap.get(key);
        if (ex) ex.count++;
        else statMap.set(key, { productId, code, hex: hex || undefined, count: 1 });
      }
    }
    pixels.push(row);
  }

  const stats = Array.from(statMap.values()).sort((a, b) => {
    // 字母优先，数字感知
    const ca = (a.code || '').toLowerCase();
    const cb = (b.code || '').toLowerCase();
    const isLetterA = /[a-z]/.test(ca.charAt(0));
    const isLetterB = /[a-z]/.test(cb.charAt(0));
    if (isLetterA !== isLetterB) return isLetterA ? -1 : 1;
    return ca.localeCompare(cb, undefined, { numeric: true, sensitivity: 'base' });
  });

  return {
    version: '2.1',
    timestamp: Date.now(),
    layers: [{
      id: 'layer-1',
      name: '图层 1',
      visible: true,
      locked: false,
      pixels,
    }],
    activeLayerId: 'layer-1',
    stats,
    config: {
      maxPixels: 100,
      colorCount: 32,
      removeBg: false,
      showMaterialCodes: true,
      statsVisible: true,
    },
  };
}

/**
 * 生成 .pindou 文件并触发下载。
 * 返回 true 表示成功。
 */
export function downloadPindouProject(
  codeGrid: string[][],
  products: ExportProduct[],
  filename?: string
): boolean {
  const project = buildPindouProject(codeGrid, products);
  if (!project) return false;
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `grid-ocr-${project.layers[0].pixels[0]?.length || 0}x${project.layers[0].pixels.length}-${Date.now()}.pindou`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}
