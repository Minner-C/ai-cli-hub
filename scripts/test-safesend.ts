// safeSend 验证：窗口销毁后 send 不抛异常
import { app, BrowserWindow } from 'electron';
import { safeSend } from '../electron/safeSend';

void app.whenReady().then(async () => {
  let failures = 0;
  const check = (name: string, cond: boolean) => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
    if (!cond) failures++;
  };

  // 1. 活跃窗口：正常发送
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  let threw = false;
  try {
    safeSend(win.webContents, 'task:event', { type: 'done', taskId: 't1' });
  } catch {
    threw = true;
  }
  check('active window send ok', !threw);

  // 2. 销毁后：缓存引用（真实场景）不抛、静默丢弃
  const cached = win.webContents;
  win.destroy();
  threw = false;
  try {
    safeSend(cached, 'task:event', { type: 'done', taskId: 't1' });
    safeSend(cached, 'cli:installDone', 'gemini', true, '');
  } catch {
    threw = true;
  }
  check('destroyed cached webContents no throw', !threw);

  // 3. null/undefined webContents：不抛
  threw = false;
  try {
    safeSend(null, 'task:event', {});
    safeSend(undefined, 'menu:action', 'menu:newChat');
  } catch {
    threw = true;
  }
  check('null webContents no throw', !threw);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
});
