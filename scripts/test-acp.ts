// ACP 单元验证：mapAcpUpdate（喂探针实捕样例）+ assembleEvent 同 toolId 去重
import { mapAcpUpdate } from '../electron/acpClient';
import { assembleEvent } from '../electron/shared';
import type { ContentBlock } from '../electron/shared';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

// 实捕样例 1：agent_thought_chunk → thinking
const e1 = mapAcpUpdate({
  sessionUpdate: 'agent_thought_chunk',
  content: { type: 'text', text: 'Answer:' },
});
check('thought chunk', e1.length === 1 && e1[0].type === 'thinking' && (e1[0] as { text: string }).text === 'Answer:', e1);

// 实捕样例 2：agent_message_chunk → delta
const e2 = mapAcpUpdate({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text: '更大' },
});
check('message chunk', e2.length === 1 && e2[0].type === 'delta');

// 实捕样例 3：tool_call pending → tool_call running
const e3 = mapAcpUpdate({
  sessionUpdate: 'tool_call',
  toolCallId: '0:tool_OHY7',
  title: 'Glob',
  kind: 'read',
  status: 'pending',
  content: [],
});
check('tool_call pending', e3.length === 1 && e3[0].type === 'tool_call' && (e3[0] as { name: string }).name === 'Glob', e3);

// 实捕样例 4：tool_call_update completed（含 content text）→ tool_result done
const e4 = mapAcpUpdate({
  sessionUpdate: 'tool_call_update',
  toolCallId: '0:tool_OHY7',
  status: 'completed',
  content: [{ type: 'content', content: { type: 'text', text: '[Truncated at 100 matches]' } }],
});
check(
  'tool completed',
  e4.length === 1 && e4[0].type === 'tool_result' && (e4[0] as { result: string }).result.includes('Truncated') && !(e4[0] as { isError?: boolean }).isError,
  e4,
);

// 实捕样例 5：tool_call_update failed → tool_result error
const e5 = mapAcpUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'x', status: 'failed', content: [] });
check('tool failed', e5[0].type === 'tool_result' && (e5[0] as { isError?: boolean }).isError === true);

// plan → TodoList 映射
const e6 = mapAcpUpdate({
  sessionUpdate: 'plan',
  entries: [
    { content: '分析需求', status: 'completed', priority: 'high' },
    { content: '实现功能', status: 'in_progress', priority: 'high' },
  ],
});
check('plan to TodoList', e6.length === 2 && e6[0].type === 'tool_call' && (e6[0] as { name: string }).name === 'TodoList');
const todosArgs = JSON.parse((e6[0] as { args: string }).args) as { todos: Array<{ title: string; status: string }> };
check('plan entries parsed', todosArgs.todos.length === 2 && todosArgs.todos[0].title === '分析需求' && todosArgs.todos[0].status === 'completed', todosArgs);

// ---- assembleEvent：同 toolId 去重（ACP pending → in_progress 重复推送）----
const blocks: ContentBlock[] = [];
assembleEvent(blocks, { type: 'tool_call', toolId: 't1', name: 'Glob', args: '' });
assembleEvent(blocks, { type: 'tool_call', toolId: 't1', name: 'Searching package.json', args: '{"pattern":"package.json"}' });
check('tool_call dedupe', blocks.length === 1, blocks.length);
check(
  'tool_call dedupe updates args',
  blocks[0].type === 'tool' && blocks[0].args.includes('package.json'),
);
assembleEvent(blocks, { type: 'tool_result', toolId: 't1', result: 'done', isError: false });
assembleEvent(blocks, { type: 'tool_call', toolId: 't1', name: 'Glob', args: 'again' });
check('tool_call after done updates existing', blocks.length === 1 && blocks[0].type === 'tool' && blocks[0].status === 'running', blocks[0]);

// plan 连续更新（同 acp-plan id）：块数量保持 1
const b2: ContentBlock[] = [];
for (const ev of e6) assembleEvent(b2, ev);
for (const ev of e6) assembleEvent(b2, ev);
check('plan updates single block', b2.length === 1, b2.length);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
