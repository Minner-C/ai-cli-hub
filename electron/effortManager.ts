// 思考强度（推理档位）映射：各 CLI 的实际支持情况（调研结论见 README）
import type { CliId, EffortLevel } from './shared';

export interface EffortSupport {
  supported: boolean;
  note?: string; // 不支持时的说明（i18n key）
}

// claude: MAX_THINKING_TOKENS 环境变量（官方文档：0 禁用，默认 31999）
const CLAUDE_TOKENS: Record<EffortLevel, string> = {
  off: '0',
  low: '1024',
  medium: '8000',
  high: '31999',
  max: '31999', // claude 无 max 档，回退 high 等值
};

// codex: -c model_reasoning_effort=<level>（minimal/low/medium/high，未实测）
const CODEX_EFFORT: Record<EffortLevel, string> = {
  off: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'high', // codex 无 max 档，回退 high
};

// dsh: selectModel reasoningEffort 原样下发（off/high/max，实测 llm.models）
export const DSH_EFFORTS: EffortLevel[] = ['off', 'high', 'max'];

export function effortSupport(cli: CliId): EffortSupport {
  switch (cli) {
    case 'claude':
    case 'codex':
      return { supported: true };
    case 'dsh':
      // 经 dsh web RPC session.selectModel 的 reasoningEffort 下发（见 dshChat.applySessionControls）
      return { supported: true };
    case 'pi':
      // pi --thinking <level>（off/minimal/low/medium/high/xhigh/max）
      return { supported: true };
    case 'kimi':
      // 通过 spawn 前临时改写 config.toml [thinking] 生效（见 kimiThinking.ts）
      return { supported: true, note: 'effort.kimiNote' };
    default:
      return { supported: false, note: 'effort.unsupported' };
  }
}

// 档位 → env 注入
export function effortEnv(cli: CliId, level?: EffortLevel): Record<string, string> {
  if (!level) return {};
  if (cli === 'claude') return { MAX_THINKING_TOKENS: CLAUDE_TOKENS[level] };
  return {};
}

// 档位 → 命令行参数
export function effortArgs(cli: CliId, level?: EffortLevel): string[] {
  if (!level) return [];
  if (cli === 'codex') return ['-c', `model_reasoning_effort=${CODEX_EFFORT[level]}`];
  if (cli === 'pi') return ['--thinking', level];
  return [];
}
