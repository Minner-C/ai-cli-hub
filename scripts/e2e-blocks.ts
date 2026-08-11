// kimi 实跑：带工具调用的对话 → 共享装配器 → 验证 blocks 顺序
import { HeadlessManager, toSpawnTarget } from '../electron/headlessManager';
import { assembleEvent } from '../electron/shared';
import type { ContentBlock } from '../electron/shared';

const manager = new HeadlessManager();
const blocks: ContentBlock[] = [];

manager.run(
  {
    taskId: 'blocks-e2e',
    cli: 'kimi',
    cwd: process.cwd(),
    message: '请先用 Glob 工具列出当前目录的 package.json，然后用 Read 工具读它的前 5 行，最后用一句话告诉我项目名。',
    sender: null,
    onEvent: (ev) => {
      if (ev.type === 'done') {
        console.log('BLOCKS:', JSON.stringify(
          blocks.map((b) => b.type === 'tool' ? `tool:${b.name}(${b.status})` : `${b.type}(${(b as {text:string}).text.length}字)`),
        ));
        const types = blocks.map((b) => b.type);
        const hasTool = types.includes('tool');
        const toolIdx = types.indexOf('tool');
        const ordered = hasTool && types[0] === 'text' || hasTool;
        // 验证：存在 tool 块且其前后顺序非全 text 堆顶
        const firstTextAfterTool = types.indexOf('text', toolIdx) > toolIdx;
        console.log('hasTool:', hasTool, 'textAfterTool:', firstTextAfterTool);
        console.log(hasTool && firstTextAfterTool ? 'E2E_ORDER_OK' : 'E2E_ORDER_BAD');
        process.exit(hasTool && firstTextAfterTool ? 0 : 1);
      }
      if (ev.type !== 'session') assembleEvent(blocks, ev);
    },
  },
  toSpawnTarget('C:/Users/Administrator/.kimi-code/bin/kimi.exe'),
);
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 240000);
