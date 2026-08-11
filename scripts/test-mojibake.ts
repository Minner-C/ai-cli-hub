// 乱码修复单元验证：模拟 GBK 输出的两种误解码路径
import iconv from 'iconv-lite';
import { fixMojibake, fixToolMessages } from '../electron/mojibake';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

const original = '映像名称                       PID 会话名              会话#       内存使用';
const gbkBytes = iconv.encode(original, 'gbk');

// 路径 1（kimi 实测）：GBK 字节被按 UTF-8 有损解码 → 含 U+FFFD
const corrupt1 = gbkBytes.toString('utf8');
check('path1 corrupted has FFFD', corrupt1.includes('�'));
const fixed1 = fixMojibake(corrupt1);
console.log('  path1 fixed sample:', JSON.stringify(fixed1.slice(0, 40)));
check('path1 fewer FFFD', (fixed1.match(/�/g) ?? []).length < (corrupt1.match(/�/g) ?? []).length);
check('path1 recovers 映', fixed1.includes('映'));
check('path1 keeps PID', fixed1.includes('PID'));

// 路径 2：GBK 字节被按 latin1 单字节解码 → 可完整还原
const corrupt2 = iconv.decode(gbkBytes, 'latin1');
const fixed2 = fixMojibake(corrupt2);
check('path2 full recovery', fixed2 === original, fixed2.slice(0, 20));

// 正常 UTF-8 中文不误伤
const normal = '这是正常的中文输出，包含 English 和 123';
check('normal utf-8 untouched', fixMojibake(normal) === normal);

// ASCII 不误伤
const ascii = 'System    4 Services    0    24 K';
check('ascii untouched', fixMojibake(ascii) === ascii);

// 混合正常文本（中文+英文+符号）不误伤
const mixed = '文件 D:/proj/中文.md 已写入，exit 0';
check('mixed untouched', fixMojibake(mixed) === mixed);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
