// safeStorage 加解密往返 + authManager 检测/env 装配验证（需在 Electron 主进程环境运行）
// 运行: npx esbuild scripts/test-auth.ts --bundle --platform=node --external:electron --outfile=<tmp>.cjs && npx electron <tmp>.cjs
import { app, safeStorage } from 'electron';
import { saveApiKey, clearApiKey, detectAllAuth, envFor } from '../electron/authManager';

void app.whenReady().then(() => {
  let failures = 0;
  const check = (name: string, cond: boolean, extra?: unknown) => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
    if (!cond) failures++;
  };

  // 1. safeStorage 可用性与往返
  check('safeStorage available', safeStorage.isEncryptionAvailable());
  const secret = 'sk-test-12345-abcdef';
  const enc = safeStorage.encryptString(secret).toString('base64');
  const dec = safeStorage.decryptString(Buffer.from(enc, 'base64'));
  check('safeStorage roundtrip', dec === secret, { dec });
  check('ciphertext differs', !Buffer.from(enc, 'base64').toString('utf8').includes(secret));

  // 2. saveApiKey / envFor / clearApiKey
  saveApiKey('claude', 'sk-ant-app-key-xxx');
  const env = envFor('claude');
  check('envFor returns app key', env.ANTHROPIC_API_KEY === 'sk-ant-app-key-xxx', env);
  const statusAfterSave = detectAllAuth();
  check('claude status app-key', statusAfterSave.claude.source === 'app-key', statusAfterSave.claude);
  clearApiKey('claude');
  check('envFor empty after clear', Object.keys(envFor('claude')).length === 0);

  // 3. 状态检测（本机实际：kimi 已登录；claude 未登录无 env → none）
  const all = detectAllAuth();
  console.log('detectAllAuth:', JSON.stringify(all, null, 1));
  check('kimi logged-in', all.kimi.source === 'logged-in', all.kimi);
  check('claude none (not logged in on this machine)', all.claude.source === 'none', all.claude);

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
});
