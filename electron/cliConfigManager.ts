// CLI 配置管理：各 CLI 配置文件的读写（原文编辑 + 表单字段）、校验、备份恢复、版本检测与更新
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { openTerminalWithCommand, checkToolAvailable } from './terminal';
import * as TOML from 'smol-toml';
import * as yaml from 'js-yaml';
import type { CliId } from './shared';

export type ConfigFormat = 'toml' | 'json' | 'yml';

interface ConfigFileDef {
  relPath: string;
  format: ConfigFormat;
}

// 各 CLI 的配置文件（不存在的按新建处理）
const CONFIG_FILES: Partial<Record<CliId, ConfigFileDef>> = {
  kimi: { relPath: '.kimi-code/config.toml', format: 'toml' },
  claude: { relPath: '.claude/settings.json', format: 'json' },
  gemini: { relPath: '.gemini/settings.json', format: 'json' },
  codex: { relPath: '.codex/config.toml', format: 'toml' },
  qwen: { relPath: '.qwen/settings.json', format: 'json' },
  pi: { relPath: '.pi/agent/settings.json', format: 'json' },
  opencode: { relPath: '.config/opencode/opencode.json', format: 'json' },
  aider: { relPath: '.aider.conf.yml', format: 'yml' },
  hermes: { relPath: '.hermes/config.yaml', format: 'yml' },
};

export function configPathOf(cli: CliId): string | null {
  const def = CONFIG_FILES[cli];
  return def ? path.join(os.homedir(), def.relPath) : null;
}

export interface RawConfig {
  exists: boolean;
  content: string;
  format: ConfigFormat | null;
  path: string | null;
}

export function readConfigRaw(cli: CliId): RawConfig {
  const p = configPathOf(cli);
  const def = CONFIG_FILES[cli];
  if (!p || !def) return { exists: false, content: '', format: null, path: null };
  try {
    return { exists: true, content: fs.readFileSync(p, 'utf8'), format: def.format, path: p };
  } catch {
    return { exists: false, content: '', format: def.format, path: p };
  }
}

// 校验并返回错误信息（含行号）；null 表示通过
export function validateConfig(format: ConfigFormat, content: string): string | null {
  try {
    if (format === 'json') {
      JSON.parse(content);
    } else if (format === 'yml') {
      yaml.load(content);
    } else {
      TOML.parse(content);
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // smol-toml / JSON.parse 的错误信息一般含行号
    const lineMatch = msg.match(/line\s*(\d+)|position\s*(\d+)/i);
    if (lineMatch) return `line ${lineMatch[1] ?? lineMatch[2]}: ${msg}`;
    // Node 新版 JSON.parse 不报行号：用 "Unexpected token 'X'" 的 token 回查行
    const tokenMatch = msg.match(/Unexpected token '(.?)'/);
    if (tokenMatch) {
      const idx = content.split('\n').findIndex((l) => l.includes(tokenMatch[1]));
      if (idx >= 0) return `line ${idx + 1}: ${msg}`;
    }
    return msg;
  }
}

// 写入前校验 + 备份（.bak），校验失败抛错不写入
export function writeConfigRaw(cli: CliId, content: string): void {
  const raw = readConfigRaw(cli);
  if (!raw.path || !raw.format) throw new Error(`no config file mapping for ${cli}`);
  const error = validateConfig(raw.format, content);
  if (error) throw new Error(error);
  fs.mkdirSync(path.dirname(raw.path), { recursive: true });
  if (raw.exists) {
    fs.copyFileSync(raw.path, raw.path + '.bak');
  }
  fs.writeFileSync(raw.path, content, 'utf8');
}

export function hasConfigBackup(cli: CliId): boolean {
  const p = configPathOf(cli);
  return p ? fs.existsSync(p + '.bak') : false;
}

export function restoreConfigBackup(cli: CliId): void {
  const p = configPathOf(cli);
  if (!p || !fs.existsSync(p + '.bak')) throw new Error('no backup found');
  fs.copyFileSync(p + '.bak', p);
}

// ---- 表单字段读写（解析-修改-写回，保留其他字段）----
export function readConfigDoc(cli: CliId): Record<string, unknown> {
  const raw = readConfigRaw(cli);
  if (!raw.exists || !raw.format) return {};
  try {
    if (raw.format === 'json') return JSON.parse(raw.content) as Record<string, unknown>;
    if (raw.format === 'yml') return yaml.load(raw.content) as Record<string, unknown> ?? {};
    return TOML.parse(raw.content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeConfigFields(cli: CliId, patch: Record<string, unknown>): void {
  const raw = readConfigRaw(cli);
  if (!raw.format || !raw.path) throw new Error(`no config file mapping for ${cli}`);
  const doc = readConfigDoc(cli);
  // 浅合并一层（表单字段按顶层/一级嵌套路径给出）
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete doc[key];
    else doc[key] = value;
  }
  const content =
    raw.format === 'json'
      ? JSON.stringify(doc, null, 2) + '\n'
      : raw.format === 'yml'
        ? yaml.dump(doc, { lineWidth: -1 })
        : TOML.stringify(doc as Parameters<typeof TOML.stringify>[0]);
  writeConfigRaw(cli, content);
}

// 按点分路径读取嵌套字段（如 "tools.approvalMode"）
export function readConfigNestedField(cli: CliId, fieldPath: string): unknown {
  const doc = readConfigDoc(cli);
  const parts = fieldPath.split('.');
  let cur: unknown = doc;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

// 按点分路径写入嵌套字段（保留其他字段）
export function writeConfigNestedField(cli: CliId, fieldPath: string, value: unknown): void {
  const raw = readConfigRaw(cli);
  if (!raw.format || !raw.path) throw new Error(`no config file mapping for ${cli}`);
  const doc = readConfigDoc(cli);
  const parts = fieldPath.split('.');
  let cur: Record<string, unknown> = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || cur[parts[i]] === null || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  if (value === undefined) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = value;
  const content =
    raw.format === 'json'
      ? JSON.stringify(doc, null, 2) + '\n'
      : raw.format === 'yml'
        ? yaml.dump(doc, { lineWidth: -1 })
        : TOML.stringify(doc as Parameters<typeof TOML.stringify>[0]);
  writeConfigRaw(cli, content);
}

// ---- 版本检测 ----
const versionCache = new Map<CliId, { version: string; ts: number }>();

export function detectCliVersion(
  cli: CliId,
  executable: { file: string; argsPrefix: string[] },
): Promise<string | null> {
  const cached = versionCache.get(cli);
  if (cached && Date.now() - cached.ts < 300_000) return Promise.resolve(cached.version);
  return new Promise((resolve) => {
    execFile(
      executable.file,
      [...executable.argsPrefix, '--version'],
      { timeout: 15_000, windowsHide: true },
      (err, stdout, stderr) => {
        const text = (stdout + stderr).trim();
        const match = text.match(/(\d+\.\d+(?:\.\d+)?)/);
        const version = !err && match ? match[1] : null;
        if (version) versionCache.set(cli, { version, ts: Date.now() });
        resolve(version);
      },
    );
  });
}

// ---- 更新 ----
// npm 系包名；kimi 用 kimi upgrade（交互式，终端弹窗）；aider 用 pip
const NPM_PACKAGES: Partial<Record<CliId, string>> = {
  kimi: '@moonshot-ai/kimi-cli',
  claude: '@anthropic-ai/claude-code',
  gemini: '@google/gemini-cli',
  codex: '@openai/codex',
  qwen: '@qwen-code/qwen-code',
  opencode: 'opencode-ai',
  pi: '@earendil-works/pi-coding-agent',
};

// pip 国内镜像源（避免访问 files.pythonhosted.org 超时）+ 延长超时
const PIP_MIRROR_ARGS = '-i https://pypi.tuna.tsinghua.edu.cn/simple --default-timeout=300';

// pip 包名（用于 pip 系 CLI 的版本检查）
const PIP_PACKAGES: Partial<Record<CliId, string>> = {
  aider: 'aider-chat',
  hermes: 'hermes-agent',
};

export function npmPackageOf(cli: CliId): string | null {
  return NPM_PACKAGES[cli] ?? null;
}

export function checkLatestVersion(cli: CliId): Promise<string | null> {
  const npmPkg = NPM_PACKAGES[cli];
  if (npmPkg) {
    return new Promise((resolve) => {
      execFile('npm', ['view', npmPkg, 'version'], { timeout: 30_000, windowsHide: true }, (err, stdout) => {
        resolve(err ? null : stdout.trim() || null);
      });
    });
  }
  const pipPkg = PIP_PACKAGES[cli];
  if (pipPkg) {
    // pip index versions <pkg> 输出形如：aider-chat (0.x.x)；旧版 pip 用 pip install <pkg>== 末尾报错列出可选版本
    return new Promise((resolve) => {
      execFile('pip', ['index', 'versions', pipPkg, PIP_MIRROR_ARGS], { timeout: 30_000, windowsHide: true }, (err, stdout) => {
        if (err) {
          // 旧版 pip 无 index 子命令，回退到 pip install <pkg>== 抓取报错中的版本列表
          execFile('pip', ['install', `${pipPkg}==`], { timeout: 30_000, windowsHide: true }, (_e, _o, stderr) => {
            const m = stderr.match(/from versions:\s*([0-9.,\s]+?)(?:\))/);
            if (m) {
              const vers = m[1].split(',').map((s) => s.trim()).filter(Boolean);
              resolve(vers.length ? vers[vers.length - 1] : null);
            } else resolve(null);
          });
          return;
        }
        const m = stdout.match(/Available versions:\s*([0-9.,\s]+)/);
        if (m) {
          const vers = m[1].split(',').map((s) => s.trim()).filter(Boolean);
          resolve(vers.length ? vers[0] : null);
          return;
        }
        const lineMatch = stdout.match(new RegExp(`${pipPkg}\\s*\\(([^)]+)\\)`));
        resolve(lineMatch ? lineMatch[1].trim() : null);
      });
    });
  }
  return Promise.resolve(null);
}

// 应用安装目录下的 CLI 二进制目录：npm --prefix 安装目标，便于便携化管理
// 打包后 process.resourcesPath 指向 resources/ 目录；开发期回退到项目根
import { app } from 'electron';
export function getCliBinDir(): string {
  const base = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : process.cwd();
  return path.join(base, 'cli-bin');
}

// npm 全局安装前缀参数：装到应用目录下 cli-bin，避免散落系统目录
function npmPrefixArg(): string {
  return `--prefix "${getCliBinDir()}"`;
}

// 系统终端弹窗执行更新命令
export async function runUpdateInTerminal(cli: CliId): Promise<{ ok: boolean; message: string }> {
  let cmd: string;
  let tool: 'npm' | 'pip' = 'npm';
  const pkg = NPM_PACKAGES[cli];
  if (cli === 'kimi') cmd = 'kimi upgrade';
  else if (cli === 'aider') {
    cmd = `pip install --upgrade aider-chat ${PIP_MIRROR_ARGS}`;
    tool = 'pip';
  } else if (cli === 'hermes') {
    cmd = `pip install --upgrade hermes-agent ${PIP_MIRROR_ARGS}`;
    tool = 'pip';
  } else if (pkg) cmd = `npm update -g ${pkg} ${npmPrefixArg()}`;
  else return { ok: false, message: 'no update command for this CLI' };
  const avail = await checkToolAvailable(tool);
  if (!avail.ok) return avail;
  openTerminalWithCommand(cmd);
  return { ok: true, message: '' };
}

// 各 CLI 的一键安装命令（系统终端弹窗执行）
// npm 系用 --prefix 装到应用目录下 cli-bin，便于便携化管理
// aider / hermes 使用清华镜像源避免 PyPI 官方源超时
const INSTALL_CMD: Partial<Record<CliId, string>> = {
  claude: `npm install -g @anthropic-ai/claude-code ${npmPrefixArg()}`,
  gemini: `npm install -g @google/gemini-cli ${npmPrefixArg()}`,
  codex: `npm install -g @openai/codex ${npmPrefixArg()}`,
  qwen: `npm install -g @qwen-code/qwen-code ${npmPrefixArg()}`,
  opencode: `npm install -g opencode-ai@latest ${npmPrefixArg()}`,
  aider: `pip install aider-chat ${PIP_MIRROR_ARGS}`,
  pi: `npm install -g @earendil-works/pi-coding-agent ${npmPrefixArg()}`,
  hermes: `pip install hermes-agent ${PIP_MIRROR_ARGS}`,
};

export function installCommandOf(cli: CliId): string | null {
  return INSTALL_CMD[cli] ?? null;
}

// 更新命令（应用内执行，非交互）
export function updateCommandOf(cli: CliId): string | null {
  const pkg = NPM_PACKAGES[cli];
  if (cli === 'kimi') return 'kimi upgrade';
  if (cli === 'aider') return `pip install --upgrade aider-chat ${PIP_MIRROR_ARGS}`;
  if (cli === 'hermes') return `pip install --upgrade hermes-agent ${PIP_MIRROR_ARGS}`;
  return pkg ? `npm update -g ${pkg} ${npmPrefixArg()}` : null;
}

export async function runInstallInTerminal(cli: CliId): Promise<{ ok: boolean; message: string }> {
  const cmd = INSTALL_CMD[cli];
  if (!cmd) return { ok: false, message: 'no install command for this CLI' };
  const tool = cli === 'aider' || cli === 'hermes' ? 'pip' : 'npm';
  const avail = await checkToolAvailable(tool);
  if (!avail.ok) return avail;
  openTerminalWithCommand(cmd);
  return { ok: true, message: '' };
}
