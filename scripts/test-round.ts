// 单测：含 thinking 的估算、安装命令映射
import { app } from 'electron';
import { estimateTurnTokens } from '../electron/usageStore';
import { installCommandOf } from '../electron/cliConfigManager';
import type { ChatMessage, ContentBlock } from '../electron/shared';

void app.whenReady().then(() => {
let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

// 估算：历史含 blocks（text+thinking+工具参数/结果）
{
  const history: ChatMessage[] = [
    { id: 'u1', role: 'user', text: 'x'.repeat(400), ts: 1 },
    {
      id: 'a1', role: 'assistant', text: 'y'.repeat(200), ts: 2,
      blocks: [
        { type: 'thinking', text: 'z'.repeat(800) } as ContentBlock,
        { type: 'text', text: 'y'.repeat(200) } as ContentBlock,
        { type: 'tool', toolId: 't', name: 'Bash', args: 'a'.repeat(100), result: 'b'.repeat(300), status: 'done' } as ContentBlock,
      ],
    },
  ];
  const turn: ContentBlock[] = [
    { type: 'thinking', text: 't'.repeat(400) },
    { type: 'text', text: 'o'.repeat(400) },
  ];
  const est = estimateTurnTokens(history, turn);
  // input = (400 + 200 + 200 + 800 + 100 + 300)/4 = 2000/4 = 500
  // 注：blocks 存在时 text 与 blocks[text] 重复计（text 是 blocksText 拼接）——验证实际口径
  console.log('  est:', JSON.stringify(est));
  check('input includes thinking', est.input >= 400, est.input);
  check('output includes thinking', est.output === 200, est.output); // (400+400)/4
  const noThinking = estimateTurnTokens(history, [{ type: 'text', text: 'o'.repeat(400) }]);
  check('thinking raises output', est.output > noThinking.output, [est.output, noThinking.output]);
}

// 安装命令映射
check('install claude', installCommandOf('claude') === 'npm install -g @anthropic-ai/claude-code');
check('install gemini', installCommandOf('gemini') === 'npm install -g @google/gemini-cli');
check('install codex', installCommandOf('codex') === 'npm install -g @openai/codex');
check('install qwen', installCommandOf('qwen') === 'npm install -g @qwen-code/qwen-code');
check('install opencode', installCommandOf('opencode') === 'npm install -g opencode-ai@latest');
check('install aider', installCommandOf('aider') === 'pip install aider-chat');
check('install kimi none', installCommandOf('kimi') === null);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
app.exit(failures === 0 ? 0 : 1);
});
