// 渲染进程全局类型声明：window.hub 由 preload 注入
import type { HubApi } from '../electron/shared';

declare global {
  interface Window {
    hub: HubApi;
  }
}

export {};
