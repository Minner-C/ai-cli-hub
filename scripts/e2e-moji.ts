// 全链路验证：真实 spawn kimi 跑 GBK 输出的 Bash 命令，检查 tool_result 已被修复
import { HeadlessManager, toSpawnTarget } from '../electron/headlessManager';

const manager = new HeadlessManager();
const results: string[] = [];

manager.run(
  {
    taskId: 'moji-e2e',
    cli: 'kimi',
    cwd: process.cwd(),
    message: '用 Bash 工具运行: tasklist //FI "PID gt 0" | head -3，不要转码，直接给我原始输出',
    sender: null,
    onEvent: (ev) => {
      if (ev.type === 'tool_result') results.push(ev.result);
      if (ev.type === 'done') {
        const joined = results.join('\n---\n');
        console.log('tool_result sample:', JSON.stringify(joined.slice(0, 80)));
        const hasRecovered = joined.includes('映') || joined.includes('会话');
        const hasRawMojibake = /[0080-00ff]{3,}/.test(joined);
        console.log(hasRecovered ? 'E2E_RECOVERED' : 'E2E_NOT_RECOVERED');
        console.log(hasRawMojibake ? 'STILL_HAS_LATIN1_MOJIBAKE' : 'NO_LATIN1_MOJIBAKE');
        process.exit(hasRecovered ? 0 : 1);
      }
    },
  },
  toSpawnTarget('C:/Users/Administrator/.kimi-code/bin/kimi.exe'),
);
setTimeout(() => { console.log('TIMEOUT', results.length); process.exit(1); }, 180000);
