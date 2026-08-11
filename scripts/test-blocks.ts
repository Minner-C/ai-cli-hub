// 有序块装配单元验证：交错事件流的 blocks 顺序、累积快照兼容、旧格式迁移
import { assembleEvent, messageBlocks, blocksText } from '../electron/shared';
import type { ChatMessage, ContentBlock, StreamEventPayload } from '../electron/shared';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

// 交错事件流：text → tool_call → tool_result → text → thinking → text
const blocks: ContentBlock[] = [];
const events: StreamEventPayload[] = [
  { type: 'delta', text: '我先看一下文件。' },
  { type: 'tool_call', toolId: 't1', name: 'Read', args: '{"path":"a.ts"}' },
  { type: 'tool_result', toolId: 't1', result: 'file content', isError: false },
  { type: 'delta', text: '看到了。' },
  { type: 'thinking', text: '让我想想下一步' },
  { type: 'delta', text: '结论是 X。' },
];
for (const ev of events) assembleEvent(blocks, ev);

check('blocks count', blocks.length === 5, blocks.map((b) => b.type));
check(
  'blocks order',
  JSON.stringify(blocks.map((b) => b.type)) ===
    JSON.stringify(['text', 'tool', 'text', 'thinking', 'text']),
  blocks.map((b) => b.type),
);
check('text block1', blocks[0].type === 'text' && blocks[0].text === '我先看一下文件。');
check('tool block result', blocks[1].type === 'tool' && blocks[1].result === 'file content' && blocks[1].status === 'done');
check('thinking block', blocks[3].type === 'thinking' && blocks[3].text === '让我想想下一步');
check('blocksText joins text only', blocksText(blocks) === '我先看一下文件。看到了。结论是 X。');

// 连续 delta 合并进同一 text 块
const b2: ContentBlock[] = [];
assembleEvent(b2, { type: 'delta', text: 'hello ' });
assembleEvent(b2, { type: 'delta', text: 'world' });
check('delta merge', b2.length === 1 && b2[0].type === 'text' && b2[0].text === 'hello world');

// 累积快照式 delta（新文本以旧文本开头 → 替换）
const b3: ContentBlock[] = [];
assembleEvent(b3, { type: 'delta', text: 'abc' });
assembleEvent(b3, { type: 'delta', text: 'abcdef' });
check('cumulative snapshot replace', b3.length === 1 && b3[0].type === 'text' && b3[0].text === 'abcdef');

// tool_result 按 toolId 匹配（多工具交错）
const b4: ContentBlock[] = [];
assembleEvent(b4, { type: 'tool_call', toolId: 'a', name: 'Read', args: '{}' });
assembleEvent(b4, { type: 'tool_call', toolId: 'b', name: 'Bash', args: '{}' });
assembleEvent(b4, { type: 'tool_result', toolId: 'a', result: 'ra', isError: false });
assembleEvent(b4, { type: 'tool_result', toolId: 'b', result: 'rb', isError: true });
check(
  'tool_result by id',
  b4[0].type === 'tool' && b4[0].result === 'ra' && b4[0].status === 'done' &&
    b4[1].type === 'tool' && b4[1].result === 'rb' && b4[1].status === 'error',
);

// ---- 旧格式兼容 ----
const legacyAssistant: ChatMessage = {
  id: 'm1', role: 'assistant', text: '旧回答', thinking: '旧思考', ts: 1,
};
const lb = messageBlocks(legacyAssistant);
check('legacy assistant wrapped', lb.length === 2 && lb[0].type === 'thinking' && lb[1].type === 'text', lb);

const legacyTool: ChatMessage = {
  id: 'm2', role: 'tool', text: 'result', toolName: 'Bash', toolArgs: '{}', toolStatus: 'done', ts: 1,
};
const tb = messageBlocks(legacyTool);
check('legacy tool wrapped', tb.length === 1 && tb[0].type === 'tool' && tb[0].name === 'Bash' && tb[0].result === 'result');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
