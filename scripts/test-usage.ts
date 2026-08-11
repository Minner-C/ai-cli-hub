// 用量单元验证：聚合逻辑、估算函数、任务用量明细、claude usage 提取
import { app } from 'electron';
import { summarizeUsage, estimateTokens, heatLevel, type UsageRecord } from '../electron/usageStore';
import { HEADLESS_ADAPTERS } from '../electron/headlessManager';

void app.whenReady().then(() => {
let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

// 估算函数
check('estimate 4 chars/token', estimateTokens(400) === 100);
check('estimate min 1', estimateTokens(0) === 1);

// 聚合
const now = Date.now();
const day = 86400_000;
const records: UsageRecord[] = [
  { taskId: 't1', projectCwd: '/p1', cli: 'kimi', model: 'k3', inputTokens: 1000, outputTokens: 500, estimated: true, ts: now },
  { taskId: 't1', projectCwd: '/p1', cli: 'claude', model: 'sonnet', inputTokens: 2000, outputTokens: 800, estimated: false, ts: now - day },
  { taskId: 't2', projectCwd: '/p2', cli: 'kimi', inputTokens: 500, outputTokens: 200, estimated: true, ts: now - 8 * day },
];
const s = summarizeUsage(records);
check('total', s.totalInput === 3500 && s.totalOutput === 1500, [s.totalInput, s.totalOutput]);
check('today only first', s.todayInput === 1000 && s.todayOutput === 500);
check('week excludes 8d ago', s.weekInput === 3000 && s.weekOutput === 1300, [s.weekInput, s.weekOutput]);
check('byCli kimi', s.byCli.find((r) => r.cli === 'kimi')?.input === 1500);
check('byCli sorted desc', s.byCli[0].cli === 'claude');
check('byProject', s.byProject.length === 2 && s.byProject.some((r) => r.cwd === '/p2'));
check('daily7 length', s.daily7.length === 7);
check('daily7 today value', s.daily7[6].input === 1000, s.daily7[6]);
check('flags', s.hasEstimated && s.hasReal);

// claude result usage 提取（实捕字段形态）
const evs = HEADLESS_ADAPTERS.claude.parseLine(
  '{"type":"result","is_error":false,"result":"ok","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":20}}',
);
const usageEv = evs.find((e) => e.type === 'usage');
check(
  'claude usage extracted with cache',
  usageEv !== undefined && (usageEv as { inputTokens: number }).inputTokens === 130 && (usageEv as { outputTokens: number }).outputTokens === 5 && (usageEv as { estimated: boolean }).estimated === false,
  usageEv,
);
check('done still emitted', evs.some((e) => e.type === 'done'));

// 无 usage 的 result 不出 usage 事件
const evs2 = HEADLESS_ADAPTERS.claude.parseLine('{"type":"result","is_error":false,"result":"ok"}');
check('no usage no event', !evs2.some((e) => e.type === 'usage'));

// ---- dailySeries：连续周序列 ----
check('dailySeries continuous', s.dailySeries.length >= 7 * 15, s.dailySeries.length);
let continuous = true;
for (let i = 1; i < s.dailySeries.length; i++) {
  const prev = new Date(s.dailySeries[i - 1].day).getTime();
  const cur = new Date(s.dailySeries[i].day).getTime();
  if (cur - prev !== 86400000) { continuous = false; break; }
}
check('dailySeries 1-day steps', continuous);
const firstDow = new Date(s.dailySeries[0].day).getDay();
check('dailySeries starts Monday', firstDow === 1, firstDow);
check('dailySeries ends today', s.dailySeries[s.dailySeries.length - 1].day === s.daily7[6].day);
const recDay = new Date(now - day);
const rk = `${recDay.getFullYear()}-${String(recDay.getMonth() + 1).padStart(2, '0')}-${String(recDay.getDate()).padStart(2, '0')}`;
check('dailySeries has old record', s.dailySeries.find((d) => d.day === rk)?.input === 2000, rk);

// ---- heatLevel 分档 ----
check('heat 0 empty', heatLevel(0, 100) === 0);
check('heat 1', heatLevel(10, 100) === 1);
check('heat 2', heatLevel(30, 100) === 2);
check('heat 3', heatLevel(60, 100) === 3);
check('heat 4', heatLevel(90, 100) === 4);
check('heat max0', heatLevel(5, 0) === 0);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
});
