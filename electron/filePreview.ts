// 文件预览：主进程读文件，限制大小，区分文本/图片/视频/二进制
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 512 * 1024; // 512KB
const WRITE_MAX_BYTES = 4 * 1024 * 1024; // 4MB 写入上限，防止误写超大文件
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.mov']);

export type FilePreview =
  | { kind: 'text'; content: string; truncated: boolean; lines: number; size: number }
  | { kind: 'image'; dataUrl: string; size: number }
  | { kind: 'video'; path: string; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'error'; message: string };

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

// 简单二进制判定：前 8KB 含 NUL 即视为二进制
function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  return sample.includes(0);
}

// 按魔数嗅探图片真实 MIME（不信任扩展名）
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf.subarray(0, 6).toString('ascii') === 'GIF87a') return 'image/gif';
  if (buf.length >= 6 && buf.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  const head = buf.subarray(0, 256).toString('utf8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
  return null;
}

// 相对路径按任务 cwd 解析（主进程自身 cwd 是安装目录，不是项目目录）
export function resolvePreviewPath(filePath: string, cwd?: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd ?? process.cwd(), filePath);
}

export function readFilePreview(filePath: string, cwd?: string): FilePreview {
  filePath = resolvePreviewPath(filePath, cwd);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { kind: 'error', message: 'not a file' };
    const ext = path.extname(filePath).toLowerCase();

    if (IMAGE_EXTS.has(ext)) {
      if (stat.size > MAX_BYTES * 4) return { kind: 'error', message: 'image too large' };
      const buf = fs.readFileSync(filePath);
      // 按文件魔数嗅探真实格式（截图工具可能产出扩展名与实际格式不符的文件）
      const mime = sniffImageMime(buf) ?? MIME[ext] ?? 'application/octet-stream';
      return { kind: 'image', dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: stat.size };
    }

    // 视频：返回 file:// URL，由前端 <video> 标签播放（避免 base64 体积过大）
    if (VIDEO_EXTS.has(ext)) {
      // Windows 路径转 file:// URL：反斜杠转正斜杠，开头加 file:///
      const url = 'file:///' + filePath.replace(/\\/g, '/').replace(/^\//, '');
      return { kind: 'video', path: url, size: stat.size };
    }

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(stat.size, MAX_BYTES));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);

    if (looksBinary(buf)) return { kind: 'binary', size: stat.size };

    const content = buf.toString('utf8');
    return {
      kind: 'text',
      content,
      truncated: stat.size > MAX_BYTES,
      lines: content.split('\n').length,
      size: stat.size,
    };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// 写入文本文件（IDE 编辑保存）：限制大小，UTF-8 写入
export interface WriteResult {
  ok: boolean;
  message?: string;
  size?: number;
}

export function writeFileContent(filePath: string, content: string, cwd?: string): WriteResult {
  filePath = resolvePreviewPath(filePath, cwd);
  if (Buffer.byteLength(content, 'utf8') > WRITE_MAX_BYTES) {
    return { ok: false, message: 'file too large to write (max 4MB)' };
  }
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    const stat = fs.statSync(filePath);
    return { ok: true, size: stat.size };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
