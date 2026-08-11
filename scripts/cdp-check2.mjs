// CDP 深度检查：claude 任务权限切换 + ts 文件预览 + 当前活动任务
const list = await (await fetch('http://localhost:9333/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
};
await new Promise((r) => (ws.onopen = r));
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return 'JSERR: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 500);
  return r?.result?.value;
};

// 所有任务的 cli 分布
console.log('=== all tasks cli ===');
console.log(await evalJs(`window.hub.listTasks().then(ts => ts.map(t => t.cli + ' | ' + (t.permission ?? '-') + ' | ' + (t.title||'').slice(0,15)))`));

// 找一个 claude 任务测权限切换
console.log('=== setPermission on claude task ===');
console.log(await evalJs(`window.hub.listTasks().then(async ts => {
  const t = ts.find(x => x.cli === 'claude');
  if (!t) return 'no claude task';
  try {
    await window.hub.setTaskPermission(t.id, 'yolo');
    const back = (await window.hub.listTasks()).find(x => x.id === t.id);
    const result = 'set ok, readback=' + back.permission;
    await window.hub.setTaskPermission(t.id, 'auto');
    return result + ' | restore ok';
  } catch (e) { return 'THROW: ' + e.message; }
})`));

// ts 文件预览
console.log('=== preview .ts ===');
console.log(await evalJs(`window.hub.readFilePreview('D:/cloud/华为家庭存储/工作资料/开发/ai-cli-hub/src/main.tsx').then(r => r.kind + ' | ' + (r.content||'').length + ' chars').catch(e => 'ERR:' + e.message)`));

// 页面全局错误
console.log('=== window errors ===');
console.log(await evalJs(`window.__lastError ?? 'none recorded'`));

ws.close();
process.exit(0);
