// 验证：窗口拉宽时增量补给预览栏，对话区宽度不变
const list = await (await fetch('http://localhost:9334/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r?.exceptionDetails ? 'JSERR' : r?.result?.value;
};
const MEASURE = `Math.round(document.querySelector('.right-panel-wrap')?.getBoundingClientRect().width ?? -1) + '/' + Math.round(document.querySelector('.main')?.getBoundingClientRect().width ?? -1)`;

const before = await evalJs(MEASURE);
await send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 800, deviceScaleFactor: 1, mobile: false });
await new Promise((r) => setTimeout(r, 900));
const wider = await evalJs(MEASURE);
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await new Promise((r) => setTimeout(r, 900));
const narrower = await evalJs(MEASURE);
await send('Emulation.clearDeviceMetricsOverride');
console.log(JSON.stringify({ note: '右栏/对话区', before1280: before, wider1480: wider, narrower1100: narrower }));
ws.close();
process.exit(0);
