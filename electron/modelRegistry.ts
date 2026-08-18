// 统一模型注册表：全局模型列表，任意 CLI 都可调用
// 模型与 CLI 解耦：供应商管理多协议端点（OpenAI/Anthropic/Gemini），模型只管 modelId/品牌
import { safeStorage } from 'electron';
import { store } from './taskStore';
import type { CliId, ModelEntry, ModelProtocol, ModelRoute, AppSettings, ProviderEntry } from './shared';
import { selectProtocol } from './shared';

// 品牌预设（定义在 shared.ts，主进程/渲染进程共享）
export { BRAND_PRESETS } from './shared';

const ENTRIES_KEY = 'modelEntries';
const PROVIDER_KEYS_KEY = 'providerApiKeys'; // 供应商 API key 加密存储
const PROVIDERS_KEY = 'modelProviders';
const MIGRATED_KEY = 'modelEntriesMigrated';
const MIGRATED_V2_KEY = 'modelEntriesMigratedV2'; // V2: key 从 model 移到 provider
const MIGRATED_V3_KEY = 'modelEntriesMigratedV3'; // V3: provider 从 protocol+baseUrl 改为多协议端点
const BUILTIN_PURGED_KEY = 'modelEntriesBuiltinPurged';

// ---- 协议 → 环境变量名 ----
const PROTOCOL_ENV: Record<ModelProtocol, { envBaseUrl?: string; envKey: string }> = {
  anthropic: { envBaseUrl: 'ANTHROPIC_BASE_URL', envKey: 'ANTHROPIC_AUTH_TOKEN' },
  openai: { envBaseUrl: 'OPENAI_BASE_URL', envKey: 'OPENAI_API_KEY' },
  gemini: { envKey: 'GEMINI_API_KEY' },
};

// 从供应商读取指定协议的 baseUrl（空字符串 = 官方默认端点；undefined → '' 表示未配置）
export function providerBaseUrl(provider: ProviderEntry, protocol: ModelProtocol): string {
  switch (protocol) {
    case 'anthropic': return provider.baseUrlAnthropic ?? '';
    case 'openai': return provider.baseUrlOpenai ?? '';
    case 'gemini': return provider.baseUrlGemini ?? '';
  }
}

// ---- 供应商 API key 存储（safeStorage 加密）----
function getProviderKeys(): Record<string, string> {
  return (store.get(PROVIDER_KEYS_KEY as never) ?? {}) as Record<string, string>;
}

export function saveProviderKey(providerId: string, key: string): void {
  const keys = { ...getProviderKeys() };
  keys[providerId] = safeStorage.encryptString(key).toString('base64');
  store.set(PROVIDER_KEYS_KEY as never, keys as never);
}

export function readProviderKey(providerId: string): string | null {
  const enc = getProviderKeys()[providerId];
  if (!enc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

export function providerHasKey(providerId: string): boolean {
  return readProviderKey(providerId) !== null;
}

// ---- 模型列表读写 ----
export function listModelEntries(): ModelEntry[] {
  migrateV2IfNeeded();
  migrateV3IfNeeded();
  purgeBuiltinIfNeeded();
  return (store.get(ENTRIES_KEY as never) ?? []) as ModelEntry[];
}

function saveEntries(entries: ModelEntry[]): void {
  store.set(ENTRIES_KEY as never, entries as never);
}

export function saveModelEntry(entry: ModelEntry): void {
  const entries = listModelEntries().filter((e) => e.id !== entry.id);
  entries.push(entry);
  saveEntries(entries);
}

export function deleteModelEntry(id: string): void {
  saveEntries(listModelEntries().filter((e) => e.id !== id));
}

// ---- 供应商 CRUD ----
export function listProviders(): ProviderEntry[] {
  migrateV3IfNeeded();
  return (store.get(PROVIDERS_KEY as never) ?? []) as ProviderEntry[];
}

function saveProviders(providers: ProviderEntry[]): void {
  store.set(PROVIDERS_KEY as never, providers as never);
}

export function saveProvider(provider: ProviderEntry): void {
  const providers = listProviders().filter((p) => p.id !== provider.id);
  providers.push(provider);
  saveProviders(providers);
}

export function deleteProvider(id: string): void {
  saveProviders(listProviders().filter((p) => p.id !== id));
  // 删除供应商后，其下模型的 providerId 清空（归为未分组）
  const entries = listModelEntries().map((e) =>
    e.providerId === id ? { ...e, providerId: undefined } : e,
  );
  saveEntries(entries);
  // 清理供应商的 API key
  const keys = { ...getProviderKeys() };
  delete keys[id];
  store.set(PROVIDER_KEYS_KEY as never, keys as never);
}

// ---- V3 迁移：旧版 ProviderEntry 有 protocol+baseUrl，新版改为 baseUrlOpenai/baseUrlAnthropic/baseUrlGemini ----
function migrateV3IfNeeded(): void {
  if (store.get(MIGRATED_V3_KEY as never)) return;
  const providers = (store.get(PROVIDERS_KEY as never) ?? []) as Array<
    ProviderEntry & { protocol?: ModelProtocol; baseUrl?: string }
  >;
  let changed = false;
  const migrated = providers.map((p) => {
    if (p.protocol === undefined) return p; // 已是新格式
    changed = true;
    const proto = p.protocol;
    const url = p.baseUrl ?? '';
    const { protocol: _p, baseUrl: _b, ...rest } = p;
    const newProvider: ProviderEntry = { ...rest };
    if (proto === 'anthropic') newProvider.baseUrlAnthropic = url;
    else if (proto === 'openai') newProvider.baseUrlOpenai = url;
    else if (proto === 'gemini') newProvider.baseUrlGemini = url;
    return newProvider;
  });
  if (changed) {
    saveProviders(migrated);
  }
  store.set(MIGRATED_V3_KEY as never, true as never);
}

// ---- V2 迁移：旧版 ModelEntry 有 protocol/baseUrl，新版移到 ProviderEntry ----
function migrateV2IfNeeded(): void {
  if (store.get(MIGRATED_V2_KEY as never)) return;
  const entries = (store.get(ENTRIES_KEY as never) ?? []) as Array<ModelEntry & { protocol?: ModelProtocol; baseUrl?: string }>;
  const oldKeys = (store.get('modelEntryKeys' as never) ?? {}) as Record<string, string>;
  const providers = (store.get(PROVIDERS_KEY as never) ?? []) as Array<
    ProviderEntry & { protocol?: ModelProtocol; baseUrl?: string }
  >;
  const providerKeys = getProviderKeys();

  // 为每个有 protocol/baseUrl 的旧模型创建/复用供应商
  let migrated = entries.map((e) => {
    if (!e.protocol) return e; // 已是新格式
    const proto = e.protocol;
    const url = e.baseUrl ?? '';
    // 查找或创建匹配的供应商（兼容旧 protocol/baseUrl 格式）
    let provider = providers.find(
      (p) => p.protocol === proto && (p.baseUrl ?? '') === url,
    );
    if (!provider) {
      const id = `provider:${proto}-${url || 'default'}-${Date.now()}`;
      provider = {
        id,
        displayName: e.brand ?? proto,
        protocol: proto,
        baseUrl: url || undefined,
      };
      providers.push(provider);
    }
    // 迁移 API key
    const oldEnc = oldKeys[e.id];
    if (oldEnc) {
      providerKeys[provider.id] = oldEnc;
    }
    // 去掉旧字段
    const { protocol: _p, baseUrl: _b, ...rest } = e;
    return { ...rest, providerId: provider.id };
  }) as ModelEntry[];

  saveProviders(providers);
  store.set(PROVIDER_KEYS_KEY as never, providerKeys as never);
  saveEntries(migrated);
  store.set(MIGRATED_V2_KEY as never, true as never);
  // V3 迁移紧跟 V2：将新创建的旧格式 provider 转为多协议端点
  migrateV3IfNeeded();
}

// 旧供应商预设 → 统一模型列表（一次性迁移，已有数据与 key 不丢）
export function migrateIfNeeded(): void {
  if (store.get(MIGRATED_KEY as never)) return;
  const entries: ModelEntry[] = [];

  const settings = store.get('settings') as AppSettings;
  // 自定义预设（customProviders）迁移
  for (const p of settings.customProviders ?? []) {
    const protocol: ModelProtocol = p.envBaseUrl === 'OPENAI_BASE_URL' ? 'openai' : 'anthropic';
    entries.push({
      id: `custom:${p.id}`,
      displayName: p.name,
      modelId: '',
      protocol,
      baseUrl: p.baseUrl,
      enabled: true,
    } as ModelEntry & { protocol: ModelProtocol; baseUrl: string });
  }
  const providerKeys = (store.get('providerKeys' as never) ?? {}) as Record<string, string>;
  const keys = { ...(store.get('modelEntryKeys' as never) ?? {}) as Record<string, string> };
  for (const [presetId, enc] of Object.entries(providerKeys)) {
    keys[`custom:${presetId}`] = enc;
  }
  store.set('modelEntryKeys' as never, keys as never);

  saveEntries(entries);
  store.set(MIGRATED_KEY as never, true as never);
}

// 一次性清除历史版本遗留的 builtin 条目（旧版自动注入的内置预填）
function purgeBuiltinIfNeeded(): void {
  if (store.get(BUILTIN_PURGED_KEY as never)) return;
  const entries = (store.get(ENTRIES_KEY as never) ?? []) as Array<ModelEntry & { builtin?: boolean }>;
  const filtered = entries.filter((e) => !e.builtin);
  if (filtered.length !== entries.length) {
    saveEntries(filtered);
  }
  store.set(BUILTIN_PURGED_KEY as never, true as never);
}

// ---- 路由解析：按 CLI 协议优先级从供应商选择端点，返回 env 注入信息 ----
export function resolveModelRoute(entry: ModelEntry, provider: ProviderEntry | undefined, cli: CliId): ModelRoute {
  if (!provider) {
    return { modelId: entry.modelId, protocol: 'openai' };
  }
  const protocol = selectProtocol(cli, provider);
  if (!protocol) {
    return { modelId: entry.modelId, protocol: 'openai' };
  }
  const env = PROTOCOL_ENV[protocol];
  return {
    modelId: entry.modelId,
    protocol,
    baseUrl: providerBaseUrl(provider, protocol),
    envBaseUrl: env.envBaseUrl,
    envKey: env.envKey,
  };
}

// 智能 URL 修正：火山引擎方舟的 anthropic 与 openai 端点路径不同，用户常误配
//   anthropic 协议：https://ark.cn-beijing.volces.com/api/coding  或  /api/compatible
//   openai 协议：    https://ark.cn-beijing.volces.com/api/coding/v3  或  /api/v3
// 当协议与端点路径不匹配时，自动转换到对应协议的正确端点
export function normalizeBaseUrl(baseUrl: string, protocol: ModelProtocol): string {
  const url = (baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!url.includes('volces.com')) return url;
  if (protocol === 'anthropic') {
    if (url.endsWith('/api/coding/v3')) return url.replace(/\/api\/coding\/v3$/, '/api/coding');
    if (url.endsWith('/api/v3')) return url.replace(/\/api\/v3$/, '/api/compatible');
  } else if (protocol === 'openai') {
    if (url.endsWith('/api/coding') && !url.endsWith('/api/coding/v3')) return url + '/v3';
    if (url.endsWith('/api/compatible')) return url.replace(/\/api\/compatible$/, '/api/v3');
  }
  return url;
}

// 组装 spawn 时应注入的 env（按 CLI 协议优先级从供应商读取 baseUrl + 解密 key）
export function routeEnv(entry: ModelEntry, cli: CliId): Record<string, string> {
  if (!entry.providerId) return {};
  const provider = listProviders().find((p) => p.id === entry.providerId);
  if (!provider) return {};
  const route = resolveModelRoute(entry, provider, cli);
  const env: Record<string, string> = {};
  if (cli === 'pi') {
    // pi 按自家供应商环境变量认证（docs/providers.md）：
    // z.ai → ZAI_API_KEY；open.bigmodel.cn → ZAI_CODING_CN_API_KEY；其余回退 OPENAI_*
    const base = (route.baseUrl ?? '').toLowerCase();
    const key = readProviderKey(provider.id);
    if (base.includes('open.bigmodel.cn')) {
      if (key) env['ZAI_CODING_CN_API_KEY'] = key;
    } else if (base.includes('z.ai')) {
      if (key) env['ZAI_API_KEY'] = key;
    } else {
      // 其他供应商（火山引擎等）：已写入 ~/.pi/agent/models.json（含 apiKey），不再注入 env
      // 避免 OPENAI_API_KEY 被 pi 的内置 openai 供应商误用
      return {};
    }
    return env;
  }
  if (route.envBaseUrl && route.baseUrl !== undefined) {
    const normalized = normalizeBaseUrl(route.baseUrl, route.protocol);
    env[route.envBaseUrl] = normalized;
  }
  if (route.envKey) {
    const key = readProviderKey(provider.id);
    if (key) env[route.envKey] = key;
  }
  return env;
}
