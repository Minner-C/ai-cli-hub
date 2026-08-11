// 文件面板与图片附件：目录懒加载读取、图片落盘
import fs from 'node:fs';
import path from 'node:path';

const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'release', 'build', 'out', '.ai-cli-hub']);

export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
}

// 读一级目录：文件夹优先，排除常见噪音目录
export function listDir(dir: string): DirEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: DirEntry[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.ai-cli-hub') continue;
    if (EXCLUDE.has(e.name)) continue;
    let size = 0;
    if (e.isFile()) {
      try {
        size = fs.statSync(path.join(dir, e.name)).size;
      } catch { /* ignore */ }
    }
    result.push({ name: e.name, isDir: e.isDirectory(), size });
  }
  result.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return result;
}

// 递归收集文件相对路径（搜索用，限深限数）
export function listFilesFlat(dir: string, maxDepth = 4, limit = 2000): string[] {
  const out: string[] = [];
  const walk = (cur: string, rel: string, depth: number) => {
    if (depth > maxDepth || out.length >= limit) return;
    for (const e of listDir(cur)) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDir) walk(path.join(cur, e.name), r, depth + 1);
      else out.push(r);
      if (out.length >= limit) return;
    }
  };
  walk(dir, '', 1);
  return out;
}

// 图片落盘：base64 → 项目临时目录 .ai-cli-hub/images/
export function saveImage(cwd: string, dataBase64: string, mimeType: string): string {
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  const dir = path.join(cwd, '.ai-cli-hub', 'images');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
  fs.writeFileSync(file, Buffer.from(dataBase64, 'base64'));
  return file;
}
