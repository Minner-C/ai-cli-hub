// CDP：模拟真实 UI 交互——切换权限下拉 + 文件树点击预览
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
  if (r?.exceptionDetails) return 'JSERR: ' + String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 600);
  return r?.result?.value;
};

// 1. 找到权限下拉（title=权限），模拟选择 yolo
console.log('=== 模拟切换权限 ===');
console.log(await evalJs(`(async () => {
  const sel = [...document.querySelectorAll('select.model-selector')].find(s => s.title === '权限');
  if (!sel) return 'no perm select visible';
  const before = sel.value;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, 'yolo');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1500));
  return 'before=' + before + ' after=' + sel.value;
})()`));

// 2. 文件树点击代码文件，看预览面板状态
console.log('=== 文件树点击预览 ===');
console.log(await evalJs(`(async () => {
  // 先确保文件面板打开：找文件树节点
  const treeItem = [...document.querySelectorAll('*')].find(el =>
    el.className && String(el.className).includes('file') && /\\.tsx?$/.test(el.textContent ?? '') && el.textContent.length < 40);
  if (!treeItem) return 'no file tree item found (面板可能未打开): ' + document.querySelectorAll('[class*=file]').length + ' file-ish els';
  treeItem.click();
  await new Promise(r => setTimeout(r, 1200));
  const panel = document.querySelector('.preview-body');
  return panel ? 'preview-body exists, content len=' + panel.textContent.length + ' first60=' + panel.textContent.slice(0,60)
               : 'no .preview-body in DOM';
})()`));

ws.close();
process.exit(0);
