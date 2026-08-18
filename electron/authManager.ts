// 账号与密钥管理：登录状态检测、safeStorage 加密存储、env 注入、官方登录流程拉起
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openTerminalWithCommand } from './terminal';
import { store } from './taskStore';
import type { CliId, CliAuthStatus, AuthSource } from './shared';

export type { AuthSource, CliAuthStatus };

// 各 CLI 的 API key 环境变量名与官方登录命令
const KEY_ENV: Partial<Record<CliId, string>> = {
  claude: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  codex: 'OPENAI_API_KEY',
  qwen: 'BAILIAN_CODING_PLAN_API_KEY',
  dsh: 'DEEPSEEK_API_KEY',
  pi: 'PI_API_KEY',
  hermes: 'NOUS_API_KEY',
  // kimi 走 OAuth/设备码，无通用 key env，不注入
};

const LOGIN_CMD: Partial<Record<CliId, string>> = {
  kimi: 'kimi login',
  claude: 'claude login',
  gemini: 'gemini auth login',
  codex: 'codex login',
  // qwen 无登录命令：OAuth 已停用，仅 API Key（BAILIAN_CODING_PLAN_API_KEY）
};

const home = () => os.homedir();

// 凭证文件探测（返回存在的路径或 null）
function firstExisting(candidates: string[]): string | null {
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

// 应用内保存的 key（safeStorage 加密后的 base64，存于 electron-store）
interface KeyStore {
  apiKeys: Partial<Record<CliId, string>>;
}

function getStoredKeys(): KeyStore['apiKeys'] {
  return (store.get('apiKeys' as never) ?? {}) as KeyStore['apiKeys'];
}

export function saveApiKey(cli: CliId, key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption unavailable on this system');
  }
  const encrypted = safeStorage.encryptString(key).toString('base64');
  const keys = { ...getStoredKeys(), [cli]: encrypted };
  store.set('apiKeys' as never, keys as never);
}

export function clearApiKey(cli: CliId): void {
  const keys = { ...getStoredKeys() };
  delete keys[cli];
  store.set('apiKeys' as never, keys as never);
}

// 解密应用内 key（失败视为不存在）
function readAppKey(cli: CliId): string | null {
  const encrypted = getStoredKeys()[cli];
  if (!encrypted) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return null;
  }
}

// 检测单个 CLI 的登录/配置状态
export function detectAuth(cli: CliId): CliAuthStatus {
  // 1. 应用内密钥优先
  if (KEY_ENV[cli] && readAppKey(cli)) {
    return { source: 'app-key', detail: KEY_ENV[cli]! };
  }
  // 2. 进程环境变量
  const envName = KEY_ENV[cli];
  if (envName && process.env[envName]) {
    return { source: 'env', detail: envName };
  }
  // 3. CLI 自身登录凭证
  switch (cli) {
    case 'kimi': {
      const cred = firstExisting([
        path.join(home(), '.kimi-code', 'credentials', 'kimi-code.json'),
      ]);
      if (cred) {
        try {
          const parsed = JSON.parse(fs.readFileSync(cred, 'utf8')) as Record<string, unknown>;
          if (parsed.access_token) return { source: 'logged-in', detail: cred };
        } catch {
          /* 文件损坏视为未登录 */
        }
      }
      return { source: 'none', detail: '' };
    }
    case 'claude': {
      const cred = firstExisting([path.join(home(), '.claude', '.credentials.json')]);
      return cred ? { source: 'logged-in', detail: cred } : { source: 'none', detail: '' };
    }
    case 'gemini': {
      const cred = firstExisting([
        path.join(home(), '.gemini', 'oauth_creds.json'),
        path.join(home(), '.gemini', 'google_accounts.json'),
      ]);
      return cred ? { source: 'logged-in', detail: cred } : { source: 'none', detail: '' };
    }
    case 'qwen': {
      // gemini-cli fork 同款凭证路径
      const cred = firstExisting([path.join(home(), '.qwen', 'oauth_creds.json')]);
      return cred ? { source: 'logged-in', detail: cred } : { source: 'none', detail: '' };
    }
    case 'codex': {
      const cred = firstExisting([path.join(home(), '.codex', 'auth.json')]);
      return cred ? { source: 'logged-in', detail: cred } : { source: 'none', detail: '' };
    }
    case 'pi': {
      // Pi 使用 ~/.pi/settings.json 或环境变量 PI_API_KEY
      const cred = firstExisting([path.join(home(), '.pi', 'settings.json')]);
      return cred ? { source: 'logged-in', detail: cred } : { source: 'none', detail: '' };
    }
    case 'dsh': {
      // dsh 的凭证文件：~/.dsh/.credentials.yaml（YAML 键值，含 DEEPSEEK_API_KEY）
      // 用户在 dsh web 里配置的 key 直接识别，无需在应用内重复填
      const credFile = path.join(home(), '.dsh', '.credentials.yaml');
      try {
        if (fs.existsSync(credFile)) {
          const text = fs.readFileSync(credFile, 'utf8');
          const m = /^DEEPSEEK_API_KEY:\s*(\S+)\s*$/m.exec(text);
          if (m?.[1]) return { source: 'logged-in', detail: credFile };
        }
      } catch {
        // 读取失败按未配置处理
      }
      return { source: 'none', detail: '' };
    }
    default:
      // qwen / opencode / aider：仅支持 env / 应用内 key（上方已处理）
      return { source: 'none', detail: '' };
  }
}

export function detectAllAuth(): Record<CliId, CliAuthStatus> {
  return {
    kimi: detectAuth('kimi'),
    claude: detectAuth('claude'),
    gemini: detectAuth('gemini'),
    codex: detectAuth('codex'),
    qwen: detectAuth('qwen'),
    opencode: detectAuth('opencode'),
    aider: detectAuth('aider'),
    pi: detectAuth('pi'),
    hermes: detectAuth('hermes'),
    dsh: detectAuth('dsh'),
  };
}

// 组装 headless 子进程的额外 env：应用内 key 优先于进程环境变量
export function envFor(cli: CliId): Record<string, string> {
  const envName = KEY_ENV[cli];
  if (!envName) return {};
  const key = readAppKey(cli);
  return key ? { [envName]: key } : {};
}

// 拉起官方交互式登录：系统终端窗口中执行，用户完成后回应用点刷新
export function launchLogin(cli: CliId): { ok: boolean; message: string } {
  const cmd = LOGIN_CMD[cli];
  if (!cmd) return { ok: false, message: `该 CLI 不支持登录命令 (${cli})` };
  return openTerminalWithCommand(cmd);
}

// app 就绪前 safeStorage 不可用，此处仅为类型导出占位
export function isEncryptionAvailable(): boolean {
  return app.isReady() && safeStorage.isEncryptionAvailable();
}
