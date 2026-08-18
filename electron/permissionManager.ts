// 权限模式映射：各 CLI 的权限注入
// claude/codex 通过命令行参数注入；kimi/qwen/gemini 通过配置文件写入
import type { CliId, PermissionMode } from './shared';
import { readConfigNestedField, writeConfigNestedField } from './cliConfigManager';

export interface PermissionSupport {
  supported: boolean;
  note?: string; // 不支持时的说明（i18n key）
  via: 'args' | 'config' | 'rpc' | 'none'; // 生效方式（rpc=dsh web RPC 通道）
}

export function permissionSupport(cli: CliId): PermissionSupport {
  switch (cli) {
    case 'claude':
      return { supported: true, via: 'args' };
    case 'codex':
      return { supported: true, via: 'args' };
    case 'pi':
      return { supported: true, via: 'args' };
    case 'kimi':
      return { supported: true, via: 'config' };
    case 'qwen':
      return { supported: true, via: 'config' };
    case 'gemini':
      return { supported: true, via: 'config' };
    case 'dsh':
      // 经 dsh web RPC /permission 斜杠命令切换 preset（见 dshChat.applySessionControls）
      return { supported: true, via: 'rpc' };
    default:
      return { supported: false, via: 'none', note: 'permission.unsupported' };
  }
}

// dsh 权限 preset 映射（实测 PermissionPresetService 默认两档）：
// workspace-write = sandbox workspace-write + approval ask；danger-full-access = 完全访问不询问
export const DSH_PERMISSION_PRESETS: Record<PermissionMode, string> = {
  default: 'workspace-write',
  auto: 'workspace-write',
  plan: 'workspace-write',
  yolo: 'danger-full-access',
};

// 档位 → 命令行参数（仅 args 类 CLI 使用）
export function permissionArgs(cli: CliId, mode?: PermissionMode): string[] {
  if (!mode || mode === 'default') return [];
  switch (cli) {
    case 'claude':
      // claude: acceptEdits 只自动批准编辑，Bash 等在 -p 无人值守下仍会被拒；
      // headless 场景 auto 语义=完全不中断 → bypassPermissions（与 kimi auto 对齐）
      if (mode === 'auto') return ['--permission-mode', 'bypassPermissions'];
      if (mode === 'yolo') return ['--dangerously-skip-permissions'];
      return [];
    case 'codex':
      // codex: --full-auto / --dangerously-bypass-approvals-and-sandbox
      if (mode === 'auto') return ['--full-auto'];
      if (mode === 'yolo') return ['--dangerously-bypass-approvals-and-sandbox'];
      return [];
    case 'pi':
      // pi: --approve 信任项目本地文件（pi 无工具审批模式，信任即权限）
      if (mode === 'auto' || mode === 'yolo') return ['--approve'];
      return [];
    default:
      return [];
  }
}

// 档位 → 各 CLI 的 ACP mode 值（ACP 通道实时下发用）；undefined=该 CLI 不下发
export function acpModeValue(cli: CliId, mode: PermissionMode): string | undefined {
  switch (cli) {
    case 'kimi': // ACP: default/plan/auto/yolo
      return mode;
    case 'claude': // ACP: default/acceptEdits/plan/bypassPermissions
      if (mode === 'plan') return 'plan';
      if (mode === 'auto') return 'acceptEdits';
      if (mode === 'yolo') return 'bypassPermissions';
      return 'default';
    case 'gemini': // approval modes: default/auto_edit/yolo
      if (mode === 'auto') return 'auto_edit';
      if (mode === 'yolo') return 'yolo';
      return 'default';
    case 'qwen': // gemini fork：default/auto-edit/auto/yolo
      if (mode === 'auto') return 'auto';
      if (mode === 'yolo') return 'yolo';
      return 'default';
    default:
      return undefined; // codex/opencode/aider 等不下发
  }
}

// ---- 配置文件类 CLI 的权限字段映射 ----
interface PermConfigMap {
  fieldPath: string;                        // 配置文件中的字段路径（点分隔）
  toConfigValue: Record<PermissionMode, unknown>;  // PermissionMode → 配置值
  fromConfigValue: Record<string, PermissionMode>; // 配置值（小写）→ PermissionMode
}

const PERM_CONFIG: Partial<Record<CliId, PermConfigMap>> = {
  // kimi: default_permission_mode = manual | auto | yolo
  kimi: {
    fieldPath: 'default_permission_mode',
    toConfigValue: { default: 'manual', auto: 'auto', yolo: 'yolo', plan: 'manual' }, // plan 仅 ACP 实时下发；config 通道回退 manual
    fromConfigValue: { manual: 'default', auto: 'auto', yolo: 'yolo' },
  },
  // qwen: tools.approvalMode = plan | default | auto-edit | auto | yolo
  qwen: {
    fieldPath: 'tools.approvalMode',
    toConfigValue: { default: 'default', auto: 'auto', yolo: 'yolo', plan: 'plan' },
    fromConfigValue: {
      plan: 'default', default: 'default',
      'auto-edit': 'auto', auto: 'auto',
      yolo: 'yolo',
    },
  },
  // gemini: autoAccept = true | false（仅 default/auto 两档，yolo 等同 auto）
  gemini: {
    fieldPath: 'autoAccept',
    toConfigValue: { default: false, auto: true, yolo: true, plan: false },
    fromConfigValue: { 'false': 'default', 'true': 'auto' },
  },
};

// 从配置文件读取当前权限模式（无配置返回 undefined）
export function readPermissionFromConfig(cli: CliId): PermissionMode | undefined {
  const map = PERM_CONFIG[cli];
  if (!map) return undefined;
  const raw = readConfigNestedField(cli, map.fieldPath);
  if (raw === undefined || raw === null) return undefined;
  const key = String(raw).toLowerCase();
  return map.fromConfigValue[key] ?? 'default';
}

// 将权限模式写入配置文件（立即生效）
export function writePermissionToConfig(cli: CliId, mode: PermissionMode): void {
  const map = PERM_CONFIG[cli];
  if (!map) return;
  const value = map.toConfigValue[mode];
  writeConfigNestedField(cli, map.fieldPath, value);
}
