// 真实窗口拉伸验证：拉宽窗口，预览区是否吃下增量、对话区是否不变
const list = await (await fetch('http://localhost:9334/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res } = pending.get(m.id);
    pending.delete(m.id);
    res(m);
  }
};
await new Promise((r) => (ws.onopen = r));
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.result?.exceptionDetails) return 'JSERR';
  return r.result?.result?.value;
};
const MEASURE =
  "Math.round(document.querySelector('.right-panel-wrap')?.getBoundingClientRect().width ?? -1) + '/' + Math.round(document.querySelector('.main')?.getBoundingClientRect().width ?? -1) + ' win:' + window.innerWidth";

const win = await send('Browser.getWindowForTarget', { targetId: page.id });
const windowId = win.result?.result?.windowId ?? win.result?.windowId;

const before = await evalJs(MEASURE);
if (windowId) {
  await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await send('Browser.setWindowBounds', { windowId, bounds: { width: 1500, height: 850 } });
  await new Promise((r) => setTimeout(r, 1000));
}
const wider = await evalJs(MEASURE);
console.log(JSON.stringify({ before, afterWiden1500: wider }));
ws.close();
process.exit(0);
