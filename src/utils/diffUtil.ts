// 行级 diff 计算（基于 diff 包），供 Write/Edit 工具卡片渲染
import { diffLines } from 'diff';

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
}

// 计算旧文本 → 新文本的行级差异；oldText 为空（新增文件）时全绿
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const parts = diffLines(oldText, newText);
  const lines: DiffLine[] = [];
  for (const part of parts) {
    const type: DiffLine['type'] = part.added ? 'add' : part.removed ? 'del' : 'ctx';
    const partLines = part.value.replace(/\n$/, '').split('\n');
    for (const text of partLines) lines.push({ type, text });
  }
  return lines;
}

// 限制上下文行数，折叠过长的未变化区域
export function collapseContext(lines: DiffLine[], keep = 3): Array<DiffLine | { type: 'fold'; count: number }> {
  const out: Array<DiffLine | { type: 'fold'; count: number }> = [];
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart < 0) return;
    const count = end - runStart;
    if (count > keep * 2) {
      out.push(...lines.slice(runStart, runStart + keep));
      out.push({ type: 'fold', count: count - keep * 2 });
      out.push(...lines.slice(end - keep, end));
    } else {
      out.push(...lines.slice(runStart, end));
    }
    runStart = -1;
  };
  lines.forEach((line, i) => {
    if (line.type === 'ctx') {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
      out.push(line);
    }
  });
  flush(lines.length);
  return out;
}
