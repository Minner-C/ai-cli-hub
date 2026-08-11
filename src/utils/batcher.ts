// 流式事件合帧批处理器：IPC chunk 到达频率远高于渲染需要，
// 按 key 聚合 intervalMs 内的事件一次性 flush，降低 store set / 重渲染频率
export class EventBatcher<T> {
  private queues = new Map<string, T[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private intervalMs: number,
    private flush: (key: string, items: T[]) => void,
  ) {}

  push(key: string, item: T, immediate = false): void {
    const queue = this.queues.get(key) ?? [];
    queue.push(item);
    this.queues.set(key, queue);
    if (immediate) {
      this.flushKey(key);
      return;
    }
    if (!this.timers.has(key)) {
      this.timers.set(
        key,
        setTimeout(() => this.flushKey(key), this.intervalMs),
      );
    }
  }

  private flushKey(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    const queue = this.queues.get(key);
    this.queues.delete(key);
    if (queue && queue.length > 0) this.flush(key, queue);
  }

  flushAll(): void {
    for (const key of [...this.queues.keys()]) this.flushKey(key);
  }
}
