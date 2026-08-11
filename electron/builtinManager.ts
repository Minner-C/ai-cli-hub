// 内置（Built-in）skill 枚举
// 调查结果：
// - kimi：kimi.exe 为编译二进制，内置 skill 嵌入其中，无文件可扫，CLI 也无 list 命令
//   （--help 仅见 --skills-dir 覆盖与 doctor 校验）。依据官方文档 Built-in 一节 +
//   运行时 skill 清单，硬编码三个内置 skill。
// - claude：同为编译二进制，但 `claude -p <msg> --output-format stream-json --verbose`
//   的 system.init 事件会带上 skills 列表（未登录也会发 init），可真实枚举，结果缓存。
// - gemini / codex：无 skill 机制。
import { execFile } from 'node:child_process';
import type { CliId, SkillInfo } from './shared';

// kimi 内置 skill（依据：https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html
// “Built-in Skills” 一节 + kimi-code 运行时内置清单）
const KIMI_BUILTIN: Array<{ name: string; description: string }> = [
  { name: 'check-kimi-code-docs', description: 'Answer questions about the Kimi Code product using the official documentation' },
  { name: 'update-config', description: "Inspect or edit kimi-code's own config (config.toml / tui.toml)" },
  { name: 'write-goal', description: 'Craft a well-specified /goal objective for goal mode' },
];

// claude 内置 skill 枚举：跑一次性 headless 解析 system.init 的 skills 字段
let claudeBuiltinCache: string[] | null = null;

function claudeBuiltinViaInit(executable: { file: string; argsPrefix: string[] }): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = execFile(
      executable.file,
      [...executable.argsPrefix, '-p', 'ping', '--output-format', 'stream-json', '--verbose'],
      { timeout: 30_000, windowsHide: true },
      (err, stdout) => {
        // 即使最终报错（未登录），init 事件也已输出
        for (const line of stdout.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as { type?: string; subtype?: string; skills?: unknown };
            if (obj.type === 'system' && obj.subtype === 'init' && Array.isArray(obj.skills)) {
              resolve(obj.skills.map(String));
              return;
            }
          } catch {
            /* 跳过非 JSON 行 */
          }
        }
        resolve([]);
      },
    );
    void proc;
  });
}

// claude init 实测（2026-07 本机，未登录状态下获得）的兜底列表
const CLAUDE_BUILTIN_FALLBACK = [
  'deep-research', 'design-sync', 'update-config', 'verify', 'debug', 'code-review',
  'simplify', 'batch', 'fewer-permission-prompts', 'loop', 'claude-api', 'run',
  'run-skill-generator', 'clear', 'compact', 'config', 'context', 'heapdump', 'init',
  'reload-skills', 'review', 'security-review', 'usage', 'insights', 'goal', 'team-onboarding',
];

export async function listBuiltinSkills(
  cli: CliId,
  claudeExecutable?: { file: string; argsPrefix: string[] },
): Promise<SkillInfo[]> {
  const builtin = (name: string, description: string): SkillInfo => ({
    name,
    description,
    scope: 'builtin',
    enabled: true,
    path: '',
    dirForm: true,
  });

  if (cli === 'kimi') {
    return KIMI_BUILTIN.map((s) => builtin(s.name, s.description));
  }
  if (cli === 'claude') {
    if (claudeBuiltinCache === null && claudeExecutable) {
      const found = await claudeBuiltinViaInit(claudeExecutable);
      claudeBuiltinCache = found.length > 0 ? found : CLAUDE_BUILTIN_FALLBACK;
    }
    return (claudeBuiltinCache ?? CLAUDE_BUILTIN_FALLBACK).map((name) =>
      builtin(name, 'Claude Code built-in skill'),
    );
  }
  return [];
}
