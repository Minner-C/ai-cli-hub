// dshManager 单测：dump-config 解析 + patch 层读写 + 凭证 .env 读写（保留其他行/条目）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 测试前重定向 DSH_HOME 到临时目录（dshManager.dshHome 读 env）
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-test-'));
process.env.DSH_HOME = tmpHome;

import {
  parseDumpConfig,
  readPatchEntries,
  setPluginDisabled,
  setDefaultModelOverride,
  getDefaultModelOverride,
  writeCredentialKey,
  readCredentialStatus,
  listProfiles,
} from '../electron/dshManager';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
};

// ---- dump-config 解析（真实抓取固件）----
const dump = fs.readFileSync(path.join(__dirname, 'scripts', 'fixtures', 'dsh-dump-config.txt'), 'utf8');
const entries = parseDumpConfig(dump);
check('解析出插件条目', entries.length > 30, entries.length);
const timer = entries.find((e) => e.id === 'timer');
check('timer 条目', timer?.name === '@deepseek-ai/cordis-plugin-timer' && timer.source === '@deepseek-ai/dsh-base', timer);
const hmr = entries.find((e) => e.id === 'hmr');
check('hmr 禁用且来源含 patched', hmr?.disabled === true && hmr.source.includes('patched by'), hmr);
const adm = entries.find((e) => e.id === 'agent-default-model');
check('agent-default-model 有 config', adm?.hasConfig === true && adm.disabled === false, adm);
const sp = entries.find((e) => e.id === 'session-persistence-jsonl');
check('!!js config 不炸解析', sp?.hasConfig === true, sp);
check('无重复 id', new Set(entries.map((e) => e.id)).size === entries.length);

// ---- patch 层读写 ----
const profDir = path.join(tmpHome, 'profiles', 'web');
fs.mkdirSync(profDir, { recursive: true });
fs.writeFileSync(
  path.join(profDir, 'package.json'),
  JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } }, dependencies: { 'dsh-plugin-x': '^1.0.0' } }),
);
const profiles = listProfiles();
check('listProfiles', profiles.length === 1 && profiles[0].name === 'web' && profiles[0].bundles.length === 2 && profiles[0].dependencies.includes('dsh-plugin-x'), profiles);

setPluginDisabled('web', 'hmr', true);
let patch = readPatchEntries('web');
check('禁用写入 patch', patch.length === 1 && patch[0].id === 'hmr' && patch[0].disabled === true, patch);

setDefaultModelOverride('web', 'deepseek-official', 'deepseek-v4-pro');
patch = readPatchEntries('web');
check('默认模型覆盖追加', patch.length === 2 && getDefaultModelOverride('web').model === 'deepseek-v4-pro', patch);

setPluginDisabled('web', 'hmr', false);
patch = readPatchEntries('web');
check('启用后移除空壳条目且保留其他条目', patch.length === 1 && patch[0].id === 'agent-default-model', patch);

// 再次禁用已有其他字段的条目：只改 disabled 不覆盖 config
setDefaultModelOverride('web', 'p2', 'm2');
setPluginDisabled('web', 'agent-default-model', true);
patch = readPatchEntries('web');
check('禁用保留已有 config', patch[0].config?.model === 'm2' && patch[0].disabled === true, patch);
setPluginDisabled('web', 'agent-default-model', false);
patch = readPatchEntries('web');
check('重新启用保留 config 仅去掉 disabled', patch[0].config?.model === 'm2' && patch[0].disabled === undefined, patch);

// ---- 凭证 .env ----
writeCredentialKey('DEEPSEEK_API_KEY', 'sk-test-1');
writeCredentialKey('OTHER_KEY', 'abc');
writeCredentialKey('DEEPSEEK_API_KEY', 'sk-test-2');
let st = readCredentialStatus();
check('凭证写入去重', st.keys.filter((k) => k === 'DEEPSEEK_API_KEY').length === 1 && st.keys.includes('OTHER_KEY'), st.keys);
const envContent = fs.readFileSync(st.envPath, 'utf8');
check('新值生效且其他行保留', envContent.includes('DEEPSEEK_API_KEY=sk-test-2') && envContent.includes('OTHER_KEY=abc'), envContent);
writeCredentialKey('DEEPSEEK_API_KEY', null);
st = readCredentialStatus();
check('清除 key 保留其他', !st.keys.includes('DEEPSEEK_API_KEY') && st.keys.includes('OTHER_KEY'), st.keys);

fs.rmSync(tmpHome, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
