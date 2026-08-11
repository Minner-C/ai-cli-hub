// 安全发送：窗口销毁后异步回调里的 send 一律走这里，防止
// "TypeError: Object has been destroyed" 打崩主进程
import type { WebContents } from 'electron';

export function safeSend(
  webContents: WebContents | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  try {
    if (!webContents || webContents.isDestroyed()) return;
    webContents.send(channel, ...args);
  } catch (err) {
    // 极端竞态（isDestroyed 判定与 send 之间窗口销毁）只记日志
    console.warn('[safeSend] dropped:', channel, err instanceof Error ? err.message : err);
  }
}
