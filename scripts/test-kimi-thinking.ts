// kimi 临时改写机制单元验证（Electron 环境，USERPROFILE 指向临时目录）
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-kimi-cfg-'));
process.env.USERPROFILE = TMP_HOME;
process.env.HOME = TMP_HOME;

import {
  buildPatchedConfig,
  withKimiThinking,
  restoreKimiConfigIfPending,
} from '../electron/kimiThinking';
import { store } from '../electron/taskStore';

const CONFIG_DIR = path.join(TMP_HOME, '.kimi-code');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.toml');

const ORIGINAL = `default_model = "kimi-code/k3"

[thinking]
effort = "low"

[other]
keep_me = true
`;

void app.whenReady().then(async () => {
  let failures = 0;
  const check = (name: string, cond: boolean, extra?: unknown) => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
    if (!cond) failures++;
  };

  // ---- buildPatchedConfig 纯函数 ----
  const off = buildPatchedConfig(ORIGINAL, 'off')!;
  check('off sets enabled=false', /enabled\s*=\s*false/.test(off) && !/effort\s*=/.test(off.split('[other]')[0].replace('[thinking]', '')) || off.includes('enabled = false'), off);
  check('off keeps other fields', off.includes('keep_me = true') && off.includes('default_model'));
  const high = buildPatchedConfig(ORIGINAL, 'high')!;
  check('high sets effort', high.includes('effort = "high"') && high.includes('enabled = true'), high);
  check('high keeps other fields', high.includes('keep_me = true'));
  const noThinking = buildPatchedConfig('default_model = "x"\n', 'low')!;
  check('creates [thinking] when missing', noThinking.includes('[thinking]') && noThinking.includes('effort = "low"'), noThinking);
  check('invalid toml degrades', buildPatchedConfig('{{{{not toml', 'low') === null);

  // ---- 改写-恢复往返 ----
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, ORIGINAL);
  let during: string | null = null;
  await withKimiThinking('high', async () => {
    during = fs.readFileSync(CONFIG_FILE, 'utf8');
  });
  check('config patched during run', during !== null && (during as string).includes('effort = "high"'));
  check('config restored after run', fs.readFileSync(CONFIG_FILE, 'utf8') === ORIGINAL);
  check('backup flag cleared', store.get('kimiThinkingBackup' as never) === undefined);

  // ---- fn 抛异常也恢复 ----
  try {
    await withKimiThinking('off', async () => {
      throw new Error('boom');
    });
  } catch {
    /* 预期 */
  }
  check('restored after exception', fs.readFileSync(CONFIG_FILE, 'utf8') === ORIGINAL);
  check('flag cleared after exception', store.get('kimiThinkingBackup' as never) === undefined);

  // ---- 并发串行化：两个并发调用，各自运行期间看到的应是自己或对方完整状态，且最终恢复 ----
  const seen: string[] = [];
  await Promise.all([
    withKimiThinking('low', async () => {
      await new Promise((r) => setTimeout(r, 50));
      seen.push(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }),
    withKimiThinking('high', async () => {
      await new Promise((r) => setTimeout(r, 10));
      seen.push(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }),
  ]);
  // 串行化保证：任一观测点配置必为 low 或 high 之一（不会交错），且第一个完成的恢复后第二个才改写
  check(
    'serialized configs',
    seen.every((c) => c.includes('effort = "low"') || c.includes('effort = "high"')),
    seen.map((c) => c.match(/effort = "\w+"/)?.[0]),
  );
  check('restored after concurrent', fs.readFileSync(CONFIG_FILE, 'utf8') === ORIGINAL);

  // ---- 崩溃恢复：手工置备份标记 + 改写文件，启动自检恢复 ----
  fs.writeFileSync(CONFIG_FILE, '[thinking]\nenabled = false\n');
  store.set('kimiThinkingBackup' as never, ORIGINAL as never);
  const restored = restoreKimiConfigIfPending();
  check('startup restore detected', restored === true);
  check('startup restore content', fs.readFileSync(CONFIG_FILE, 'utf8') === ORIGINAL);
  check('no pending after restore', restoreKimiConfigIfPending() === false);

  // ---- 无文件降级 ----
  fs.rmSync(CONFIG_FILE);
  let ran = false;
  await withKimiThinking('low', async () => {
    ran = true;
  });
  check('missing file degrades gracefully', ran && !fs.existsSync(CONFIG_FILE));

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
});
