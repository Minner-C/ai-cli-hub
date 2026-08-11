// CLI 适配器：各 AI CLI 的可执行名、安装检测、启动参数与摘要提取策略
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CliId, CliInfo, AppSettings } from './shared';
import { getCliBinDir } from './cliConfigManager';

interface CliAdapter {
  id: CliId;
  displayName: string;
  executable: string;
  installHint: string;
  args: () => string[];
  // 摘要提取策略：优先尝试的“CLI 自身导出能力”prompt
  summaryPrompt: string;
}

const isWin = process.platform === 'win32';

export const CLI_ADAPTERS: Record<CliId, CliAdapter> = {
  kimi: {
    id: 'kimi',
    displayName: 'Kimi Code CLI',
    executable: 'kimi',
    installHint: 'npm install -g @moonshot-ai/kimi-cli  (或参考 https://github.com/MoonshotAI/kimi-cli)',
    args: () => [],
    summaryPrompt: '请用约200字总结当前进展、关键决定和待办，用纯文本输出，不要使用工具。',
  },
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    executable: 'claude',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    args: () => [],
    summaryPrompt: 'Please summarize in ~200 words: current progress, key decisions, and pending tasks. Plain text only, no tools.',
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini CLI',
    executable: 'gemini',
    installHint: 'npm install -g @google/gemini-cli',
    args: () => [],
    summaryPrompt: 'Please summarize in ~200 words: current progress, key decisions, and pending tasks. Plain text only, no tools.',
  },
  codex: {
    id: 'codex',
    displayName: 'Codex CLI',
    executable: 'codex',
    installHint: 'npm install -g @openai/codex',
    args: () => [],
    summaryPrompt: 'Please summarize in ~200 words: current progress, key decisions, and pending tasks. Plain text only, no tools.',
  },
  qwen: {
    id: 'qwen',
    displayName: 'Qwen Code',
    executable: 'qwen',
    installHint: 'npm install -g @qwen-code/qwen-code',
    args: () => [],
    summaryPrompt: 'Please summarize in ~200 words: current progress, key decisions, and pending tasks. Plain text only, no tools.',
  },
  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    executable: 'opencode',
    installHint: 'npm install -g opencode-ai',
    args: () => [],
    summaryPrompt: 'Please summarize in ~200 words: current progress, key decisions, and pending tasks. Plain text only, no tools.',
  },
  aider: {
    id: 'aider',
    displayName: 'Aider',
    executable: 'aider',
    installHint: 'pip install aider-chat',
    args: () => [],
    summaryPrompt: 'Please summarize in ~200 words: current progress, key decisions, and pending tasks. Plain text only, no tools.',
  },
  pi: {
    id: 'pi',
    displayName: 'Pi',
    executable: 'pi',
    installHint: 'npm install -g @earendil-works/pi-coding-agent',
    args: () => [],
    summaryPrompt: 'Please summarize in ~200 words: current progress, key decisions, and pending tasks. Plain text only, no tools.',
  },
  hermes: {
    id: 'hermes',
    displayName: 'Hermes Agent',
    executable: 'hermes',
    installHint: 'pipx install hermes-agent  (或参考 https://hermes-agent.nousresearch.com/docs)',
    args: () => [],
    summaryPrompt: 'Please summarize in ~200 words: current progress, key decisions, and pending tasks. Plain text only, no tools.',
  },
};

// 用 where (Windows) / which (POSIX) 检测可执行文件位置
export function whichLike(cmd: string): Promise<string | null> {
  const tool = isWin ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(tool, [cmd], (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const candidates = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (candidates.length === 0) {
        resolve(null);
        return;
      }
      if (isWin) {
        // where 会同时返回无扩展名脚本和 .cmd/.exe，Windows 只能直接执行 PATHEXT 内的类型，
        // 优先选 .exe，其次 .cmd/.bat，最后才退回第一个候选
        const preferred =
          candidates.find((p) => /\.exe$/i.test(p)) ??
          candidates.find((p) => /\.(cmd|bat)$/i.test(p));
        resolve(preferred ?? candidates[0]);
        return;
      }
      resolve(candidates[0]);
    });
  });
}

// 在应用目录下 cli-bin 查找可执行文件（npm --prefix 安装目标）
// npm --prefix 安装后可执行文件位于 <prefix>/node_modules/.bin/ 或 <prefix>/ 根目录
function findInCliBin(cmd: string): string | null {
  const binDir = getCliBinDir();
  const candidates = isWin
    ? [path.join(binDir, `${cmd}.cmd`), path.join(binDir, `${cmd}.exe`), path.join(binDir, 'node_modules', '.bin', `${cmd}.cmd`)]
    : [path.join(binDir, cmd), path.join(binDir, 'node_modules', '.bin', cmd)];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // 忽略
    }
  }
  return null;
}

// 检测全部 CLI 的安装情况；自定义路径优先 → cli-bin 目录 → 系统 PATH
export async function detectClis(settings: AppSettings): Promise<CliInfo[]> {
  const ids = Object.keys(CLI_ADAPTERS) as CliId[];
  return Promise.all(
    ids.map(async (id) => {
      const adapter = CLI_ADAPTERS[id];
      const custom = settings.customPaths?.[id];
      let resolvedPath: string | null = null;
      if (custom) {
        resolvedPath = path.resolve(custom);
      } else {
        // 优先检测应用目录下 cli-bin，再回退系统 PATH
        resolvedPath = findInCliBin(adapter.executable) ?? await whichLike(adapter.executable);
      }
      return {
        id,
        displayName: adapter.displayName,
        executable: adapter.executable,
        installed: Boolean(resolvedPath),
        resolvedPath: resolvedPath ?? undefined,
        installHint: adapter.installHint,
      } satisfies CliInfo;
    }),
  );
}
