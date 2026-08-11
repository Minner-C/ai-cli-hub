// 应用内命令执行器：安装/更新直接 spawn（不弹外部终端），流式回传输出尾部
import { spawn } from 'node:child_process';

export interface RunResult {
  code: number | null;
  error?: string;
}

const running = new Set<string>();

export function isRunning(key: string): boolean {
  return running.has(key);
}

// shell:true（Windows 上 npm 是 .cmd，需经 cmd 解释）；10 分钟超时
export function runCommand(
  key: string,
  command: string,
  onData: (chunk: string) => void,
  timeoutMs = 600_000,
): Promise<RunResult> {
  if (running.has(key)) {
    return Promise.resolve({ code: null, error: 'already running' });
  }
  running.add(key);
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: RunResult) => {
      if (settled) return;
      settled = true;
      running.delete(key);
      resolve(result);
    };
    const proc = spawn(command, { shell: true, windowsHide: true });
    const feed = (d: Buffer) => onData(d.toString('utf8'));
    proc.stdout.on('data', feed);
    proc.stderr.on('data', feed);
    proc.on('error', (err) => done({ code: null, error: err.message }));
    proc.on('close', (code) => done({ code }));
    setTimeout(() => {
      if (!settled) {
        proc.kill();
        done({ code: null, error: `timeout (${Math.round(timeoutMs / 60000)}min)` });
      }
    }, timeoutMs);
  });
}
