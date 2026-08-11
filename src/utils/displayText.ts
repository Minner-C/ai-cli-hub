// 展示文本清理：连续的乱码字符（锟斤拷及其变体）/ U+FFFD 折叠为单个 �（美观；可逆还原逻辑不受影响）
// 背景：锟斤拷 = U+FFFD(EF BF BD) 被按 GBK 二次解码的产物，原始字节已丢失不可还原；
// 实际输出中还有「锟缴癸拷」等错位变体，统一按乱码字符集折叠。
const MOJIBAKE_CHARS = '锟斤拷缴癸碉';

export function cleanDisplayText(text: string): string {
  return text
    .replace(new RegExp(`[${MOJIBAKE_CHARS}]{2,}`, 'g'), '�')
    .replace(/�{2,}/g, '�');
}
