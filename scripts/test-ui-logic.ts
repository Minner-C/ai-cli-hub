// 单元验证：diff 计算 / claude thinking 解析 / 文件预览
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeLineDiff, collapseContext } from '../src/utils/diffUtil';
import { HEADLESS_ADAPTERS } from '../electron/headlessManager';
import { readFilePreview, resolvePreviewPath } from '../electron/filePreview';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

// ---- diff ----
const d1 = computeLineDiff('line1\nline2\nline3\n', 'line1\nline2 changed\nline3\n');
check('diff del+add', d1.some((l) => l.type === 'del' && l.text === 'line2') && d1.some((l) => l.type === 'add' && l.text === 'line2 changed'), d1);
check('diff ctx kept', d1.filter((l) => l.type === 'ctx').length === 2);

const d2 = computeLineDiff('', 'new file\ncontent\n');
check('diff new file all add', d2.every((l) => l.type === 'add') && d2.length === 2, d2);

// collapseContext：20 行上下文 + 1 处改动
const oldBig = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n') + '\n';
const newBig = oldBig.replace('l10', 'l10 changed');
const collapsed = collapseContext(computeLineDiff(oldBig, newBig), 3);
check('collapse folds', collapsed.some((r) => r.type === 'fold'), collapsed.filter((r) => r.type !== 'fold').length);
check('collapse keeps change', collapsed.some((r) => r.type === 'add' && (r as { text?: string }).text === 'l10 changed'));

// ---- claude thinking 解析 ----
const evs = HEADLESS_ADAPTERS.claude.parseLine(
  '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"let me think"},{"type":"text","text":"answer"}]}}',
);
check('claude thinking event', JSON.stringify(evs) === JSON.stringify([
  { type: 'thinking', text: 'let me think' },
  { type: 'delta', text: 'answer' },
]), evs);

// ---- 文件预览 ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-preview-'));
const textFile = path.join(tmp, 'a.ts');
fs.writeFileSync(textFile, 'const x = 1;\n'.repeat(100));
const p1 = readFilePreview(textFile);
check('preview text', p1.kind === 'text' && p1.lines === 101 && !p1.truncated, p1.kind); // 尾部换行 → 101

const bigFile = path.join(tmp, 'big.txt');
fs.writeFileSync(bigFile, 'x'.repeat(600 * 1024));
const p2 = readFilePreview(bigFile);
check('preview truncated at 512KB', p2.kind === 'text' && p2.truncated && p2.content.length === 512 * 1024);

const binFile = path.join(tmp, 'b.bin');
fs.writeFileSync(binFile, Buffer.from([0x89, 0x50, 0x00, 0x47, 1, 2, 3]));
const p3 = readFilePreview(binFile);
check('preview binary', p3.kind === 'binary', p3.kind);

// 最小合法 PNG（1x1）
const pngFile = path.join(tmp, 'i.png');
fs.writeFileSync(pngFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const p4 = readFilePreview(pngFile);
check('preview image dataUrl', p4.kind === 'image' && p4.dataUrl.startsWith('data:image/png;base64,'));

const p5 = readFilePreview(path.join(tmp, 'missing.txt'));
check('preview missing error', p5.kind === 'error');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
