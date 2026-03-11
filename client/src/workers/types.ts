/**
 * Worker 类型定义
 * 用于统计计算的 Web Worker
 */

export interface PixelCell {
  hex: string | null;
  productId?: number | null;
}

export interface WorkerMessage {
  pixels: PixelCell[][];
  type: 'compute';
  id?: number; // 用于追踪请求
}

export interface WorkerResponse {
  type: 'result';
  stats: StatsItem[];
  id?: number; // 对应请求的ID
}

export interface StatsItem {
  productId?: number | null;
  code: string;
  hex?: string;
  count: number;
}

// 扩展全局 Worker 类型
declare global {
  interface Worker {
    postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  }
}
