// 供应商 env 注入 / 思考强度映射 / 新 CLI 解析 单元验证（providerManager 需 Electron 环境跑 safeStorage）
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-prov-'));
process.env.USERPROFILE = TMP_HOME;
process.env.HOME = TMP_HOME;

import { effortEnv, effortArgs, effortSupport } from '../electron/effortManager';
import {
  getProviderState,
  setActiveProvider,
  saveProviderKey,
  saveCustomProvider,
  providerEnv,
} from '../electron/providerManager';
import { HEADLESS_ADAPTERS } from '../electron/headlessManager';
import type { AppSettings } from '../electron/shared';

const settings: AppSettings = { language: 'zh', theme: 'system', customPaths: {} };

void app.whenReady().then(() => {
  let failures = 0;
  const check = (name: string, cond: boolean, extra?: unknown) => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
    if (!cond) failures++;
  };

  // ---- 思考强度 ----
  check('claude effort off', effortEnv('claude', 'off').MAX_THINKING_TOKENS === '0');
  check('claude effort high', effortEnv('claude', 'high').MAX_THINKING_TOKENS === '31999');
  check('claude effort undefined', Object.keys(effortEnv('claude', undefined)).length === 0);
  check('codex effort args', JSON.stringify(effortArgs('codex', 'high')) === JSON.stringify(['-c', 'model_reasoning_effort=high']));
  check('codex effort off=minimal', effortArgs('codex', 'off')[1] === 'model_reasoning_effort=minimal');
  check('kimi unsupported', !effortSupport('kimi').supported);
  check('kimi no env', Object.keys(effortEnv('kimi', 'high')).length === 0);
  check('gemini unsupported', !effortSupport('gemini').supported);

  // ---- 供应商 ----
  // 默认 official → 不注入
  check('official no env', Object.keys(providerEnv('claude', settings)).length === 0);

  // 切到 glm + 存 key → 注入 baseUrl + token
  let st = getProviderState('claude', settings);
  check('claude presets include glm', st.presets.some((p) => p.id === 'glm'));
  let s2 = setActiveAndGet('claude', 'glm', settings);
  saveProviderKey('glm', 'test-glm-key');
  const env1 = providerEnv('claude', s2);
  check('glm env injected', env1.ANTHROPIC_BASE_URL === 'https://open.bigmodel.cn/api/anthropic' && env1.ANTHROPIC_AUTH_TOKEN === 'test-glm-key', env1);

  // 外部配置检测：写 settings.json 后应出现 external 预设且不注入
  fs.mkdirSync(path.join(TMP_HOME, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_HOME, '.claude', 'settings.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://external.example.com' } }),
  );
  st = getProviderState('claude', settings);
  check('external detected', st.presets.some((p) => p.id === 'external' && p.baseUrl === 'https://external.example.com'), st.presets.map((p) => p.id));
  const extSettings: AppSettings = { ...settings, activeProviders: { claude: 'external' } };
  check('external no inject', Object.keys(providerEnv('claude', extSettings)).length === 0);

  // 自定义预设
  saveCustomProvider('claude', {
    id: 'my-proxy', name: 'My Proxy', baseUrl: 'https://proxy.example.com',
    envBaseUrl: 'ANTHROPIC_BASE_URL', envKey: 'ANTHROPIC_AUTH_TOKEN',
  }, settings);
  st = getProviderState('claude', store_get()); // saveCustomProvider 写入 store，需重读
  check('custom preset listed', st.presets.some((p) => p.id === 'claude:my-proxy'), st.presets.map((p) => p.id));
  saveProviderKey('claude:my-proxy', 'k1');
  const customSettings: AppSettings = {
    ...settings,
    customProviders: (settings.customProviders ?? []),
    activeProviders: { claude: 'claude:my-proxy' },
  };
  // saveCustomProvider 写进了 store，重读 settings
  const stored = (store_get() as AppSettings);
  const env2 = providerEnv('claude', { ...stored, activeProviders: { claude: 'claude:my-proxy' } });
  check('custom env injected', env2.ANTHROPIC_BASE_URL === 'https://proxy.example.com' && env2.ANTHROPIC_AUTH_TOKEN === 'k1', env2);
  void customSettings;

  // codex 预设
  st = getProviderState('codex', settings);
  check('codex presets', st.presets.some((p) => p.envKey === 'OPENAI_API_KEY'));

  // ---- 新 CLI 解析 ----
  check('qwen args', JSON.stringify(HEADLESS_ADAPTERS.qwen.buildArgs('hi')) === JSON.stringify(['-p', 'hi', '--output-format', 'json']));
  check('qwen parse reuse', HEADLESS_ADAPTERS.qwen.parseLine('{"response":"ok"}').length === 2);
  check('opencode args', JSON.stringify(HEADLESS_ADAPTERS.opencode.buildArgs('hi')) === JSON.stringify(['run', 'hi']));
  const ocEv = HEADLESS_ADAPTERS.opencode.parseLine('some plain output');
  check('opencode text delta', ocEv.length === 1 && ocEv[0].type === 'delta');
  check('aider args includes --yes-always', HEADLESS_ADAPTERS.aider.buildArgs('hi').includes('--yes-always'));
  check('opencode ansi stripped', HEADLESS_ADAPTERS.opencode.parseLine('[32mgreen[0m')[0].type === 'delta');

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
});

// 辅助
import { store } from '../electron/taskStore';
function setActiveAndGet(cli: 'claude' | 'codex', id: string, s: AppSettings): AppSettings {
  setActiveProvider(cli, id, s);
  return store_get();
}
function store_get(): AppSettings {
  return store.get('settings');
}
