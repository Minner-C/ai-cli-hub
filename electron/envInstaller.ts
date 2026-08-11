// 运行时环境（Node.js / Python）检测与一键安装
// 面向小白：优先 winget（Windows 10 1809+ 自带），不可用时下载官方安装包静默安装
// 安装后 PATH 更新需要重启应用才生效（Windows 环境变量不传播到已运行进程）
import { execFile, spawn } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type RuntimeKind = 'node' | 'python';

export interface RuntimeStatus {
  kind: RuntimeKind;
  installed: boolean;
  version?: string;
  wingetAvailable: boolean;
}

// 检测命令是否存在并取版本
function checkCmd(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.trim().split('\n')[0] || null);
    });
  });
}

export function checkWinget(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('winget', ['--version'], { timeout: 8000, windowsHide: true }, (err) => {
      resolve(!err);
    });
  });
}

// 检测单个运行时；npm 随 node 自带，只查 node
export async function checkRuntime(kind: RuntimeKind): Promise<RuntimeStatus> {
  const wingetAvailable = await checkWinget();
  let version: string | null = null;
  if (kind === 'node') {
    version = await checkCmd('node', ['--version']);
    // node 在则 npm 在（Windows 安装器同捆）
    if (!version) version = await checkCmd('npm', ['--version']);
  } else {
    // python: 先 python，再 python3，再 py
    version = await checkCmd('python', ['--version']);
    if (!version) version = await checkCmd('python3', ['--version']);
    if (!version) version = await checkCmd('py', ['--version']);
  }
  return { kind, installed: !!version, version: version ?? undefined, wingetAvailable };
}

export async function checkAllRuntimes(): Promise<RuntimeStatus[]> {
  return Promise.all([checkRuntime('node'), checkRuntime('python')]);
}

const WINGET_ID: Record<RuntimeKind, string> = {
  node: 'OpenJS.NodeJS.LTS',
  python: 'Python.Python.3.12',
};

// 用 winget 安装，流式回传输出
function installViaWinget(
  kind: RuntimeKind,
  onData: (chunk: string) => void,
  timeoutMs: number,
): Promise<{ code: number | null; error?: string }> {
  return new Promise((resolve) => {
    const id = WINGET_ID[kind];
    const args = ['install', '--id', id, '-e', '--accept-source-agreements', '--accept-package-agreements'];
    const proc = spawn('winget', args, { shell: true, windowsHide: true });
    let settled = false;
    const done = (r: { code: number | null; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const feed = (d: Buffer) => onData(d.toString('utf8'));
    proc.stdout.on('data', feed);
    proc.stderr.on('data', feed);
    proc.on('error', (err) => done({ code: null, error: err.message }));
    proc.on('close', (code) => done({ code }));
    setTimeout(() => {
      if (!settled) {
        proc.kill();
        done({ code: null, error: 'timeout' });
      }
    }, timeoutMs);
  });
}

// 下载文件到临时目录（跟随重定向）
function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u: string) => {
      https.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.destroy();
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          res.destroy();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      }).on('error', reject);
    };
    get(url);
  });
}

// 回退方案：下载官方安装包静默安装
// Python: /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1
// Node.js: msiexec /i ... /qn
async function installViaDownload(
  kind: RuntimeKind,
  onData: (chunk: string) => void,
  timeoutMs: number,
): Promise<{ code: number | null; error?: string }> {
  return new Promise((resolve) => {
    (async () => {
      const tmp = os.tmpdir();
      const log = (s: string) => onData(s + '\r\n');
      try {
        if (kind === 'python') {
          // python.org 官方稳定版 3.12.7（embeddable 不含 pip，用 installer）
          const url = 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe';
          const dest = path.join(tmp, 'python-3.12.7-installer.exe');
          log('正在下载 Python 安装包…');
          await download(url, dest);
          log('下载完成，正在静默安装（可能需要 1-2 分钟）…');
          const proc = spawn(dest, ['/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_pip=1'], {
            windowsHide: true,
          });
          proc.on('close', (code) => resolve({ code }));
          proc.on('error', (err) => resolve({ code: null, error: err.message }));
          setTimeout(() => {
            proc.kill();
            resolve({ code: null, error: 'timeout' });
          }, timeoutMs);
        } else {
          // nodejs.org LTS v20.18.0
          const url = 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi';
          const dest = path.join(tmp, 'node-v20.18.0-x64.msi');
          log('正在下载 Node.js 安装包…');
          await download(url, dest);
          log('下载完成，正在静默安装（可能需要 1-2 分钟）…');
          const proc = spawn('msiexec', ['/i', dest, '/qn', '/norestart'], { windowsHide: true });
          proc.on('close', (code) => resolve({ code }));
          proc.on('error', (err) => resolve({ code: null, error: err.message }));
          setTimeout(() => {
            proc.kill();
            resolve({ code: null, error: 'timeout' });
          }, timeoutMs);
        }
      } catch (err) {
        resolve({ code: null, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
}

// 统一入口：winget 优先，不可用则下载安装包
export function installRuntime(
  kind: RuntimeKind,
  onData: (chunk: string) => void,
  timeoutMs = 600_000,
): Promise<{ code: number | null; error?: string; via: 'winget' | 'download' }> {
  return new Promise(async (resolve) => {
    const wingetOk = await checkWinget();
    if (wingetOk) {
      const r = await installViaWinget(kind, onData, timeoutMs);
      resolve({ ...r, via: 'winget' });
    } else {
      const r = await installViaDownload(kind, onData, timeoutMs);
      resolve({ ...r, via: 'download' });
    }
  });
}
