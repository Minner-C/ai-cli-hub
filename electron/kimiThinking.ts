// kimi 思考支持：spawn 前临时改写 ~/.kimi-code/config.toml 的 [thinking] 表，
// kimi 进程结束后恢复原文。安全机制：
//   1. 改写前把原文备份到内存 + electron-store（pendingRestore 标记）
//   2. finally 必恢复；应用启动时自检标记并恢复（防异常退出遗留）
//   3. 同一时刻多个 kimi 调用经 Promise 队列串行化，避免配置交错
//   4. 文件不存在/解析失败时不改写，直接按原样 spawn（降级）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import { store } from './taskStore';
import type { EffortLevel } from './shared';

const BACKUP_KEY = 'kimiThinkingBackup';

function configPath(): string {
  return path.join(os.homedir(), '.kimi-code', 'config.toml');
}

// 纯函数：生成改写后的 config 文本（解析失败/无文件返回 null 表示降级）
export function buildPatchedConfig(original: string, level: EffortLevel): string | null {
  let doc: Record<string, unknown>;
  try {
    doc = TOML.parse(original) as Record<string, unknown>;
  } catch {
    return null;
  }
  const thinking = ((doc.thinking as Record<string, unknown> | undefined) ??= {});
  if (level === 'off') {
    thinking.enabled = false;
    delete thinking.effort;
  } else {
    thinking.enabled = true;
    thinking.effort = level; // low/medium/high；模型不支持时 kimi 自行回退 default_effort
  }
  // keep 等其他字段不动
  return TOML.stringify(doc as Parameters<typeof TOML.stringify>[0]);
}

let queue: Promise<unknown> = Promise.resolve();

// 串行化的临时改写执行器
export function withKimiThinking<T>(level: EffortLevel | undefined, fn: () => Promise<T>): Promise<T> {
  const run = queue.then(() => inner(level, fn));
  // 队列永不因单次失败而中断
  queue = run.catch(() => undefined);
  return run;
}

async function inner<T>(level: EffortLevel | undefined, fn: () => Promise<T>): Promise<T> {
  if (!level) return fn();

  const file = configPath();
  let original: string;
  try {
    original = fs.readFileSync(file, 'utf8');
  } catch {
    return fn(); // 无 config 文件：降级按原样执行
  }
  const patched = buildPatchedConfig(original, level);
  if (patched === null) return fn(); // 解析失败：降级

  // 备份原文（内存 + store 标记，供崩溃恢复）
  store.set(BACKUP_KEY as never, original as never);
  try {
    fs.writeFileSync(file, patched, 'utf8');
  } catch {
    store.delete(BACKUP_KEY as never);
    return fn(); // 写入失败：降级
  }

  try {
    return await fn();
  } finally {
    let restored = false;
    try {
      fs.writeFileSync(file, original, 'utf8');
      restored = true;
    } catch {
      /* 恢复失败则保留标记，下次启动自检恢复 */
    }
    if (restored) store.delete(BACKUP_KEY as never);
  }
}

// 启动自检：上次异常退出若遗留临时改写，恢复原文
export function restoreKimiConfigIfPending(): boolean {
  const backup = store.get(BACKUP_KEY as never) as string | undefined;
  if (!backup) return false;
  try {
    fs.writeFileSync(configPath(), backup, 'utf8');
  } catch {
    /* 文件不可写也清除标记，避免死循环 */
  }
  store.delete(BACKUP_KEY as never);
  return true;
}
