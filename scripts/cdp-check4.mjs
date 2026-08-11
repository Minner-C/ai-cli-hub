// CDP：打开右栏文件 tab → 点击代码文件 → 检查预览渲染
const list = await (await fetch('http://localhost:9333/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return 'JSERR: ' + String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 800);
  return r?.result?.value;
};

// 右栏结构探测
console.log(await evalJs(`({
  rightPanel: !!document.querySelector('[class*=right]'),
  tabs: [...document.querySelectorAll('[class*=tab]')].map(e => e.className + '|' + (e.textContent||'').slice(0,10)).slice(0,10),
  treeEls: document.querySelectorAll('[class*=tree],[class*=file]').length,
})`));

// 列出右栏所有可点击文本（找 tab 与文件节点）
console.log(await evalJs(`[...document.querySelectorAll('button, [role=tab], [class*=node], [class*=item]')]
  .map(e => e.className.toString().slice(0,40) + ' => ' + (e.textContent||'').trim().slice(0,25))
  .filter(s => s.length > 5).slice(0, 30)`));

ws.close();
process.exit(0);
