// 单元验证：kimi text 模式解析（真实捕获样例）+ cleanDisplayText
import { parseKimiTextStdout, parseKimiTextStderr } from '../electron/headlessManager';
import { cleanDisplayText } from '../src/utils/displayText';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

// ---- kimi text stdout（真实样例）----
// 实捕: "• 按**小数**比较：**9.9 大**。因为 9.9 = 9.90，而 0.90 > 0.11。"
const e1 = parseKimiTextStdout('• 按**小数**比较：**9.9 大**。');
check('stdout bullet strips • prefix', e1.length === 1 && e1[0].type === 'delta' && (e1[0] as { text: string }).text.startsWith('按'), e1);
// 实捕: "  简单方法：把小数点对齐..."
const e2 = parseKimiTextStdout('  简单方法：对齐再比');
check('stdout indent strips 2 spaces', (e2[0] as { text: string }).text === '简单方法：对齐再比\n', e2);
// 实捕: "  - `ai-cli-hub/package.json` — 子项目清单"
const e3 = parseKimiTextStdout('  - `ai-cli-hub/package.json` — 清单');
check('stdout list item', (e3[0] as { text: string }).text.startsWith('- '), e3);
const e4 = parseKimiTextStdout('');
check('stdout blank line kept', (e4[0] as { text: string }).text === '\n');

// ---- kimi text stderr（真实样例）----
// 实捕: "• Simple question, no tools needed. 9.11 < 9.9 in decimal..."
const t1 = parseKimiTextStderr('• Simple question, no tools needed.');
check('stderr thinking event', t1.length === 1 && t1[0].type === 'thinking' && (t1[0] as { text: string }).text === 'Simple question, no tools needed.\n', t1);
// 实捕: "To resume this session: kimi -r session_48f8edc1-bb9a-47ea-ae58-f87aabfc7aa5"
const t2 = parseKimiTextStderr('To resume this session: kimi -r session_48f8edc1-bb9a-47ea-ae58-f87aabfc7aa5');
check('stderr session event', t2.length === 1 && t2[0].type === 'session' && (t2[0] as { sessionId: string }).sessionId === 'session_48f8edc1-bb9a-47ea-ae58-f87aabfc7aa5', t2);
const t3 = parseKimiTextStderr('');
check('stderr empty ignored', t3.length === 0);

// ---- cleanDisplayText ----
check(
  'collapse 锟斤拷 run',
  cleanDisplayText('Visual Studio 锟斤拷锟缴癸拷锟斤拷 2022') === 'Visual Studio � 2022',
  cleanDisplayText('Visual Studio 锟斤拷锟缴癸拷锟斤拷 2022'),
);
check('collapse FFFD run', cleanDisplayText('abc���def') === 'abc�def');
check('normal text untouched', cleanDisplayText('正常中文 English 123') === '正常中文 English 123');
check('single 锟 kept (rare legit)', cleanDisplayText('锟 is a char') === '锟 is a char');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
