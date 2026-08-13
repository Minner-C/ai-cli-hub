// HTML 自动化测试：playwright-core + 本机 Edge/Chrome，runner 经 child_process 执行
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TestRunResult {
  ok: boolean;
  error?: string;
  screenshot?: string;
}

// runner 模板：加载用户脚本（module.exports 约定）→ launch → newPage → 执行 → 收集结果
function buildRunner(scriptPath: string, baseURL: string, headless: boolean, screenshotPath: string, pwPath: string): string {
  return `
let page;
const { chromium } = require(${JSON.stringify(pwPath)});
const userScript = require(${JSON.stringify(scriptPath)});

// 轻量断言工具
const expect = {
  text: async (sel, text) => {
    const el = await page.waitForSelector(sel, { timeout: 8000 });
    const content = await el.textContent();
    if (!content || !content.includes(text)) throw new Error(\`expect text "\${text}" in "\${sel}", got "\${(content||'').slice(0,80)}"\`);
    log(\`✓ text "\${text}" in \${sel}\`);
  },
  visible: async (sel) => {
    await page.waitForSelector(sel, { state: 'visible', timeout: 8000 });
    log(\`✓ visible \${sel}\`);
  },
  url: (pattern) => {
    if (!page.url().includes(pattern)) throw new Error(\`expect url contains "\${pattern}", got "\${page.url()}"\`);
    log(\`✓ url contains "\${pattern}"\`);
  },
  title: async (pattern) => {
    const t = await page.title();
    if (!t.includes(pattern)) throw new Error(\`expect title contains "\${pattern}", got "\${t}"\`);
    log(\`✓ title contains "\${pattern}"\`);
  },
};

function log(msg) { console.log('[step]', msg); }

(async () => {
  const browser = await chromium.launch({ channel: ${JSON.stringify('msedge')}, headless: ${headless} });
  page = await browser.newPage();
  try {
    await userScript({ page, expect, baseURL: ${JSON.stringify(baseURL)}, log });
    await page.screenshot({ path: ${JSON.stringify(screenshotPath)} });
    console.log('[result] PASS');
    await browser.close();
    process.exit(0);
  } catch (err) {
    try { await page.screenshot({ path: ${JSON.stringify(screenshotPath)} }); } catch {}
    console.error('[result] FAIL:', err.message);
    console.error(err.stack);
    await browser.close();
    process.exit(1);
  }
})();
`;
}

const running = new Map<string, ChildProcess>();

// playwright-core 在 node_modules 的路径（打包后走 asarUnpack）
function playwrightPath(): string {
  // 打包后：resources/app.asar.unpacked/node_modules/playwright-core
  const unpacked = path.join(process.resourcesPath ?? '', 'app.asar.unpacked', 'node_modules', 'playwright-core');
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(process.cwd(), 'node_modules', 'playwright-core'); // 开发态绝对路径
}

export async function runTest(
  taskId: string,
  cwd: string,
  script: string,
  baseURL: string,
  headless: boolean,
  onData: (chunk: string) => void,
): Promise<TestRunResult> {
  const dir = path.join(cwd, '.ai-cli-hub');
  fs.mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, 'test.spec.cjs');
  fs.writeFileSync(scriptPath, script, 'utf8');
  const screenshotPath = path.join(dir, `test-${Date.now()}.png`);
  const runnerPath = path.join(os.tmpdir(), `aih-runner-${Date.now()}.cjs`);
  fs.writeFileSync(runnerPath, buildRunner(scriptPath, baseURL, headless, screenshotPath, playwrightPath()), 'utf8');

  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [runnerPath], {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } as Record<string, string>,
      timeout: 120_000,
      windowsHide: true,
    });
    running.set(taskId, proc);
    proc.stdout.on('data', (d) => onData(d.toString('utf8')));
    proc.stderr.on('data', (d) => onData(d.toString('utf8')));
    proc.on('error', (e) => {
      running.delete(taskId);
      resolve({ ok: false, error: e.message });
    });
    proc.on('close', (code) => {
      running.delete(taskId);
      resolve({
        ok: code === 0,
        error: code !== 0 ? `exit ${code}` : undefined,
        screenshot: fs.existsSync(screenshotPath) ? screenshotPath : undefined,
      });
    });
  });
}

export function stopTest(taskId: string): void {
  running.get(taskId)?.kill();
  running.delete(taskId);
}

export function loadTestScript(cwd: string): string {
  const p = path.join(cwd, '.ai-cli-hub', 'test.spec.cjs');
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

export function saveTestScript(cwd: string, script: string): void {
  const dir = path.join(cwd, '.ai-cli-hub');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'test.spec.cjs'), script, 'utf8');
}
