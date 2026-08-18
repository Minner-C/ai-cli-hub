// dsh web 服务进程管理：懒启动 + 端口探测 + 退出清理
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';

const PORT = 3080;
const URL = `http://127.0.0.1:${PORT}`;

let proc: ChildProcess | null = null;

function probe(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(URL, (res) => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

// 确保 dsh web 在跑（已在跑则直接返回 URL）
export async function ensureDshWeb(): Promise<{ ok: boolean; url: string; message?: string }> {
  if (await probe()) return { ok: true, url: URL };
  if (!proc) {
    // 用 npx 跑（全局 dsh 或缓存）
    proc = spawn('cmd.exe', ['/c', 'npx', '-y', '@deepseek-ai/dsh', 'web'], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    proc.on('error', () => { proc = null; });
    proc.on('close', () => { proc = null; });
  }
  // 等就绪（最多 40s，npx 首次下载慢）
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await probe()) return { ok: true, url: URL };
  }
  return { ok: false, url: URL, message: 'dsh web 启动超时' };
}

export function stopDshWeb(): void {
  proc?.kill();
  proc = null;
}

// 设置页服务状态（不触发启动）
export async function dshStatus(): Promise<{ running: boolean; url: string; port: number }> {
  return { running: await probe(), url: URL, port: PORT };
}
