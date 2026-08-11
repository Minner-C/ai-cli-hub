// 用量统计：每轮生成的 token 消耗记录与聚合
// 数据来源：claude 为 stream-json result 的真实 usage；kimi(ACP)/gemini/codex 等无暴露 → 估算（标注）
import { store } from './taskStore';
import type { ChatMessage, CliId, ContentBlock } from './shared';
import { estimateTokens } from './shared';

export type { UsageRecord, UsageSummary } from './shared';
import type { UsageRecord, UsageSummary } from './shared';

const KEY = 'usageRecords';
const MAX_RECORDS = 5000;

export function addUsageRecord(rec: UsageRecord): void {
  const records = (store.get(KEY as never) ?? []) as UsageRecord[];
  records.push(rec);
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  store.set(KEY as never, records as never);
}

export function listUsageRecords(): UsageRecord[] {
  return (store.get(KEY as never) ?? []) as UsageRecord[];
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function summarizeUsage(records: UsageRecord[], weeks = 16, sinceDays?: number): UsageSummary {
  // 时间筛选：sinceDays 有值时只统计最近 N 天（0/undefined = 全部）
  if (sinceDays && sinceDays > 0) {
    const cutoff = Date.now() - sinceDays * 86400_000;
    records = records.filter((r) => r.ts >= cutoff);
  }
  const now = Date.now();
  const todayKey = dayKey(now);
  const weekAgo = now - 7 * 86400_000;

  const sum = { totalInput: 0, totalOutput: 0, todayInput: 0, todayOutput: 0, weekInput: 0, weekOutput: 0 };
  const byCli = new Map<string, { input: number; output: number }>();
  const byModel = new Map<string, { input: number; output: number }>();
  const byProject = new Map<string, { input: number; output: number }>();
  const byDay = new Map<string, { input: number; output: number }>();
  let hasEstimated = false;
  let hasReal = false;

  const bump = (map: Map<string, { input: number; output: number }>, key: string, rec: UsageRecord) => {
    const cur = map.get(key) ?? { input: 0, output: 0 };
    cur.input += rec.inputTokens;
    cur.output += rec.outputTokens;
    map.set(key, cur);
  };

  for (const rec of records) {
    sum.totalInput += rec.inputTokens;
    sum.totalOutput += rec.outputTokens;
    if (dayKey(rec.ts) === todayKey) {
      sum.todayInput += rec.inputTokens;
      sum.todayOutput += rec.outputTokens;
    }
    if (rec.ts >= weekAgo) {
      sum.weekInput += rec.inputTokens;
      sum.weekOutput += rec.outputTokens;
    }
    bump(byCli, rec.cli, rec);
    bump(byModel, rec.model ?? '(default)', rec);
    bump(byProject, rec.projectCwd, rec);
    bump(byDay, dayKey(rec.ts), rec);
    if (rec.estimated) hasEstimated = true;
    else hasReal = true;
  }

  // 近 7 天连续序列
  const daily7: UsageSummary['daily7'] = [];
  for (let i = 6; i >= 0; i--) {
    const key = dayKey(now - i * 86400_000);
    const cur = byDay.get(key) ?? { input: 0, output: 0 };
    daily7.push({ day: key, input: cur.input, output: cur.output });
  }

  const toRows = (map: Map<string, { input: number; output: number }>, keyName: string) =>
    [...map.entries()]
      .map(([k, v]) => ({ [keyName]: k, input: v.input, output: v.output }))
      .sort((a, b) => b.input + b.output - (a.input + a.output)) as never;

  // 近 N 周连续序列：周一对齐，GitHub contributions 热力图用
  const today = new Date(now);
  const dow = (today.getDay() + 6) % 7; // 周一=0
  const start = now - (dow + (weeks - 1) * 7) * 86400_000;
  const dailySeries: UsageSummary['dailySeries'] = [];
  for (let i = 0; ; i++) {
    const ts = start + i * 86400_000;
    if (ts > now) break;
    const key = dayKey(ts);
    const cur = byDay.get(key) ?? { input: 0, output: 0 };
    dailySeries.push({ day: key, input: cur.input, output: cur.output });
  }

  return {
    ...sum,
    byCli: toRows(byCli, 'cli'),
    byModel: toRows(byModel, 'model'),
    byProject: toRows(byProject, 'cwd'),
    daily7,
    dailySeries,
    hasEstimated,
    hasReal,
  };
}

export function taskUsage(taskId: string): { input: number; output: number } {
  const sum = { input: 0, output: 0 };
  for (const rec of listUsageRecords()) {
    if (rec.taskId === taskId) {
      sum.input += rec.inputTokens;
      sum.output += rec.outputTokens;
    }
  }
  return sum;
}

export function taskUsageDetail(taskId: string): Array<{ cli: string; model: string; input: number; output: number }> {
  const map = new Map<string, { input: number; output: number }>();
  for (const rec of listUsageRecords()) {
    if (rec.taskId !== taskId) continue;
    const key = `${rec.cli}|${rec.model ?? '(default)'}`;
    const cur = map.get(key) ?? { input: 0, output: 0 };
    cur.input += rec.inputTokens;
    cur.output += rec.outputTokens;
    map.set(key, cur);
  }
  return [...map.entries()].map(([k, v]) => {
    const [cli, model] = k.split('|');
    return { cli, model, input: v.input, output: v.output };
  });
}

// 单轮估算：输入=历史消息全量文本（含 blocks 的 text/thinking/工具参数与结果），
// 输出=本轮 text+thinking 块文本；使用 shared.estimateTokens 加权计算（中文更准）
function blockText(b: ContentBlock): string {
  if (b.type === 'text' || b.type === 'thinking') return b.text;
  return (b.args ?? '') + (b.result ?? '');
}

function messageText(m: ChatMessage): string {
  return m.text + (m.thinking ?? '') + (m.blocks ?? []).map(blockText).join('');
}

export function estimateTurnTokens(
  history: ChatMessage[],
  turnBlocks: ContentBlock[],
): { input: number; output: number } {
  const inputText = history.map(messageText).join('');
  const outputText = turnBlocks
    .filter((b) => b.type === 'text' || b.type === 'thinking')
    .map((b) => (b as { text: string }).text)
    .join('');
  return {
    input: estimateTokens(inputText),
    output: estimateTokens(outputText || '    '),
  };
}

export { heatLevel } from './shared';
