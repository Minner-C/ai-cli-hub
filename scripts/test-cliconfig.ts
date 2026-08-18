// cliConfigManager 单元验证：配置读写校验、备份恢复、字段写保留其他项（临时 HOME）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-clicfg-'));
process.env.USERPROFILE = TMP_HOME;
process.env.HOME = TMP_HOME;

import {
  readConfigRaw,
  writeConfigRaw,
  validateConfig,
  restoreConfigBackup,
  hasConfigBackup,
  readConfigDoc,
  writeConfigFields,
  npmPackageOf,
} from '../electron/cliConfigManager';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

// 校验函数
check('valid json passes', validateConfig('json', '{"a":1}') === null);
check('invalid json fails', validateConfig('json', '{"a":}') !== null);
check('valid toml passes', validateConfig('toml', 'a = 1\n') === null);
check('invalid toml fails', validateConfig('toml', '[[[bad') !== null);
const lineErr = validateConfig('json', '{\n"a": 1,\n"b": }');
check('error carries position', lineErr !== null && /line|position/i.test(lineErr), lineErr);

// 读写 + 备份
check('config missing initially', readConfigRaw('kimi').exists === false);
writeConfigRaw('kimi', 'default_model = "kimi-code/k3"\n\n[thinking]\nenabled = true\neffort = "low"\n');
check('config written', readConfigRaw('kimi').exists === true);
check('first write no backup', hasConfigBackup('kimi') === false);
writeConfigRaw('kimi', 'default_model = "kimi-code/kimi-for-coding"\n');
check('second write creates backup', hasConfigBackup('kimi') === true);
restoreConfigBackup('kimi');
check('restore works', readConfigRaw('kimi').content.includes('k3'));

// 无效内容不写入
const before = readConfigRaw('kimi').content;
let threw = false;
try {
  writeConfigRaw('kimi', '[[[invalid toml');
} catch {
  threw = true;
}
check('invalid write rejected', threw && readConfigRaw('kimi').content === before);

// 字段读写保留其他字段
writeConfigRaw('kimi', 'default_model = "kimi-code/k3"\ntelemetry = false\n\n[thinking]\nenabled = true\neffort = "low"\n');
writeConfigFields('kimi', { default_permission_mode: 'yolo' });
const doc = readConfigDoc('kimi');
check('field added', doc.default_permission_mode === 'yolo');
check('other fields kept', doc.default_model === 'kimi-code/k3' && doc.telemetry === false);
check('nested kept', (doc.thinking as Record<string, unknown>).effort === 'low');

// json 配置
writeConfigRaw('claude', '{\n  "model": "sonnet",\n  "other": true\n}\n');
writeConfigFields('claude', { model: 'opus' });
const cdoc = readConfigDoc('claude');
check('json field update keeps others', cdoc.model === 'opus' && cdoc.other === true);

// npm 包映射
check('npm mapping claude', npmPackageOf('claude') === '@anthropic-ai/claude-code');
check('npm mapping kimi', npmPackageOf('kimi') === '@moonshot-ai/kimi-cli');
check('npm mapping dsh', npmPackageOf('dsh') === '@deepseek-ai/dsh');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
