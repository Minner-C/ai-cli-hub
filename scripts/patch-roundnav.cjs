// 补丁：刻度 hover 联动标签
const fs = require('fs');
const p = 'src/components/RoundNav.tsx';
let s = fs.readFileSync(p, 'utf8');

s = s.replace(
  "const [activeId, setActiveId] = useState<string | null>(null);",
  "const [activeId, setActiveId] = useState<string | null>(null);\n  const [hoverId, setHoverId] = useState<string | null>(null);"
);

s = s.replace(
  "        onMouseEnter={() => setOpen(true)}",
  "        onMouseEnter={() => setOpen(true)}\n        onMouseLeave={() => setHoverId(null)}"
);

s = s.replace(
  "            className={`round-tick ${r.id === activeId ? 'active' : ''}`}",
  "            className={`round-tick ${r.id === activeId ? 'active' : ''}`}\n            onMouseEnter={() => setHoverId(r.id)}"
);

s = s.replace(
  "className={`round-nav-item ${r.id === activeId ? 'active' : ''}`}",
  "className={`round-nav-item ${r.id === activeId ? 'active' : ''} ${r.id === hoverId ? 'hover' : ''}`}"
);

fs.writeFileSync(p, s);
console.log(s.includes('hoverId') && s.includes("? 'hover' : ''") ? 'PATCH OK' : 'PATCH FAILED');
