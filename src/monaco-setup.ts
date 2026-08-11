// Monaco Editor 本地化配置：使用本地 monaco-editor 包，无需 CDN
// 策略：语法高亮（tokenization）在主线程完成，不依赖 worker
// worker 仅用于高级语言特性（JSON 校验、TS 类型检查等）
// 由于 Vite 8 Rolldown 无法正确打包 monaco-editor 的 bare module worker，
// 使用空 Blob Worker 作为 fallback，确保 Monaco 正常初始化、语法高亮正常工作
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

// 空 Worker：Monaco 要求 getWorker 返回 Worker 实例，否则初始化报错
// 空 Worker 不处理任何消息，高级语言特性降级，但语法高亮（主线程 tokenization）不受影响
const emptyBlob = new Blob([''], { type: 'application/javascript' });
const emptyWorkerUrl = URL.createObjectURL(emptyBlob);

self.MonacoEnvironment = {
  getWorker() {
    return new Worker(emptyWorkerUrl);
  },
};

// 指定使用本地安装的 monaco-editor，避免 @monaco-editor/react 默认从 CDN 加载
loader.config({ monaco });

export { monaco };
