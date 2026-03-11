/**
 * 统计计算 Web Worker
 * 在后台线程中计算像素统计信息，避免阻塞主线程
 */

import type { PixelCell, StatsItem } from './types';

interface WorkerMessage {
  pixels: PixelCell[][];
  type: 'compute';
  id?: number;
}

interface WorkerResponse {
  type: 'result';
  stats: StatsItem[];
  id?: number;
}

// 从像素矩阵计算统计信息
function computeStatsFromPixels(pixels: PixelCell[][]): StatsItem[] {
  const map = new Map<string, { productId?: number | null; hex?: string | null; count: number }>();

  for (let r = 0; r < pixels.length; r++) {
    for (let c = 0; c < (pixels[r]?.length || 0); c++) {
      const cell = pixels[r][c];
      if (!cell || !cell.hex) continue;

      // 使用 productId 或 hex 作为唯一标识
      const key = (typeof cell.productId === 'number')
        ? `p:${cell.productId}`
        : `h:${cell.hex!.toLowerCase()}`;

      if (!map.has(key)) {
        map.set(key, {
          productId: typeof cell.productId === 'number' ? cell.productId : null,
          hex: cell.hex,
          count: 0
        });
      }

      const entry = map.get(key)!;
      entry.count += 1;
    }
  }

  // 转换为 StatsItem 数组
  const out: StatsItem[] = Array.from(map.values()).map((it) => {
    // 注意：这里无法获取 materials 信息，需要主线程补充 code
    return {
      productId: it.productId,
      code: '', // 将由主线程填充
      hex: it.hex || undefined,
      count: it.count
    };
  });

  // 按数量降序排序
  out.sort((a, b) => b.count - a.count);

  return out;
}

// 监听主线程消息
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { pixels, type, id } = e.data;

  if (type === 'compute') {
    try {
      const stats = computeStatsFromPixels(pixels);

      const response: WorkerResponse = {
        type: 'result',
        stats,
        id
      };

      self.postMessage(response);
    } catch (error) {
      console.error('Worker计算错误:', error);
      self.postMessage({
        type: 'result',
        stats: [],
        id
      });
    }
  }
};

// 导出类型以便 TypeScript 使用
export type {};
