// 性能优化验证：EventBatcher 合帧行为 + 合帧收益测算
import { EventBatcher } from '../src/utils/batcher';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

async function main() {
  // 合帧：100 个事件在窗口内只 flush 一次
  {
    const flushes: number[] = [];
    const batcher = new EventBatcher<number>(50, (_k, items) => flushes.push(items.length));
    for (let i = 0; i < 100; i++) batcher.push('t1', i);
    check('no flush before window', flushes.length === 0);
    await new Promise((r) => setTimeout(r, 80));
    check('100 events batched into 1 flush', flushes.length === 1 && flushes[0] === 100, flushes);
  }

  // 多任务互不干扰
  {
    const flushes: string[] = [];
    const batcher = new EventBatcher<number>(30, (k) => flushes.push(k));
    batcher.push('a', 1);
    batcher.push('b', 2);
    await new Promise((r) => setTimeout(r, 60));
    check('per-key flush', flushes.length === 2 && flushes.includes('a') && flushes.includes('b'), flushes);
  }

  // immediate：关键事件立即 flush（不等待窗口）
  {
    const order: string[] = [];
    const batcher = new EventBatcher<number>(50, (_k, items) => order.push(`flush:${items.join(',')}`));
    batcher.push('t', 1);
    batcher.push('t', 2);
    batcher.push('t', 3, true); // 立即
    order.push('after-immediate');
    await new Promise((r) => setTimeout(r, 80));
    check(
      'immediate flushes pending synchronously',
      order[0] === 'flush:1,2,3' && order[1] === 'after-immediate' && order.length === 2,
      order,
    );
  }

  // 模拟真实 chunk 频率的收益：每 4ms 一个 chunk × 250 个（1 秒），50ms 合帧 → ~20 次 flush（而非 250 次）
  {
    let flushCount = 0;
    const batcher = new EventBatcher<number>(50, () => flushCount++);
    for (let i = 0; i < 250; i++) {
      batcher.push('t', i);
      await new Promise((r) => setTimeout(r, 4));
    }
    batcher.flushAll();
    console.log(`  250 chunks -> ${flushCount} flushes (was 250 renders)`);
    check('flush reduction > 5x', flushCount < 50, flushCount);
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
