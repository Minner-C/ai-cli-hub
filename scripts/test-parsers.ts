// 解析器单元验证：喂样例 JSONL，检查 parseLine 输出（不经 Electron）
// 运行: npx esbuild scripts/test-parsers.ts --bundle --platform=node --outfile=%TEMP%/test-parsers.cjs && node %TEMP%/test-parsers.cjs
import { HEADLESS_ADAPTERS } from '../electron/headlessManager';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

// ---- kimi ----
check(
  'kimi assistant delta',
  HEADLESS_ADAPTERS.kimi.parseLine('{"role":"assistant","content":"ok"}'),
  [{ type: 'delta', text: 'ok' }],
);
check(
  'kimi session hint',
  HEADLESS_ADAPTERS.kimi.parseLine(
    '{"role":"meta","type":"session.resume_hint","session_id":"session_abc","command":"kimi -r session_abc"}',
  ),
  [{ type: 'session', cli: 'kimi', sessionId: 'session_abc' }],
);
check(
  'kimi tool call',
  HEADLESS_ADAPTERS.kimi.parseLine(
    '{"role":"assistant","tool_calls":[{"id":"c1","function":{"name":"Read","arguments":"{\\"path\\":\\"/a\\"}"}}]}',
  ),
  [{ type: 'tool_call', toolId: 'c1', name: 'Read', args: '{"path":"/a"}' }],
);
check(
  'kimi tool result',
  HEADLESS_ADAPTERS.kimi.parseLine('{"role":"tool","tool_call_id":"c1","content":"file body"}'),
  [{ type: 'tool_result', toolId: 'c1', result: 'file body' }],
);
check(
  'kimi args first round',
  HEADLESS_ADAPTERS.kimi.buildArgs('hello'),
  ['-p', 'hello', '--output-format', 'stream-json'],
);
check(
  'kimi args resume',
  HEADLESS_ADAPTERS.kimi.buildArgs('hello', 'session_abc'),
  ['-r', 'session_abc', '-p', 'hello', '--output-format', 'stream-json'],
);

// ---- claude ----
check(
  'claude init session',
  HEADLESS_ADAPTERS.claude.parseLine('{"type":"system","subtype":"init","session_id":"sid-1"}'),
  [{ type: 'session', cli: 'claude', sessionId: 'sid-1' }],
);
check(
  'claude assistant text+tool',
  HEADLESS_ADAPTERS.claude.parseLine(
    '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}',
  ),
  [
    { type: 'delta', text: 'hi' },
    { type: 'tool_call', toolId: 't1', name: 'Bash', args: '{"command":"ls"}' },
  ],
);
check(
  'claude tool result',
  HEADLESS_ADAPTERS.claude.parseLine(
    '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"done","is_error":false}]}}',
  ),
  [{ type: 'tool_result', toolId: 't1', result: 'done', isError: false }],
);
check(
  'claude result done',
  HEADLESS_ADAPTERS.claude.parseLine('{"type":"result","is_error":false,"result":"ok"}'),
  [{ type: 'done' }],
);
check(
  'claude result error',
  HEADLESS_ADAPTERS.claude.parseLine('{"type":"result","is_error":true,"result":"Not logged in"}'),
  [{ type: 'error', message: 'Not logged in' }, { type: 'done' }],
);
check(
  'claude args resume',
  HEADLESS_ADAPTERS.claude.buildArgs('hi', 'sid-1'),
  ['-p', 'hi', '--output-format', 'stream-json', '--verbose', '--resume', 'sid-1'],
);

// ---- gemini ----
check(
  'gemini response',
  HEADLESS_ADAPTERS.gemini.parseLine('{"response":"hello","session_id":"g1"}'),
  [{ type: 'delta', text: 'hello' }, { type: 'done' }],
);

// ---- codex ----
check(
  'codex agent message',
  HEADLESS_ADAPTERS.codex.parseLine(
    '{"type":"item.completed","item":{"type":"agent_message","text":"answer"}}',
  ),
  [{ type: 'delta', text: 'answer' }],
);
check(
  'codex thread started',
  HEADLESS_ADAPTERS.codex.parseLine('{"type":"thread.started","thread_id":"th1"}'),
  [{ type: 'session', cli: 'codex', sessionId: 'th1' }],
);

// 非 JSON 行不炸
check('non-json line ignored', HEADLESS_ADAPTERS.kimi.parseLine('plain log line'), []);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
