/**
 * 性能监控工具
 * 用于测量和记录关键操作的执行时间
 */

export class PerformanceMonitor {
  private marks: Map<string, number> = new Map();
  private enabled: boolean = true;

  constructor(enabled: boolean = true) {
    this.enabled = enabled && typeof performance !== 'undefined';
  }

  // 开始计时
  start(name: string): void {
    if (!this.enabled) return;
    const startTime = performance.now();
    this.marks.set(name, startTime);
  }

  // 结束计时并输出
  end(name: string): number {
    if (!this.enabled) return 0;

    const startTime = this.marks.get(name);
    if (startTime === undefined) {
      console.warn(`[Performance] 没有找到标记: ${name}`);
      return 0;
    }

    const endTime = performance.now();
    const duration = endTime - startTime;
    this.marks.delete(name);

    console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`);
    return duration;
  }

  // 测量异步函数执行时间
  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.enabled) return fn();

    this.start(name);
    try {
      const result = await fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  // 测量同步函数执行时间
  measureSync<T>(name: string, fn: () => T): T {
    if (!this.enabled) return fn();

    this.start(name);
    try {
      const result = fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  // 获取内存使用情况（如果支持）
  getMemoryUsage(): { used: number; total: number } | null {
    if (!this.enabled || !(performance as any).memory) {
      return null;
    }

    const memory = (performance as any).memory;
    return {
      used: Math.round(memory.usedJSHeapSize / 1024 / 1024), // MB
      total: Math.round(memory.totalJSHeapSize / 1024 / 1024) // MB
    };
  }

  // 打印当前状态
  logState(label: string = 'Performance State'): void {
    if (!this.enabled) return;

    const memory = this.getMemoryUsage();
    console.log(`[${label}]`, {
      memory: memory ? `${memory.used}MB / ${memory.total}MB` : 'N/A',
      activeMarks: Array.from(this.marks.keys())
    });
  }
}

// 创建全局单例
export const perfMonitor = new PerformanceMonitor(
  process.env.NODE_ENV === 'development'
);

// 导出便捷函数
export const perfStart = (name: string) => perfMonitor.start(name);
export const perfEnd = (name: string) => perfMonitor.end(name);
export const perfMeasure = async <T>(name: string, fn: () => Promise<T>) =>
  perfMonitor.measure(name, fn);
export const perfMeasureSync = <T>(name: string, fn: () => T) =>
  perfMonitor.measureSync(name, fn);
export const perfLog = (label?: string) => perfMonitor.logState(label);
