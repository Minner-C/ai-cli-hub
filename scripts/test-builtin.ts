// 内置 skill 枚举验证：kimi 硬编码清单、claude init 事件真实枚举、无执行文件时兜底
import { listBuiltinSkills } from '../electron/builtinManager';
import { toSpawnTarget } from '../electron/headlessManager';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

async function main() {
  const kimi = await listBuiltinSkills('kimi');
  check('kimi builtin count 3', kimi.length === 3, kimi.map((s) => s.name));
  check('kimi builtin scope', kimi.every((s) => s.scope === 'builtin' && s.enabled));
  check('kimi builtin names', kimi.some((s) => s.name === 'check-kimi-code-docs'));

  // claude 真实枚举（init 事件未登录也会发，30s 超时）
  const claudePath = 'C:/Users/Administrator/AppData/Roaming/npm/claude.cmd';
  const claude = await listBuiltinSkills('claude', toSpawnTarget(claudePath));
  check('claude builtin non-empty', claude.length > 0, claude.length);
  check('claude builtin scope', claude.every((s) => s.scope === 'builtin' && s.enabled));
  console.log('claude builtin sample:', claude.slice(0, 5).map((s) => s.name).join(', '));

  // 无执行文件 → 兜底列表
  const fallback = await listBuiltinSkills('claude', undefined);
  check('claude fallback non-empty', fallback.length > 0, fallback.length);

  // gemini/codex 无内置 skill
  check('gemini builtin empty', (await listBuiltinSkills('gemini')).length === 0);
  check('codex builtin empty', (await listBuiltinSkills('codex')).length === 0);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
