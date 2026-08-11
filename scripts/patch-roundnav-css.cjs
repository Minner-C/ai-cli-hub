// 补丁：刻度热区无缝（视觉 4x8 不变，热区铺满整格）
const fs = require('fs');
const p = 'src/app.css';
let s = fs.readFileSync(p, 'utf8');

const oldTick = `.round-tick {
  position: absolute; right: 2px; width: 4px; height: 8px; transform: translateY(-50%);
  background: var(--fg-muted); opacity: 0.22; border-radius: 999px;
  transition: opacity 0.15s; cursor: pointer;
}
.round-nav-rail:hover .round-tick { opacity: 0.45; }
.round-tick:hover { opacity: 0.9 !important; }
.round-tick.active { opacity: 0.85; background: var(--fg); }`;

const newTick = `/* 刻度：视觉条不变（::before），热区铺满整格（全间距 + 加宽）无缝滑动 */
.round-tick {
  position: absolute; right: 0; width: 14px; height: 20px; transform: translateY(-50%);
  cursor: pointer; background: transparent;
}
.round-tick::before {
  content: ''; position: absolute; right: 2px; top: 50%; transform: translateY(-50%);
  width: 4px; height: 8px; border-radius: 999px;
  background: var(--fg-muted); opacity: 0.22; transition: opacity 0.15s;
}
.round-nav-rail:hover .round-tick::before { opacity: 0.45; }
.round-tick.hover::before { opacity: 0.9; background: var(--fg); }
.round-tick.active::before { opacity: 0.85; background: var(--fg); }`;

if (!s.includes(oldTick)) throw new Error('tick css not found');
s = s.replace(oldTick, newTick);
fs.writeFileSync(p, s);
console.log('CSS PATCH OK');
