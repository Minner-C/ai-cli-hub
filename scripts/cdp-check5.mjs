// CDP：点击消息中的文件路径链接 → 观察预览标签页与控制台错误
const list = await (await fetch('http://localhost:9334/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const events = [];
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    events.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  } else if (m.method === 'Runtime.exceptionThrown') {
    events.push('EXCEPTION: ' + String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 400));
  }
};
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return 'JSERR: ' + String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 800);
  return r?.result?.value;
};

// 找一个代码文件路径链接并点击
console.log(await evalJs(`(async () => {
  const links = [...document.querySelectorAll('.path-link')];
  const code = links.find(l => /\\.(tsx?|css|json|cs)$/.test(l.textContent ?? ''));
  if (!code) return 'no code path-link found, total links=' + links.length;
  const name = code.textContent;
  code.click();
  await new Promise(r => setTimeout(r, 2500));
  const monaco = document.querySelector('.preview-monaco, .monaco-editor');
  const body = document.querySelector('.preview-body');
  return {
    clicked: name,
    tabOpened: !!document.querySelector('.right-tab'),
    monacoPresent: !!monaco,
    monacoLines: document.querySelectorAll('.monaco-editor .view-line').length,
    bodyClass: body?.className,
    bodyText: (body?.textContent ?? '').slice(0, 120),
  };
})()`));

console.log('=== console errors/warnings ===');
console.log(events.length ? events.slice(0, 10) : 'none');
ws.close();
process.exit(0);
