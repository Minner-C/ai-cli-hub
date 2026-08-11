// 补丁：刻度/标签高亮双向同步 + 刻度热区扩大（视觉不变）
const fs = require('fs');
const p = 'src/components/RoundNav.tsx';
let s = fs.readFileSync(p, 'utf8');

// 1. 刻度类名加 hover 同步（标签悬停 → 刻度高亮）
const tickClass = 'className={`round-tick ${r.id === activeId ? \'active\' : \'\'}`}';
const tickClassNew = 'className={`round-tick ${r.id === activeId ? \'active\' : \'\'} ${r.id === hoverId ? \'hover\' : \'\'}`}';
if (!s.includes(tickClass)) throw new Error('tick anchor not found');
s = s.replace(tickClass, tickClassNew);

// 2. 标签悬停也写 hoverId（双向同步）
const labelClick = /(style=\{\{ top: i \* PITCH \+ PITCH \/ 2 \}\}\n)(\s+)(onClick=\{\(e\) => \{\n\s+e\.stopPropagation\(\);\n\s+jump\(r\.id\);\n\s+\}\})/;
const m = s.match(labelClick);
if (!m) throw new Error('label anchor not found');
s = s.replace(labelClick, `$1$2onMouseEnter={() => setHoverId(r.id)}\n$2$3`);

fs.writeFileSync(p, s);
console.log('PATCH OK');
