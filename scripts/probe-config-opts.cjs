// 探针：dump kimi 0.34 ACP 的 configOptions（看 plan 是否独立设置项）
const { spawn } = require('child_process');

const proc = spawn('C:/Users/Administrator/.kimi-code/bin/kimi.exe', ['acp'], {
  cwd: 'D:/cloud/华为家庭存储/工作资料/开发/ai-cli-hub',
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
const pending = new Map();
let idSeq = 0;
function send(method, params) {
  const id = ++idSeq;
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((res) => pending.set(id, res));
}
proc.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.id && pending.has(obj.id)) {
        pending.get(obj.id)(obj);
        pending.delete(obj.id);
      }
    } catch { /* ignore */ }
  }
});
proc.stderr.on('data', () => {});

const run = async () => {
  await send('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: 'probe', version: '0.1' },
  });
  await send('authenticate', { methodId: 'login' }).catch(() => null);
  const res = await send('session/new', { cwd: 'D:/cloud/华为家庭存储/工作资料/开发/ai-cli-hub', mcpServers: [] });
  const opts = res.result?.configOptions ?? [];
  for (const o of opts) {
    console.log('OPTION:', o.id, '|', o.category, '|', o.currentValue, '|', (o.options ?? []).map((x) => x.value).join(', '));
  }
  proc.kill();
  process.exit(0);
};
run();
setTimeout(() => { proc.kill(); process.exit(1); }, 30000);
