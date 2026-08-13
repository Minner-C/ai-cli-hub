// 展示文本清理：连续的乱码字符（锟斤拷及其变体）/ U+FFFD 折叠为单个 �（美观；可逆还原逻辑不受影响）
// 背景：锟斤拷 = U+FFFD(EF BF BD) 被按 GBK 二次解码的产物，原始字节已丢失不可还原；
// 实际输出中还有「锟缴癸拷」等错位变体，统一按乱码字符集折叠。
const MOJIBAKE_CHARS = '锟斤拷缴癸碉';

export function cleanDisplayText(text: string): string {
  return text
    .replace(new RegExp(`[${MOJIBAKE_CHARS}]{2,}`, 'g'), '�')
    .replace(/�{2,}/g, '�');
}

// ---- Markdown 规整：模型输出常把列表/标题挤在行文里（缺少空行），渲染前补齐 ----

const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s/;
const HEADING = /^\s*#{1,6}\s/;

function fixSegment(seg: string): string {
  // 1) 行内标记：中文/标点后直接跟 "- " 或 "## "（无换行）——先拆开补换行
  let s = seg
    .replace(/([一-鿿，。；：！？）】」’”*])\s*[-*]\s+(?=\S)/g, '$1\n- ')
    .replace(/([^\s\n])(#{1,6}\s)/g, '$1\n\n$2');
  // 2) 逐行：列表项/标题前若不是空行且上一行不是同类结构，补空行
  const lines = s.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = out[out.length - 1];
    const isItem = LIST_ITEM.test(line) || HEADING.test(line);
    const prevIsItem = prev !== undefined && (LIST_ITEM.test(prev) || HEADING.test(prev));
    if (isItem && prev !== undefined && prev.trim() !== '' && !prevIsItem) {
      out.push('');
    }
    out.push(line);
  }
  return out.join('\n');
}

export function normalizeMarkdown(text: string): string {
  // 按代码围栏分段，只处理非代码部分，代码块内容原样保留
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g);
  return parts.map((p, i) => (i % 2 === 1 ? p : fixSegment(p))).join('');
}
