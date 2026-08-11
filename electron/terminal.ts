// 系统终端弹窗执行命令（安装/登录/更新统一入口）
// 最终方案（Electron 主进程环境实测）：
//   cmd.exe /c start "" <bat> —— start 显式空标题（规避引号陷阱），bat 写临时文件
//   （规避 >、&& 被外层解析；WindowsApps 的 wt.exe alias 在 Electron 环境静默失败，弃用；
//   explorer.exe 打开 bat 在「默认终端=Windows Terminal」环境会错把 bat 内容当命令行，弃用）
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 在系统终端窗口中执行命令（窗口保持打开，用户可见输出）
export function openTerminalWithCommand(command: string): { ok: boolean; message: string } {
  if (process.platform !== 'win32') {
    const child = spawn('x-terminal-emulator', ['-e', command], { detached: true, stdio: 'ignore' });
    child.on('error', (e) => console.error('[terminal] spawn error:', e.message));
    child.unref();
    return { ok: true, message: '' };
  }

  try {
    const bat = path.join(os.tmpdir(), `ai-cli-hub-cmd-${Date.now()}.bat`);
    fs.writeFileSync(bat, `@echo off\r\n${command}\r\ncmd /k\r\n`, 'utf8');
    // start "" = 显式空标题参数；bat 路径无空格无需引号
    const child = spawn('cmd.exe', ['/c', 'start', '""', bat], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', (e) => console.error('[terminal] spawn error:', e.message));
    child.unref();
    return { ok: true, message: '' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function which(cmd: string): Promise<boolean> {
  const tool = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(tool, [cmd], (err) => resolve(!err));
  });
}

// 前置检查：npm/pip 是否在 PATH（不存在时返回可读提示，不弹窗）
export async function checkToolAvailable(tool: 'npm' | 'pip'): Promise<{ ok: boolean; message: string }> {
  const found = await which(tool);
  return found
    ? { ok: true, message: '' }
    : { ok: false, message: `${tool} 不在 PATH 中，请先安装 ${tool === 'npm' ? 'Node.js' : 'Python'}` };
}
