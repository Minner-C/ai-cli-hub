// dshChat 事件映射单测：锁定 dsh session/event → 统一 StreamEventPayload 的映射
import { mapEvent } from '../electron/dshChat';
import type { StreamEventPayload } from '../electron/shared';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
};

function collect(event: Record<string, unknown>): { evs: StreamEventPayload[]; ended: boolean } {
  const evs: StreamEventPayload[] = [];
  const ended = mapEvent(event, (ev) => evs.push(ev));
  return { evs, ended };
}

// text-delta → delta
{
  const { evs, ended } = collect({ type: 'assistant/chunk', seq: 1, time: 0, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '你好' } } });
  check('text-delta → delta', evs.length === 1 && evs[0].type === 'delta' && (evs[0] as { text: string }).text === '你好' && !ended, evs);
}
// reasoning-delta → thinking
{
  const { evs } = collect({ type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', index: 0, text: '想一下' } } });
  check('reasoning-delta → thinking', evs.length === 1 && evs[0].type === 'thinking', evs);
}
// block-start / step/start 等忽略
{
  const a = collect({ type: 'assistant/chunk', data: { chunk: { type: 'block-start', index: 0, blockType: 'text' } } });
  const b = collect({ type: 'step/start', data: { turn: 1, step: 1 } });
  const c = collect({ type: 'user/message', data: {} });
  check('block-start/step-start/user-message 忽略', a.evs.length === 0 && b.evs.length === 0 && c.evs.length === 0 && !a.ended && !b.ended);
}
// usage chunk → usage（含 cacheRead 计入 input）
{
  const { evs } = collect({ type: 'assistant/chunk', data: { chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50 } } } });
  check('usage chunk → usage', evs.length === 1 && evs[0].type === 'usage' && (evs[0] as { inputTokens: number }).inputTokens === 150 && (evs[0] as { outputTokens: number }).outputTokens === 20, evs);
}
// finish error chunk → error
{
  const { evs, ended } = collect({ type: 'assistant/chunk', data: { chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'MISSING_CREDENTIAL', code: 'MISSING_CREDENTIAL' } } } } });
  check('finish error → error', evs.length === 1 && evs[0].type === 'error' && (evs[0] as { message: string }).message === 'MISSING_CREDENTIAL' && !ended, evs);
}
// tool/call → tool_call
{
  const { evs } = collect({ type: 'tool/call', data: { turn: 1, step: 0, callId: 'c1', name: 'read', arguments: '{"file_path":"a.ts"}' } });
  check('tool/call → tool_call', evs.length === 1 && evs[0].type === 'tool_call' && (evs[0] as { toolId: string }).toolId === 'c1' && (evs[0] as { name: string }).name === 'read', evs);
}
// tool/result → tool_result（content 为 text 数组；isError 透传）
{
  const { evs } = collect({ type: 'tool/result', data: { message: { callId: 'c1', content: [{ type: 'text', text: '文件内容' }], isError: false } } });
  check('tool/result → tool_result', evs.length === 1 && evs[0].type === 'tool_result' && (evs[0] as { result: string }).result === '文件内容' && !(evs[0] as { isError?: boolean }).isError, evs);
}
// turn/end 正常 → ended=true 无事件
{
  const { evs, ended } = collect({ type: 'turn/end', data: { turn: 3, reason: { kind: 'done' } } });
  check('turn/end ok → ended', ended && evs.length === 0, { evs, ended });
}
// turn/end error → error 事件 + ended
{
  const { evs, ended } = collect({ type: 'turn/end', data: { turn: 3, reason: { kind: 'error', error: { message: 'llm-deepseek: no API key' } } } });
  check('turn/end error → error+ended', ended && evs.length === 1 && evs[0].type === 'error' && (evs[0] as { message: string }).message.includes('no API key'), { evs, ended });
}
// tool/result 异常内容兜底（对象 JSON 化不抛错）
{
  const { evs } = collect({ type: 'tool/result', data: { message: { callId: 'c2', content: { weird: true }, isError: true } } });
  check('tool/result 兜底', evs.length === 1 && evs[0].type === 'tool_result' && (evs[0] as { isError?: boolean }).isError === true, evs);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
