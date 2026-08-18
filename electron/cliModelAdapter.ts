// CLI 模型配置适配器：参照 CC Switch，为每个 CLI 实现自定义模型的配置文件写入
// 统一入口 syncCliCustomModel(cli, entry) 分发到各 CLI 的适配函数
// 返回 { modelArg, configChanged }：
//   - modelArg: 传给 CLI 的模型参数（如 kimi 的 alias、codex 的 model 名）
//   - configChanged: 配置文件是否变化（变化时需杀掉旧 ACP 连接强制重建）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import * as yaml from 'js-yaml';
import type { CliId, ModelEntry, ModelProtocol, ProviderEntry } from './shared';
import { selectProtocol } from './shared';
import * as modelRegistry from './modelRegistry';
import { normalizeBaseUrl, providerBaseUrl } from './modelRegistry';

export interface SyncResult {
  modelArg: string | null;
  configChanged: boolean;
}

// 协议 → 各 CLI 的 provider type 名
const PROTOCOL_TYPE: Record<ModelProtocol, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google-genai',
};

// ---- 通用工具 ----

// 原子写入文件（临时文件 + rename），避免写入中断导致配置损坏
function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

// 读取 JSON 配置文件（不存在返回空对象）
function readJson<T = Record<string, unknown>>(filePath: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return {} as T;
  }
}

// 写入 JSON 文件（格式化 + 原子写）
function writeJson(filePath: string, doc: unknown): void {
  atomicWrite(filePath, JSON.stringify(doc, null, 2) + '\n');
}

// 读取 TOML 配置文件
function readToml(filePath: string): Record<string, unknown> {
  try {
    return TOML.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// 写入 TOML 文件
function writeToml(filePath: string, doc: Record<string, unknown>): void {
  atomicWrite(filePath, TOML.stringify(doc as Parameters<typeof TOML.stringify>[0]));
}

// 读取 YAML 配置文件
function readYaml(filePath: string): Record<string, unknown> {
  try {
    return (yaml.load(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

// 写入 YAML 文件
function writeYaml(filePath: string, doc: Record<string, unknown>): void {
  atomicWrite(filePath, yaml.dump(doc, { lineWidth: -1 }));
}

// 配置文件路径（home 目录下）
function homeConfig(relPath: string): string {
  return path.join(os.homedir(), relPath);
}

// 比较新旧配置片段是否变化（深度序列化对比）
function isChanged(oldVal: unknown, newVal: unknown): boolean {
  return JSON.stringify(oldVal) !== JSON.stringify(newVal);
}

// ---- kimi 适配器（从 main.ts 迁移）----
// 写入 ~/.kimi-code/config.toml 的 [providers.xxx] + [models.xxx]
// kimi 支持 anthropic 和 openai 双协议，优先 anthropic
function syncKimi(entry: ModelEntry, provider: ProviderEntry): SyncResult {
  const providerName = `aiclihub-${provider.id}`;
  const modelAlias = entry.modelId || `aiclihub-${entry.id}`;
  const apiKey = modelRegistry.readProviderKey(provider.id) ?? '';

  // 按 CLI 协议优先级选择协议（kimi 优先 anthropic，回退 openai）
  const protocol = selectProtocol('kimi', provider) ?? 'openai';
  const rawBaseUrl = providerBaseUrl(provider, protocol);
  const normalizedBaseUrl = normalizeBaseUrl(rawBaseUrl, protocol);

  const configPath = homeConfig('.kimi-code/config.toml');
  const doc = readToml(configPath);
  if (!doc.providers || typeof doc.providers !== 'object') doc.providers = {};
  (doc.providers as Record<string, unknown>)[providerName] = {
    type: PROTOCOL_TYPE[protocol],
    ...(normalizedBaseUrl ? { base_url: normalizedBaseUrl } : {}),
    api_key: apiKey,
  };
  if (!doc.models || typeof doc.models !== 'object') doc.models = {};

  // capabilities：tool_use 始终保留，image_in 由 multimodal 开关决定
  const capabilities = entry.multimodal ? ['tool_use', 'image_in'] : ['tool_use'];
  const contextWindow = entry.contextWindow ?? 128000;

  const oldModel = (doc.models as Record<string, unknown>)[modelAlias] as
    | { capabilities?: string[]; max_context_size?: number }
    | undefined;
  const configChanged =
    isChanged(oldModel?.capabilities ?? [], capabilities) ||
    oldModel?.max_context_size !== contextWindow;

  (doc.models as Record<string, unknown>)[modelAlias] = {
    provider: providerName,
    model: entry.modelId,
    max_context_size: contextWindow,
    max_output_size: 8192,
    capabilities,
  };

  writeToml(configPath, doc);
  console.log(`[cli-adapter] kimi: provider=${providerName} model=${modelAlias} proto=${protocol} (changed=${configChanged})`);
  return { modelArg: modelAlias, configChanged };
}

// ---- codex 适配器 ----
// 写入 ~/.codex/auth.json (OPENAI_API_KEY) + ~/.codex/config.toml (model_provider/model/[model_providers.custom])
// codex 仅支持 openai 协议
function syncCodex(entry: ModelEntry, provider: ProviderEntry): SyncResult {
  const authPath = homeConfig('.codex/auth.json');
  const configPath = homeConfig('.codex/config.toml');
  const apiKey = modelRegistry.readProviderKey(provider.id) ?? '';

  // auth.json: { "OPENAI_API_KEY": "xxx" }
  const oldAuth = readJson<Record<string, unknown>>(authPath);
  const newAuth = { ...oldAuth, OPENAI_API_KEY: apiKey };
  const authChanged = isChanged(oldAuth.OPENAI_API_KEY, apiKey);

  // codex 仅支持 openai 协议，从供应商读取 openai 端点
  const rawBaseUrl = providerBaseUrl(provider, 'openai');
  const baseTrimmed = normalizeBaseUrl(rawBaseUrl, 'openai');
  const originOnly = baseTrimmed.split('://')[1]?.includes('/') === false;
  const codexBaseUrl = baseTrimmed.endsWith('/v1')
    ? baseTrimmed
    : originOnly
      ? `${baseTrimmed}/v1`
      : baseTrimmed;

  // config.toml: model_provider = "custom" + [model_providers.custom]
  const doc = readToml(configPath);
  const oldProvider = (doc.model_providers as Record<string, unknown>)?.custom as
    | { base_url?: string }
    | undefined;
  const configChanged =
    authChanged ||
    isChanged(oldProvider?.base_url, codexBaseUrl) ||
    isChanged(doc.model, entry.modelId);

  doc.model_provider = 'custom';
  doc.model = entry.modelId;
  doc.model_reasoning_effort = 'high';
  doc.disable_response_storage = true;
  if (!doc.model_providers || typeof doc.model_providers !== 'object') doc.model_providers = {};
  // codex 仅支持 openai 协议，wire_api 固定为 "chat"（Chat Completions API）
  (doc.model_providers as Record<string, unknown>).custom = {
    name: 'AI CLI Hub',
    base_url: codexBaseUrl,
    wire_api: 'chat',
    requires_openai_auth: true,
  };

  writeJson(authPath, newAuth);
  writeToml(configPath, doc);
  console.log(`[cli-adapter] codex: model=${entry.modelId} base=${codexBaseUrl} (changed=${configChanged})`);
  // modelArg=null：模型已通过 config.toml 的 model 字段设置，不需要 ACP setConfigOption
  return { modelArg: null, configChanged };
}

// ---- gemini 适配器 ----
// 写入 ~/.gemini/.env (GEMINI_API_KEY/GOOGLE_GEMINI_BASE_URL/GEMINI_MODEL) + ~/.gemini/settings.json
// gemini 仅支持 gemini 协议
function syncGemini(entry: ModelEntry, provider: ProviderEntry): SyncResult {
  const envPath = homeConfig('.gemini/.env');
  const settingsPath = homeConfig('.gemini/settings.json');
  const apiKey = modelRegistry.readProviderKey(provider.id) ?? '';

  // gemini 仅支持 gemini 协议
  const baseUrl = providerBaseUrl(provider, 'gemini');

  // .env 文件：KEY=VALUE 格式
  const envLines = [
    `GEMINI_API_KEY=${apiKey}`,
    ...(baseUrl ? [`GOOGLE_GEMINI_BASE_URL=${baseUrl}`] : []),
    `GEMINI_MODEL=${entry.modelId}`,
  ];
  const oldEnvContent = (() => { try { return fs.readFileSync(envPath, 'utf8'); } catch { return ''; } })();
  const newEnvContent = envLines.join('\n') + '\n';
  const envChanged = oldEnvContent !== newEnvContent;

  // settings.json: 标记使用 API Key 认证模式
  const settings = readJson<Record<string, unknown>>(settingsPath);
  const oldAuthType = (settings.security as { auth?: { selectedType?: string } })?.auth?.selectedType;
  const configChanged = envChanged || oldAuthType !== 'USE_GEMINI';

  if (!settings.security || typeof settings.security !== 'object') settings.security = {};
  (settings.security as Record<string, unknown>).auth = { selectedType: 'USE_GEMINI' };

  atomicWrite(envPath, newEnvContent);
  writeJson(settingsPath, settings);
  console.log(`[cli-adapter] gemini: model=${entry.modelId} (changed=${configChanged})`);
  // modelArg=null：模型已通过 .env 的 GEMINI_MODEL 设置，不需要 ACP setConfigOption
  return { modelArg: null, configChanged };
}

// ---- claude 适配器 ----
// 写入 ~/.claude/settings.json 的 env 字段
// 参照 CC Switch：设置 ANTHROPIC_MODEL + DEFAULT_HAIKU/SONNET/OPUS_MODEL，
// 让 Claude Code 内部所有场景（主模型/快速模型/推理模型）都指向自定义模型
// 不通过 ACP setConfigOption 设置模型（Claude Code ACP 会校验模型名，非 claude-* 模型会报错）
// claude 仅支持 anthropic 协议
function syncClaude(entry: ModelEntry, provider: ProviderEntry): SyncResult {
  const settingsPath = homeConfig('.claude/settings.json');
  const apiKey = modelRegistry.readProviderKey(provider.id) ?? '';

  // claude 仅支持 anthropic 协议，从供应商读取 anthropic 端点
  const rawBaseUrl = providerBaseUrl(provider, 'anthropic');
  const baseUrl = normalizeBaseUrl(rawBaseUrl, 'anthropic');

  const settings = readJson<Record<string, unknown>>(settingsPath);
  if (!settings.env || typeof settings.env !== 'object') settings.env = {};
  const env = settings.env as Record<string, unknown>;

  const newEnv = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_MODEL: entry.modelId,
    // Claude Code 内部按场景选择 haiku（快速）/sonnet（默认）/opus（推理）模型，
    // 全部映射到自定义模型，避免回退到官方模型名导致 404
    ANTHROPIC_DEFAULT_HAIKU_MODEL: entry.modelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: entry.modelId,
    ANTHROPIC_DEFAULT_OPUS_MODEL: entry.modelId,
  };
  const configChanged = isChanged(env.ANTHROPIC_BASE_URL, newEnv.ANTHROPIC_BASE_URL)
    || isChanged(env.ANTHROPIC_AUTH_TOKEN, newEnv.ANTHROPIC_AUTH_TOKEN)
    || isChanged(env.ANTHROPIC_MODEL, newEnv.ANTHROPIC_MODEL)
    || isChanged(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, newEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL)
    || isChanged(env.ANTHROPIC_DEFAULT_SONNET_MODEL, newEnv.ANTHROPIC_DEFAULT_SONNET_MODEL)
    || isChanged(env.ANTHROPIC_DEFAULT_OPUS_MODEL, newEnv.ANTHROPIC_DEFAULT_OPUS_MODEL);

  Object.assign(env, newEnv);
  writeJson(settingsPath, settings);
  console.log(`[cli-adapter] claude: model=${entry.modelId} base=${baseUrl} (changed=${configChanged})`);
  // modelArg=null：不通过 ACP setConfigOption 设置模型（已通过 env 设置）
  return { modelArg: null, configChanged };
}

// ---- qwen 适配器 ----
// 写入 ~/.qwen/settings.json 的 env 字段（OPENAI_BASE_URL/OPENAI_API_KEY）
// qwen 仅支持 openai 协议
function syncQwen(entry: ModelEntry, provider: ProviderEntry): SyncResult {
  const settingsPath = homeConfig('.qwen/settings.json');
  const apiKey = modelRegistry.readProviderKey(provider.id) ?? '';

  const rawBaseUrl = providerBaseUrl(provider, 'openai');
  const baseUrl = normalizeBaseUrl(rawBaseUrl, 'openai');

  const settings = readJson<Record<string, unknown>>(settingsPath);
  if (!settings.env || typeof settings.env !== 'object') settings.env = {};
  const env = settings.env as Record<string, unknown>;

  const newEnv = {
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: apiKey,
    OPENAI_MODEL: entry.modelId,
  };
  const configChanged = isChanged(env.OPENAI_BASE_URL, newEnv.OPENAI_BASE_URL)
    || isChanged(env.OPENAI_API_KEY, newEnv.OPENAI_API_KEY)
    || isChanged(env.OPENAI_MODEL, newEnv.OPENAI_MODEL);

  Object.assign(env, newEnv);
  writeJson(settingsPath, settings);
  console.log(`[cli-adapter] qwen: model=${entry.modelId} (changed=${configChanged})`);
  // modelArg=null：模型已通过 settings.json 的 OPENAI_MODEL 设置，不需要 ACP setConfigOption
  return { modelArg: null, configChanged };
}

// ---- opencode 适配器（additive 模式）----
// 写入 ~/.config/opencode/opencode.json 的 provider.<id> 节点
// opencode 支持 openai 和 anthropic 协议，优先 openai
function syncOpencode(entry: ModelEntry, provider: ProviderEntry): SyncResult {
  const configPath = homeConfig('.config/opencode/opencode.json');
  const apiKey = modelRegistry.readProviderKey(provider.id) ?? '';
  const providerId = `aiclihub-${entry.id}`;

  // opencode 优先 openai 协议，回退 anthropic
  const protocol = selectProtocol('opencode', provider) ?? 'openai';
  const rawBaseUrl = providerBaseUrl(provider, protocol);
  const baseUrl = normalizeBaseUrl(rawBaseUrl, protocol);

  const doc = readJson<Record<string, unknown>>(configPath);
  if (!doc.provider || typeof doc.provider !== 'object') doc.provider = {};
  const providers = doc.provider as Record<string, unknown>;

  // 按 protocol 选择 AI SDK 包
  const npmPackage = protocol === 'anthropic'
    ? '@ai-sdk/anthropic'
    : protocol === 'gemini'
      ? '@ai-sdk/google'
      : '@ai-sdk/openai-compatible';

  const newProvider = {
    npm: npmPackage,
    name: entry.displayName,
    options: {
      baseURL: baseUrl,
      apiKey,
    },
    models: {
      [entry.modelId]: {
        name: entry.displayName,
        limit: { context: entry.contextWindow ?? 128000 },
      },
    },
  };
  const configChanged = isChanged(providers[providerId], newProvider);
  providers[providerId] = newProvider;

  writeJson(configPath, doc);
  console.log(`[cli-adapter] opencode: provider=${providerId} model=${entry.modelId} proto=${protocol} (changed=${configChanged})`);
  // modelArg=null：模型已通过 opencode.json 的 provider.models 设置，不需要 ACP setConfigOption
  return { modelArg: null, configChanged };
}

// ---- pi 自定义供应商适配器 ----
// 写入 ~/.pi/agent/models.json 的 providers.<id> 段（火山引擎等 pi 无内置供应商的端点）
// model 以 <providerId>/<modelId> 形式引用，避免与内置目录同名模型歧义
function syncPi(entry: ModelEntry, provider: ProviderEntry): SyncResult {
  const configPath = homeConfig('.pi/agent/models.json');
  const apiKey = modelRegistry.readProviderKey(provider.id) ?? '';
  const providerId = `aiclihub-${entry.id}`;

  const protocol = selectProtocol('pi', provider) ?? 'openai';
  const rawBaseUrl = providerBaseUrl(provider, protocol);
  const baseUrl = normalizeBaseUrl(rawBaseUrl, protocol);
  const api = protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions';

  const doc = readJson<Record<string, unknown>>(configPath);
  if (!doc.providers || typeof doc.providers !== 'object') doc.providers = {};
  const providers = doc.providers as Record<string, unknown>;

  const newProvider = {
    baseUrl,
    api,
    apiKey,
    models: [{ id: entry.modelId, name: entry.displayName }],
  };
  const configChanged = isChanged(providers[providerId], newProvider);
  providers[providerId] = newProvider;

  writeJson(configPath, doc);
  console.log(`[cli-adapter] pi: provider=${providerId} model=${entry.modelId} api=${api} (changed=${configChanged})`);
  return { modelArg: `${providerId}/${entry.modelId}`, configChanged };
}

// ---- hermes 适配器（additive 模式）----
// 写入 ~/.hermes/config.yaml 的 custom_providers.<id> 段
// hermes 仅支持 openai 协议
function syncHermes(entry: ModelEntry, provider: ProviderEntry): SyncResult {
  const configPath = homeConfig('.hermes/config.yaml');
  const apiKey = modelRegistry.readProviderKey(provider.id) ?? '';
  const providerId = `aiclihub-${entry.id}`;

  const rawBaseUrl = providerBaseUrl(provider, 'openai');
  const baseUrl = normalizeBaseUrl(rawBaseUrl, 'openai');

  const doc = readYaml(configPath);
  if (!doc.custom_providers || typeof doc.custom_providers !== 'object') doc.custom_providers = {};
  const customProviders = doc.custom_providers as Record<string, unknown>;

  const newProvider = {
    base_url: baseUrl,
    api_key: apiKey,
    model: entry.modelId,
    models: {
      [entry.modelId]: { context_length: entry.contextWindow ?? 128000 },
    },
  };
  const configChanged = isChanged(customProviders[providerId], newProvider);
  customProviders[providerId] = newProvider;

  writeYaml(configPath, doc);
  console.log(`[cli-adapter] hermes: provider=${providerId} model=${entry.modelId} (changed=${configChanged})`);
  // modelArg=null：模型已通过 config.yaml 的 custom_providers.model 设置，不需要 ACP setConfigOption
  return { modelArg: null, configChanged };
}

// ---- 统一分发入口 ----
// 为指定 CLI 写入自定义模型配置；返回模型参数和配置变化标志
// 未实现适配器的 CLI 返回 null（回退到环境变量注入）
export function syncCliCustomModel(cli: CliId, entry: ModelEntry): SyncResult {
  if (!entry.providerId) return { modelArg: entry.modelId || null, configChanged: false };
  const provider = modelRegistry.listProviders().find((p) => p.id === entry.providerId);
  if (!provider) return { modelArg: entry.modelId || null, configChanged: false };

  switch (cli) {
    case 'kimi': return syncKimi(entry, provider);
    case 'codex': return syncCodex(entry, provider);
    case 'gemini': return syncGemini(entry, provider);
    case 'claude': return syncClaude(entry, provider);
    case 'qwen': return syncQwen(entry, provider);
    case 'opencode': return syncOpencode(entry, provider);
    case 'hermes': return syncHermes(entry, provider);
    case 'pi': {
      // pi：z.ai 系用内置供应商前缀；其他（如火山引擎）写入 ~/.pi/agent/models.json 自定义供应商
      const base = (providerBaseUrl(provider, selectProtocol('pi', provider) ?? 'openai') ?? '').toLowerCase();
      if (base.includes('open.bigmodel.cn')) {
        return { modelArg: `zai-coding-cn/${entry.modelId}`, configChanged: false };
      }
      if (base.includes('z.ai')) {
        return { modelArg: `zai/${entry.modelId}`, configChanged: false };
      }
      return syncPi(entry, provider);
    }
    // aider 读环境变量，无需配置文件写入
    default: return { modelArg: entry.modelId || null, configChanged: false };
  }
}
