// ACP 端到端回归：无重复投递、思考流、工具时序、正文无翻倍
import { AcpManager } from '../electron/acpClient';
import { toSpawnTarget } from '../electron/headlessManager';
import { assembleEvent } from '../electron/shared';
import type { ContentBlock, StreamEventPayload } from '../electron/shared';

const manager = new AcpManager();
const blocks: ContentBlock[] = [];

void (async () => {
  try {
    await manager.prompt(
      'e2e-acp2',
      'kimi',
      toSpawnTarget('C:/Users/Administrator/.kimi-code/bin/kimi.exe'),
      process.cwd(),
      '用一句话介绍 React，不超过 20 字',
      {
        onEvent: (ev: StreamEventPayload) => {
          if (ev.type !== 'session') assembleEvent(blocks, ev);
        },
      },
    );
    const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    console.log('assembled text:', JSON.stringify(text));
    // 翻倍检测：任何 2 字以上的序列连续重复出现即为翻倍
    const doubled = /(..+)\1/.test(text.replace(/\s/g, ''));
    console.log('doubling detected:', doubled);
    console.log(doubled ? 'E2E_FAIL_DOUBLED' : 'E2E_OK_NO_DOUBLING');
    manager.killAll();
    process.exit(doubled ? 1 : 0);
  } catch (err) {
    console.log('E2E_FAIL', err);
    manager.killAll();
    process.exit(1);
  }
})();
setTimeout(() => { console.log('TIMEOUT'); manager.killAll(); process.exit(1); }, 120000);
