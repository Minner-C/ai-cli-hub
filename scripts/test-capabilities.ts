// 能力矩阵与 dsh 映射单测：CLI_FEATURES 完整性、dsh 权限/思考映射、dsh 内置模型
import { CLI_FEATURES, type CliId } from '../electron/shared';
import { DSH_PERMISSION_PRESETS } from '../electron/permissionManager';
import { DSH_EFFORTS, effortSupport } from '../electron/effortManager';
import { permissionSupport } from '../electron/permissionManager';
import { listModels } from '../electron/modelManager';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
};

const ALL_CLIS: CliId[] = ['kimi', 'claude', 'gemini', 'codex', 'qwen', 'opencode', 'aider', 'pi', 'hermes', 'dsh'];

// 矩阵覆盖所有 CLI
check('矩阵覆盖全部 CLI', ALL_CLIS.every((c) => CLI_FEATURES[c]), ALL_CLIS.map((c) => !!CLI_FEATURES[c]));

// kimi 全能力；claude 权限+思考+plan；dsh 权限+思考(off/high/max)+plan
check('kimi 全能力', CLI_FEATURES.kimi.permission && CLI_FEATURES.kimi.plan && CLI_FEATURES.kimi.goal && (CLI_FEATURES.kimi.efforts?.length ?? 0) >= 4);
check('claude 权限+思考+plan 无 goal', CLI_FEATURES.claude.permission && CLI_FEATURES.claude.plan && !CLI_FEATURES.claude.goal && CLI_FEATURES.claude.efforts?.length === 4);
check('dsh 权限+思考+plan', CLI_FEATURES.dsh.permission && CLI_FEATURES.dsh.plan && !CLI_FEATURES.dsh.goal, CLI_FEATURES.dsh);
check('dsh 档位 off/high/max', JSON.stringify(CLI_FEATURES.dsh.efforts) === JSON.stringify(['off', 'high', 'max']));
check('gemini/qwen 无思考档', CLI_FEATURES.gemini.efforts === null && CLI_FEATURES.qwen.efforts === null);
check('opencode/aider/pi/hermes 全隐藏', ['opencode', 'aider', 'pi', 'hermes'].every((c) => {
  const f = CLI_FEATURES[c as CliId];
  return !f.permission && f.efforts === null && !f.plan && !f.goal;
}));

// dsh 权限映射（实测两档 preset）
check('dsh yolo→danger-full-access', DSH_PERMISSION_PRESETS.yolo === 'danger-full-access');
check('dsh default/auto/plan→workspace-write', DSH_PERMISSION_PRESETS.default === 'workspace-write' && DSH_PERMISSION_PRESETS.auto === 'workspace-write' && DSH_PERMISSION_PRESETS.plan === 'workspace-write');
check('permissionSupport dsh via rpc', permissionSupport('dsh').supported && permissionSupport('dsh').via === 'rpc');

// dsh 思考映射
check('effortSupport dsh', effortSupport('dsh').supported === true);
check('DSH_EFFORTS', JSON.stringify(DSH_EFFORTS) === JSON.stringify(['off', 'high', 'max']));

// dsh 内置模型（实测 llm.models：仅 v4-flash / v4-pro）
void listModels('dsh').then((models) => {
  const ids = models.map((m) => m.id);
  check('dsh 内置模型实测修正', JSON.stringify(ids) === JSON.stringify(['deepseek-v4-flash', 'deepseek-v4-pro']), ids);
  check('不再含旧名', !ids.includes('deepseek-chat') && !ids.includes('deepseek-reasoner'));

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
});
