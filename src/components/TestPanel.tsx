// 自动化测试面板：脚本编辑 + URL + 运行/停止 + headless + 日志 + 截图
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, Save, RotateCw } from 'lucide-react';
import { useHubStore } from '../store';
import type { Task } from '../../electron/shared';

const TEMPLATE = `// 自动化测试脚本（Playwright）
// 可用：page（页面）、expect（断言）、baseURL、log（步骤日志）
module.exports = async ({ page, expect, baseURL, log }) => {
  log('打开页面 ' + baseURL);
  await page.goto(baseURL);
  await expect.title('Example');
  await expect.text('h1', 'Example Domain');
  log('全部通过');
};
`;

export default function TestPanel({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { setPreviewPath } = useHubStore();
  const [script, setScript] = useState('');
  const [baseURL, setBaseURL] = useState('https://example.com');
  const [headless, setHeadless] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState('');
  const [result, setResult] = useState<{ ok: boolean; error?: string; screenshot?: string } | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // 加载已存脚本
  useEffect(() => {
    void window.hub.loadTestScript(task.cwd).then((s) => setScript(s || TEMPLATE));
  }, [task.cwd]);

  // 流式输出
  useEffect(() => {
    const off = window.hub.onTestOutput((taskId, chunk) => {
      if (taskId !== task.id) return;
      setLog((cur) => (cur + chunk).slice(-8000));
    });
    return off;
  }, [task.id]);

  // 日志滚底
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const run = async () => {
    setRunning(true);
    setLog('');
    setResult(null);
    await window.hub.saveTestScript(task.cwd, script);
    const res = await window.hub.runTest(task.id, task.cwd, script, baseURL, headless);
    setResult(res);
    setRunning(false);
  };

  const stop = async () => {
    await window.hub.stopTest(task.id);
    setRunning(false);
  };

  return (
    <div className="test-panel">
      <div className="test-toolbar">
        <input
          className="test-url"
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder="https://example.com"
        />
        <label className="checkbox-label" title={t('test.headlessHint')}>
          <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} />
          <span className="hint">{t('test.headless')}</span>
        </label>
        {running ? (
          <button className="test-btn danger" onClick={() => void stop()}>
            <Square size={12} /> {t('test.stop')}
          </button>
        ) : (
          <button className="test-btn" onClick={() => void run()}>
            <Play size={12} /> {t('test.run')}
          </button>
        )}
        <button className="icon-btn" title={t('test.save')} onClick={() => void window.hub.saveTestScript(task.cwd, script)}>
          <Save size={13} />
        </button>
        <button className="icon-btn" title={t('test.reset')} onClick={() => setScript(TEMPLATE)}>
          <RotateCw size={13} />
        </button>
      </div>

      <textarea
        className="test-editor"
        value={script}
        onChange={(e) => setScript(e.target.value)}
        spellCheck={false}
      />

      {log && (
        <pre ref={logRef} className="test-log">{log}</pre>
      )}

      {result && (
        <div className={`test-result ${result.ok ? 'ok' : 'fail'}`}>
          {result.ok ? `✓ ${t('test.pass')}` : `✕ ${t('test.fail')}: ${result.error ?? ''}`}
        </div>
      )}

      {result?.screenshot && (
        <div className="test-shot">
          <img
            src={`file://${result.screenshot}`}
            alt="screenshot"
            onClick={() => setPreviewPath(result.screenshot!)}
          />
        </div>
      )}
    </div>
  );
}
