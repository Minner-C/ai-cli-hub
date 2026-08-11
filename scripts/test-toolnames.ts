// 单元验证：工具显示名映射、空 thinking 过滤、相邻 thinking 合并
import { toolDisplayName } from '../src/utils/toolNames';
import { assembleEvent } from '../electron/shared';
import type { ContentBlock } from '../electron/shared';
import type { TFunction } from 'i18next';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

// 模拟 i18next t()：命中返回译文，未命中返回 key
const zhMap: Record<string, string> = { 'tools.Bash': '命令', 'tools.Read': '读取', 'tools.TodoList': '待办清单' };
const fakeT = ((key: string) => zhMap[key] ?? key) as unknown as TFunction;

check('mapping hit Bash', toolDisplayName(fakeT, 'Bash') === '命令');
check('mapping hit TodoList', toolDisplayName(fakeT, 'TodoList') === '待办清单');
check('mapping miss passthrough', toolDisplayName(fakeT, 'SomeCustomTool') === 'SomeCustomTool');

// 空 thinking 不进 blocks
{
  const b: ContentBlock[] = [];
  assembleEvent(b, { type: 'thinking', text: '' });
  assembleEvent(b, { type: 'thinking', text: '   \n ' });
  check('empty thinking not added', b.length === 0, b.length);
  assembleEvent(b, { type: 'thinking', text: 'real thought' });
  check('real thinking added', b.length === 1 && b[0].type === 'thinking');
}

// 空 delta 不进 blocks
{
  const b: ContentBlock[] = [];
  assembleEvent(b, { type: 'delta', text: '  ' });
  check('empty delta not added', b.length === 0);
}

// 相邻 thinking 合并：thinking → thinking 应同块；thinking → tool → thinking 应分块（时序）
{
  const b: ContentBlock[] = [];
  assembleEvent(b, { type: 'thinking', text: 'first ' });
  assembleEvent(b, { type: 'thinking', text: 'second' });
  check('adjacent thinking merged', b.length === 1 && b[0].type === 'thinking' && b[0].text === 'first second', b);
  assembleEvent(b, { type: 'tool_call', toolId: 't1', name: 'Glob', args: '{}' });
  assembleEvent(b, { type: 'thinking', text: 'after tool' });
  check(
    'thinking after tool is separate block',
    b.length === 3 && b[2].type === 'thinking' && b[2].text === 'after tool',
    b.map((x) => x.type),
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
