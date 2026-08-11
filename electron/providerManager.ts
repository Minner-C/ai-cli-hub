// 供应商预设管理（CC Switch 等价能力）：
// 通过注入 ANTHROPIC_BASE_URL/AUTH_TOKEN（claude）、OPENAI_BASE_URL/API_KEY（codex）
// 让 CLI 走其他 Anthropic/OpenAI 兼容端点。预设 key 用 safeStorage 加密存储。
// 优先级：供应商预设 > 应用内 key > 进程环境变量。
// 不破坏外部配置：检测到 ~/.claude/settings.json 已有 env 配置时显示「外部配置」预设且不注入。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeStorage } from 'electron';
import { store } from './taskStore';
import type { CliId, ProviderPreset, ProviderState, AppSettings } from './shared';

// 各 CLI 的内置预设
const PRESETS: Partial<Record<CliId, ProviderPreset[]>> = {
  claude: [
    { id: 'official', name: 'Anthropic 官方', baseUrl: '', envBaseUrl: 'ANTHROPIC_BASE_URL', envKey: 'ANTHROPIC_AUTH_TOKEN' },
    { id: 'glm', name: 'GLM (z.ai)', baseUrl: 'https://open.bigmodel.cn/api/anthropic', envBaseUrl: 'ANTHROPIC_BASE_URL', envKey: 'ANTHROPIC_AUTH_TOKEN' },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', envBaseUrl: 'ANTHROPIC_BASE_URL', envKey: 'ANTHROPIC_AUTH_TOKEN' },
    { id: 'qwen-provider', name: 'Qwen (阿里云百炼)', baseUrl: 'https://dashscope.aliyuncs.com/api/v2', envBaseUrl: 'ANTHROPIC_BASE_URL', envKey: 'ANTHROPIC_AUTH_TOKEN' },
    { id: 'kimi-provider', name: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/anthropic', envBaseUrl: 'ANTHROPIC_BASE_URL', envKey: 'ANTHROPIC_AUTH_TOKEN' },
  ],
  codex: [
    { id: 'official', name: 'OpenAI 官方', baseUrl: '', envBaseUrl: 'OPENAI_BASE_URL', envKey: 'OPENAI_API_KEY' },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', envBaseUrl: 'OPENAI_BASE_URL', envKey: 'OPENAI_API_KEY' },
    { id: 'glm', name: 'GLM (z.ai)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', envBaseUrl: 'OPENAI_BASE_URL', envKey: 'OPENAI_API_KEY' },
  ],
};

export function providerSupported(cli: CliId): boolean {
  return cli in PRESETS;
}

// ---- key 存储（safeStorage 加密，按 presetId 存）----
type KeyMap = Record<string, string>; // presetId -> encrypted base64

function getProviderKeys(): KeyMap {
  return (store.get('providerKeys' as never) ?? {}) as KeyMap;
}

export function saveProviderKey(presetId: string, key: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable');
  const keys = { ...getProviderKeys() };
  keys[presetId] = safeStorage.encryptString(key).toString('base64');
  store.set('providerKeys' as never, keys as never);
}

function readProviderKey(presetId: string): string | null {
  const enc = getProviderKeys()[presetId];
  if (!enc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

// ---- 外部配置检测（不覆盖用户已有的 CC Switch/手写配置）----
function detectExternal(cli: CliId): ProviderPreset | null {
  if (cli === 'claude') {
    try {
      const raw = fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8');
      const settings = JSON.parse(raw) as { env?: Record<string, string> };
      const baseUrl = settings.env?.ANTHROPIC_BASE_URL;
      if (baseUrl) {
        return {
          id: 'external',
          name: '外部配置 (settings.json)',
          baseUrl,
          envBaseUrl: 'ANTHROPIC_BASE_URL',
          envKey: 'ANTHROPIC_AUTH_TOKEN',
          external: true,
        };
      }
    } catch {
      /* 无文件或解析失败 */
    }
  }
  return null;
}

function customPresets(cli: CliId, settings: AppSettings): ProviderPreset[] {
  return (settings.customProviders ?? []).filter((p) => p.id.startsWith(`${cli}:`));
}

export function getProviderState(cli: CliId, settings: AppSettings): ProviderState {
  const builtin = PRESETS[cli] ?? [];
  const external = detectExternal(cli);
  const customs = customPresets(cli, settings);
  const presets = [...(external ? [external] : []), ...builtin, ...customs];
  const activeId = settings.activeProviders?.[cli] ?? (external ? 'external' : 'official');
  const hasKey: Record<string, boolean> = {};
  for (const p of presets) hasKey[p.id] = Boolean(readProviderKey(p.id)) || p.id === 'official' || p.external === true;
  return { presets, activeId, hasKey };
}

export function setActiveProvider(cli: CliId, presetId: string, settings: AppSettings): void {
  store.set('settings', {
    ...settings,
    activeProviders: { ...settings.activeProviders, [cli]: presetId },
  });
}

export function saveCustomProvider(cli: CliId, preset: ProviderPreset, settings: AppSettings): void {
  const customs = (settings.customProviders ?? []).filter((p) => p.id !== preset.id);
  customs.push({ ...preset, id: `${cli}:${preset.id}`, custom: true });
  store.set('settings', { ...settings, customProviders: customs });
}

// ---- spawn env 注入：返回应注入的环境变量（预设生效且有 key/baseUrl 时）----
export function providerEnv(cli: CliId, settings: AppSettings): Record<string, string> {
  const state = getProviderState(cli, settings);
  const preset = state.presets.find((p) => p.id === state.activeId);
  if (!preset || preset.id === 'official' || preset.external) return {};
  const env: Record<string, string> = {};
  if (preset.baseUrl) env[preset.envBaseUrl] = preset.baseUrl;
  const key = readProviderKey(preset.id);
  if (key) env[preset.envKey] = key;
  return env;
}
