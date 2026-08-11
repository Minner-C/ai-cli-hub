// task:setEffort 全链路：createTask → updateTask(effort) → getTask/listTasks 读回
import { app } from 'electron';
import { createTask, updateTask, getTask, listTasks, deleteTask, appendMessage, saveTask } from '../electron/taskStore';
import { effortSupport } from '../electron/effortManager';
import type { CliId, EffortLevel } from '../electron/shared';

void app.whenReady().then(() => {
  let failures = 0;
  const check = (name: string, cond: boolean, extra?: unknown) => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
    if (!cond) failures++;
  };

  const task = createTask('claude', 'D:/tmp');
  check('default no effort', getTask(task.id)?.effort === undefined);

  updateTask(task.id, { effort: 'low' as EffortLevel });
  check('effort persisted low', getTask(task.id)?.effort === 'low');

  updateTask(task.id, { effort: 'high' as EffortLevel });
  check('effort persisted high', getTask(task.id)?.effort === 'high');

  // listTasks（含 fixToolMessages 加工）不丢 effort
  const listed = listTasks().find((t) => t.id === task.id);
  check('listTasks keeps effort', listed?.effort === 'high', listed && Object.keys(listed));

  // 支持表：claude/codex 可用四档，其余置灰
  const expect: Record<CliId, boolean> = {
    kimi: true, claude: true, gemini: false, codex: true, qwen: false, opencode: false, aider: false,
  };
  for (const [cli, want] of Object.entries(expect)) {
    check(`support ${cli}`, effortSupport(cli as CliId).supported === want, effortSupport(cli as CliId));
  }
  check('kimi note', effortSupport('kimi').note === 'effort.kimiNote');

  // ---- 残留 streaming 标志与尾部光标清理（应用重启后历史消息不应挂光标）----
  const stale = createTask('kimi', 'D:/tmp');
  appendMessage(stale.id, {
    id: 'sm1', role: 'assistant', text: '回答到一半▍', streaming: true, ts: 1,
    blocks: [{ type: 'text', text: '回答到一半▍' }],
  });
  const loaded = listTasks().find((t) => t.id === stale.id);
  const sm = loaded?.messages[0];
  check('stale streaming cleared on load', sm?.streaming === false, sm);
  check('trailing cursor stripped', sm?.text === '回答到一半', sm?.text);
  check('block cursor stripped', sm?.blocks?.[0].type === 'text' && sm.blocks[0].text === '回答到一半');
  deleteTask(stale.id);

  deleteTask(task.id);
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
});
