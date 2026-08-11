// 乱码检测与修复：Windows 命令 GBK 输出被上游按 UTF-8/latin1 误解码后的还原
// 实测（kimi headless Bash 工具输出）：
// - GBK 字节对若凑巧是合法 UTF-8 双字节序列 → 存为错误字符（可还原：按 utf8 编码回字节）
// - 非法序列 → U+FFFD（字节已丢失，不可还原，GBK 视角呈「锟斤拷」）
// 策略：保守检测，有把握才转换；正常 UTF-8 中文与 ASCII 原样返回。
import iconv from 'iconv-lite';

const REPLACEMENT = '�';

function countReplacement(s: string): number {
  return (s.match(/�/g) ?? []).length;
}

function countCjk(s: string): number {
  return (s.match(/[一-鿿]/g) ?? []).length;
}

// 高密度 0x80–0xFF 字符（latin1 误解码特征）
function latin1ishCount(s: string): number {
  let n = 0;
  for (const c of s) {
    const code = c.charCodeAt(0);
    if (code >= 0x80 && code <= 0xff) n++;
  }
  return n;
}

// 高频误读特征字（UTF-8 中文被 GBK 误读时的常见产物）
const REVERSE_MARKER = /[缂锟拷閿濮栬瘧绛璋]/;

// 反向：文本（CJK 乱码）→ GBK 编码 → UTF-8 解码，能还原出更合理中文则采纳
function tryReverseFix(text: string): string | null {
  // 保守触发：含反向特征字，或含 U+FFFD 且正向还原无效
  if (!REVERSE_MARKER.test(text)) return null;
  let candidate: string;
  try {
    candidate = iconv.decode(iconv.encode(text, 'gbk'), 'utf8');
  } catch {
    return null;
  }
  // 采纳条件：不产生新 FFFD、特征字消失、CJK 数量不减少太多
  if (candidate.includes(REPLACEMENT)) return null;
  if (REVERSE_MARKER.test(candidate)) return null;
  if (countCjk(candidate) < countCjk(text) * 0.5) return null;
  return candidate;
}

export function fixMojibake(text: string): string {
  if (!text) return text;

  // 情形 1：含 U+FFFD —— GBK 被 UTF-8 有损解码（kimi 实测形态）
  // 幸存字符按 utf8 编码可还原原 GBK 字节；丢失字节呈「锟斤拷」但其余可恢复
  if (text.includes(REPLACEMENT)) {
    const candidate = iconv.decode(Buffer.from(text, 'utf8'), 'gbk');
    // 采纳条件：替换符减少且 CJK 字符增多
    if (countReplacement(candidate) < countReplacement(text) && countCjk(candidate) > countCjk(text)) {
      return candidate;
    }
    // 正向无效时尝试反向（如 UTF-8 输出被 GBK 误读后又被截断的形态）
    return tryReverseFix(text) ?? text;
  }

  // 反向误读（缂栬瘧澶辫触 类）：UTF-8 中文被按 GBK 读
  const reversed = tryReverseFix(text);
  if (reversed !== null && countCjk(reversed) > 0) return reversed;

  // 情形 2：无中文但高密度 latin1 区间字符 —— GBK 被 latin1/cp1252 单字节解码（可完整还原）
  if (countCjk(text) === 0 && latin1ishCount(text) >= 3) {
    const bytes = Buffer.from([...text].map((c) => c.charCodeAt(0) & 0xff));
    const candidate = iconv.decode(bytes, 'gbk');
    // 采纳条件：还原后出现 CJK 且不引入替换符
    if (countCjk(candidate) > 0 && !candidate.includes(REPLACEMENT)) {
      return candidate;
    }
  }

  return text;
}

// 历史消息展示时修复：仅处理工具结果文本，不回写存储。
// 取舍说明：不回写迁移——存储保留原始数据，修复逻辑日后改进无需迁移；
// 修复为幂等纯函数且开销极小，读取时应用即可。
export function fixToolMessages<T extends { role: string; text: string }>(messages: T[]): T[] {
  let changed = false;
  const out = messages.map((msg) => {
    if (msg.role !== 'tool' || !msg.text) return msg;
    const fixed = fixMojibake(msg.text);
    if (fixed === msg.text) return msg;
    changed = true;
    return { ...msg, text: fixed };
  });
  return changed ? out : messages;
}
