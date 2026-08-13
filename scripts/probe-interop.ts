// ACP↔headless 会话互通验证：ACP 建会话发一条 → headless -r 同 id 续接
import { AcpManager } from '../electron/acpClient';
import { toSpawnTarget, HeadlessManager } from '../electron/headlessManager';
import type { StreamEventPayload } from '../electron/shared';

const acp = new AcpManager();
let acpSessionId = '';

void (async () => {
  // 1. ACP 建会话发一条
  const r = await acp.prompt(
    'interop', 'kimi',
    { ...toSpawnTarget('C:/Users/Administrator/.kimi-code/bin/kimi.exe'), acpArgs: ['acp'] },
    process.cwd(),
    '记住数字 42，只回复 ok',
    { onEvent: () => {} },
  );
  acpSessionId = r.sessionId ?? '';
  console.log('ACP session:', acpSessionId);
  acp.killAll();

  // 2. headless -r 同 id 续接，问上下文
  const hm = new HeadlessManager();
  let answer = '';
  await new Promise<void>((resolve) => {
    hm.run(
      {
        taskId: 'interop-h', cli: 'kimi', cwd: process.cwd(),
        message: '我刚才让你记住的数字是几？只回数字',
        sessionId: acpSessionId,
        sender: null,
        onEvent: (ev: StreamEventPayload) => { if (ev.type === 'delta') answer += ev.text; if (ev.type === 'done') resolve(); },
      },
      toSpawnTarget('C:/Users/Administrator/.kimi-code/bin/kimi.exe'),
    ).then(() => resolve());
  });
  console.log('headless -r answer:', JSON.stringify(answer.slice(0, 100)));
  console.log(answer.includes('42') ? 'INTEROP_OK (上下文延续)' : 'INTEROP_FAIL');
  process.exit(answer.includes('42') ? 0 : 1);
})();
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 120000);
