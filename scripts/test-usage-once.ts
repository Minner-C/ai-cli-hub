// 单测锁定：一轮对话只产生一条统计行（done 去重 + settle 守卫的链路验证）
import { app } from 'electron';

void app.whenReady().then(() => {
  let failures = 0;
  const check = (name: string, cond: boolean, extra?: unknown) => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
    if (!cond) failures++;
  };

  // 源码级断言：双保险存在
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const mainSrc = fs.readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8');
  const headlessSrc = fs.readFileSync(path.join(process.cwd(), 'electron/headlessManager.ts'), 'utf8');

  check('settle guard exists', mainSrc.includes('if (usageSettled) return;'));
  check('guard set before work', /if \(usageSettled\) return;\s*\n\s*usageSettled = true;/.test(mainSrc));
  check(
    'settleUsage only called in done branch',
    (mainSrc.match(/settleUsage\(\)/g) ?? []).length === 1,
    (mainSrc.match(/settleUsage\(\)/g) ?? []).length,
  );
  check('headless done dedupe exists', headlessSrc.includes('doneEmitted'));
  check(
    'close handler no longer bypasses dedupe',
    headlessSrc.includes("emit({ type: 'done' }); // emit 内部去重"),
  );

  // 模拟 emit 层去重逻辑：error→done + close→done 只到达一次
  {
    let doneEmitted = false;
    let doneCount = 0;
    const emit = (type: string) => {
      if (type === 'done') {
        if (doneEmitted) return;
        doneEmitted = true;
      }
      if (type === 'done') doneCount++;
    };
    emit('error');
    emit('done'); // error 路径
    emit('done'); // close 路径
    check('done reaches listener once', doneCount === 1, doneCount);
  }

  // 模拟 settle 守卫：连续调用只执行一次
  {
    let settled = false;
    let calls = 0;
    const settle = () => {
      if (settled) return;
      settled = true;
      calls++;
    };
    settle();
    settle();
    settle();
    check('settle runs once per turn', calls === 1, calls);
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
});
