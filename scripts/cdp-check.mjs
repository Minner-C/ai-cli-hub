// CDP 检查：权限选择器状态、文件预览 IPC、控制台错误
const list = await (await fetch('http://localhost:9333/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg.result);
    pending.delete(msg.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r?.result?.value ?? r;
};

// 1. 控制台错误收集
await send('Runtime.enable');

// 2. 权限选择器状态
console.log('=== selects ===');
console.log(await evalJs(`[...document.querySelectorAll('select.model-selector')].map(s => ({
  cls: s.className, disabled: s.disabled, value: s.value, title: s.title
}))`));

// 3. 权限支持查询
console.log('=== permission support claude ===');
console.log(await evalJs(`window.hub.getPermissionSupport('claude').then(r => JSON.stringify(r)).catch(e => 'ERR:' + e.message)`));

// 4. 直接调 setTaskPermission（取当前任务）
console.log('=== tasks ===');
console.log(await evalJs(`window.hub.listTasks().then(ts => ts.slice(0,3).map(t => ({id: t.id, cli: t.cli, perm: t.permission, title: (t.title||'').slice(0,20)})))`));

// 5. 文件预览 IPC 实测（一个已知代码文件）
console.log('=== readFilePreview ===');
console.log(await evalJs(`window.hub.readFilePreview('D:/cloud/华为家庭存储/工作资料/开发/ai-cli-hub/package.json').then(r => JSON.stringify(r).slice(0,200)).catch(e => 'ERR:' + e.message)`));

ws.close();
process.exit(0);
