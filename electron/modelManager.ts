// 模型管理：各 CLI 可用模型来源与 --model 传参
import { execFile } from 'node:child_process';
import type { CliId, ModelInfo } from './shared';

// claude / gemini / codex 无公开 list 命令，内置常见型号
const BUILTIN_MODELS: Record<Exclude<CliId, 'kimi'>, ModelInfo[]> = {
  claude: [
    { id: 'opus', displayName: 'Opus (alias)' },
    { id: 'sonnet', displayName: 'Sonnet (alias)' },
    { id: 'haiku', displayName: 'Haiku (alias)' },
    { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite' },
  ],
  codex: [
    { id: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex' },
    { id: 'gpt-5-codex', displayName: 'GPT-5 Codex' },
    { id: 'gpt-5', displayName: 'GPT-5' },
  ],
  qwen: [
    { id: 'qwen3-coder-plus', displayName: 'Qwen3 Coder Plus' },
    { id: 'qwen3-coder-flash', displayName: 'Qwen3 Coder Flash' },
  ],
  opencode: [], // 模型由 opencode 自身 provider 配置决定，不提供内置列表
  aider: [
    { id: 'deepseek', displayName: 'DeepSeek' },
    { id: 'gpt-4o', displayName: 'GPT-4o' },
    { id: 'sonnet', displayName: 'Claude Sonnet (alias)' },
  ],
  pi: [
    { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' },
    { id: 'gpt-4o', displayName: 'GPT-4o' },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
  ],
  hermes: [
    { id: 'hermes-3-405b', displayName: 'Hermes 3 405B' },
    { id: 'hermes-3-70b', displayName: 'Hermes 3 70B' },
    { id: 'deepseek-v3', displayName: 'DeepSeek V3' },
    { id: 'gpt-4o', displayName: 'GPT-4o' },
  ],
};

// kimi：kimi provider list --json → { models: { "<provider>/<model>": { displayName } } }
function kimiModels(executable: string): Promise<ModelInfo[]> {
  return new Promise((resolve) => {
    execFile(
      executable,
      ['provider', 'list', '--json'],
      { timeout: 15_000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as {
            models?: Record<string, { displayName?: string; model?: string }>;
          };
          const models = Object.entries(parsed.models ?? {}).map(([id, m]) => ({
            id,
            displayName: m.displayName ?? id,
          }));
          resolve(models);
        } catch {
          resolve([]);
        }
      },
    );
  });
}

// 列出 CLI 可用模型；kimiExecutable 为检测到的 kimi 可执行路径
export async function listModels(cli: CliId, kimiExecutable?: string): Promise<ModelInfo[]> {
  if (cli === 'kimi') {
    if (kimiExecutable) {
      const models = await kimiModels(kimiExecutable);
      if (models.length > 0) return models;
    }
    return [{ id: 'kimi-code/kimi-for-coding', displayName: 'Kimi for Coding' }];
  }
  return BUILTIN_MODELS[cli];
}

// 模型参数（追加到 headless 命令行）
export function modelArgs(cli: CliId, model?: string): string[] {
  if (!model) return [];
  switch (cli) {
    case 'kimi':
      return ['--model', model];
    case 'claude':
      return ['--model', model];
    case 'gemini':
      return ['-m', model];
    case 'codex':
      return ['-m', model];
    case 'qwen':
      return ['-m', model];
    case 'opencode':
      return ['-m', model];
    case 'aider':
      return ['--model', model];
    case 'pi':
      return ['--model', model];
    case 'hermes':
      return ['--model', model];
    default:
      return ['--model', model];
  }
}
