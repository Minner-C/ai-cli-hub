// Skill 管理：扫描用户级/项目级 skill 目录，启用/禁用/新建/删除/打开
// 目录约定（kimi 官方文档核实）：
//   kimi:   用户级 ~/.kimi-code/skills、~/.agents/skills；项目级 <cwd>/.kimi-code/skills、<cwd>/.agents/skills
//   claude: 用户级 ~/.claude/skills；项目级 <cwd>/.claude/skills
//   目录形式 <name>/SKILL.md 优先，平铺形式 <name>.md；frontmatter 含 name/description
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shell } from 'electron';
import type { CliId, SkillInfo, SkillScope, SkillTemplate } from './shared';

const home = () => os.homedir();

// 各 CLI 的扫描目录；gemini/codex 无 skill 机制
function skillDirs(cli: CliId, cwd?: string): Array<{ dir: string; scope: SkillScope }> {
  const dirs: Array<{ dir: string; scope: SkillScope }> = [];
  if (cli === 'kimi') {
    dirs.push({ dir: path.join(home(), '.kimi-code', 'skills'), scope: 'user' });
    dirs.push({ dir: path.join(home(), '.agents', 'skills'), scope: 'user' });
    if (cwd) {
      dirs.push({ dir: path.join(cwd, '.kimi-code', 'skills'), scope: 'project' });
      dirs.push({ dir: path.join(cwd, '.agents', 'skills'), scope: 'project' });
    }
  } else if (cli === 'claude') {
    dirs.push({ dir: path.join(home(), '.claude', 'skills'), scope: 'user' });
    if (cwd) dirs.push({ dir: path.join(cwd, '.claude', 'skills'), scope: 'project' });
  }
  return dirs;
}

export function skillsSupported(cli: CliId): boolean {
  return cli === 'kimi' || cli === 'claude';
}

// 从 SKILL.md / .md 内容解析 frontmatter 的 name/description（轻量解析，不引入 yaml 依赖）
export function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const body = match[1];
  const grab = (key: string) => {
    const m = body.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  };
  return { name: grab('name'), description: grab('description') };
}

function readDesc(file: string, fallback: string): { name?: string; description: string } {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(content);
    if (fm.description) return { name: fm.name, description: fm.description };
    // 平铺形式缺 description 时取正文首个非空行（≤240 字符）
    const body = content.replace(/^---[\s\S]*?---/, '').trim();
    const firstLine = body.split(/\r?\n/).find((l) => l.trim());
    return { name: fm.name, description: (firstLine ?? fallback).slice(0, 240) };
  } catch {
    return { description: fallback };
  }
}

// 扫描所有目录，汇总 skills（禁用以 .disabled 后缀标识）；同步部分仅用户级/项目级
export function listDirSkills(cli: CliId, cwd?: string): SkillInfo[] {
  const result: SkillInfo[] = [];
  for (const { dir, scope } of skillDirs(cli, cwd)) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const disabled = entry.name.endsWith('.disabled');
        const baseName = disabled ? entry.name.slice(0, -'.disabled'.length) : entry.name;
        const skillFile = path.join(full, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        const meta = readDesc(skillFile, baseName);
        result.push({
          name: meta.name ?? baseName,
          description: meta.description,
          scope,
          enabled: !disabled,
          path: full,
          dirForm: true,
        });
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.md.disabled')) {
        const disabled = entry.name.endsWith('.disabled');
        const fileName = disabled ? entry.name.slice(0, -'.disabled'.length) : entry.name;
        const baseName = fileName.replace(/\.md$/, '');
        const meta = readDesc(full, baseName);
        result.push({
          name: meta.name ?? baseName,
          description: meta.description,
          scope,
          enabled: !disabled,
          path: full,
          dirForm: false,
        });
      }
    }
  }
  return result;
}

// 启用/禁用：重命名加/去 .disabled 后缀
export function toggleSkill(p: string, enable: boolean): void {
  const disabled = p.endsWith('.disabled');
  if (enable && disabled) {
    fs.renameSync(p, p.slice(0, -'.disabled'.length));
  } else if (!enable && !disabled) {
    fs.renameSync(p, p + '.disabled');
  }
}

const SKILL_TEMPLATE = (name: string, description: string) => `---
name: ${name}
description: ${description}
type: prompt
whenToUse: When the user asks about ${name}
---

TODO: 在这里编写 Skill 的具体指令内容。
`;

// 新建用户级 skill（目录形式）；content 为空时用默认模板
export function createSkill(cli: CliId, name: string, description: string, content?: string): SkillInfo {
  const base =
    cli === 'kimi'
      ? path.join(home(), '.kimi-code', 'skills')
      : path.join(home(), '.claude', 'skills');
  const safe = name.replace(/[^\w-]/g, '-');
  const dir = path.join(base, safe);
  if (fs.existsSync(dir)) throw new Error(`skill already exists: ${safe}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content ?? SKILL_TEMPLATE(safe, description), 'utf8');
  return { name: safe, description, scope: 'user', enabled: true, path: dir, dirForm: true };
}

export function deleteSkill(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

export async function openSkill(p: string): Promise<void> {
  // 目录形式打开其中的 SKILL.md，平铺形式直接打开文件
  const target = fs.statSync(p).isDirectory() ? path.join(p, 'SKILL.md') : p;
  await shell.openPath(target);
}

// ---- 内置 Skill 模板：常用编程辅助 skill，一键创建为用户级 skill ----
// 内存硬编码、不落盘；创建后即为普通用户级 skill，可编辑/删除
const BUILTIN_SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: 'code-review',
    name: 'code-review',
    description: '审查代码变更，指出问题并给出改进建议',
    content: `---
name: code-review
description: 审查代码变更，指出问题并给出改进建议
type: prompt
whenToUse: 当用户要求审查代码、Review PR 或检查代码质量时
---

你是一位资深代码审查专家。请按以下流程审查代码：

1. **理解意图**：先通读变更，明确改动目的与上下文。
2. **逐项检查**：
   - 正确性：逻辑是否正确，边界条件是否覆盖
   - 可读性：命名、注释、结构是否清晰
   - 安全性：是否存在注入、越权、敏感信息泄漏
   - 性能：是否存在不必要的开销、N+1 查询
   - 一致性：是否与现有代码风格一致
3. **输出格式**：
   - 用「严重 / 建议 / 优化」三档分级
   - 每条问题引用具体文件与行号
   - 给出可执行的修改建议（而非泛泛而谈）
4. **总结**：给出整体评价与是否可合并的结论。
`,
  },
  {
    id: 'commit-message',
    name: 'commit-message',
    description: '根据代码变更生成规范的 Git 提交信息',
    content: `---
name: commit-message
description: 根据代码变更生成规范的 Git 提交信息
type: prompt
whenToUse: 当用户需要写提交信息、Commit Message 或准备提交时
---

请根据当前暂存区的代码变更生成 Git 提交信息，遵循 Conventional Commits 规范：

1. **分析变更**：运行 \`git diff --cached\` 查看暂存区改动。
2. **判定类型**：从 feat / fix / docs / style / refactor / perf / test / chore / build / ci 中选最贴切的一个。
3. **撰写标题**：不超过 50 字符，祈使句，首字母小写，不加句号。
4. **撰写正文**（可选）：说明「为什么」改动，每行 ≤72 字符。
5. **关联 Issue**：如有关联 issue，在末尾加 \`Closes #xxx\`。

输出格式：
\`\`\`
<type>(<scope>): <subject>

<body>

<footer>
\`\`\`
仅输出提交信息本身，不要多余解释。
`,
  },
  {
    id: 'refactor',
    name: 'refactor',
    description: '重构代码以提升结构清晰度，不改变外部行为',
    content: `---
name: refactor
description: 重构代码以提升结构清晰度，不改变外部行为
type: prompt
whenToUse: 当用户要求重构、改善代码结构或消除坏味道时
---

你是重构专家。请遵循 Martin Fowler《重构》的原则：

1. **先保证行为不变**：重构前确认有测试覆盖；若无，先补特征测试。
2. **小步前进**：每次只做一处改动，立即运行测试。
3. **识别坏味道**：长函数、过大类、重复代码、发散式变化、霰弹式修改等。
4. **应用手法**：提取函数、内联变量、搬移函数、以多态取代条件等。
5. **输出**：
   - 列出发现的问题与对应重构手法
   - 给出重构后的完整代码
   - 说明每步改动的原因
不要为了重构而重构；若代码已足够清晰，请直接说明。
`,
  },
  {
    id: 'test-generation',
    name: 'test-generation',
    description: '为指定代码生成单元测试用例',
    content: `---
name: test-generation
description: 为指定代码生成单元测试用例
type: prompt
whenToUse: 当用户要求写测试、补测试用例或提升覆盖率时
---

请为目标代码生成单元测试：

1. **理解代码**：明确被测函数/类的输入输出契约与副作用。
2. **选择框架**：按项目现有依赖选择（Jest/Vitest/PyTest/Go test 等），保持一致。
3. **覆盖用例**：
   - 正常路径（典型输入）
   - 边界值（空、零、最大/最小）
   - 异常路径（错误输入、依赖失败）
   - 幂等性/并发（如适用）
4. **命名**：用「should <期望> when <条件>」或中文描述，清晰表达意图。
5. **断言**：每个用例只验证一个行为，断言精确，避免模糊的 toBeTruthy。
6. **Mock**：仅 mock 外部依赖（网络/文件/时间），不要 mock 被测对象本身。

输出完整可运行的测试文件，并在末附运行命令。
`,
  },
  {
    id: 'doc-gen',
    name: 'doc-gen',
    description: '为代码生成文档注释与 API 说明',
    content: `---
name: doc-gen
description: 为代码生成文档注释与 API 说明
type: prompt
whenToUse: 当用户要求写文档、补注释或生成 API 文档时
---

请为指定代码生成文档：

1. **识别读者**：区分「使用方文档」与「维护方文档」。
2. **公共 API**：每个导出函数/类/接口补注释，包含：
   - 一句话功能说明
   - 参数：类型、含义、是否必填
   - 返回值：类型与含义
   - 抛出异常：何时抛出
   - 示例用法
3. **格式**：遵循语言生态惯例（JSDoc / docstring / JavaDoc / Rust doc）。
4. **维护注释**：仅在复杂逻辑处补「为什么」注释，不解释语法。
5. **README**：如需要，生成包含安装、用法、配置、FAQ 的 README。

保持简洁，避免冗余；让代码本身说话，文档补充意图与约束。
`,
  },
  {
    id: 'bug-fix',
    name: 'bug-fix',
    description: '系统化定位并修复 Bug',
    content: `---
name: bug-fix
description: 系统化定位并修复 Bug
type: prompt
whenToUse: 当用户报告 Bug、要求排查问题或修复错误时
---

请按科学方法排查 Bug：

1. **复现**：明确复现步骤、环境、预期与实际表现。
2. **定位**：
   - 阅读相关代码与日志，找到最小复现路径
   - 用二分法缩小范围（git bisect / 注释法）
   - 提出假设并验证，不要靠猜
3. **根因**：找到真正的根本原因，而非仅修复表象。
4. **修复**：
   - 最小改动修复问题，不夹带重构
   - 添加或调整测试，确保该 Bug 不再复现
5. **回归**：运行相关测试，确认未引入新问题。
6. **总结**：说明根因、修复方式、预防措施。

输出：根因分析 + 修复后的代码 + 新增测试。
`,
  },
  {
    id: 'explain',
    name: 'explain',
    description: '用通俗语言解释代码逻辑与设计意图',
    content: `---
name: explain
description: 用通俗语言解释代码逻辑与设计意图
type: prompt
whenToUse: 当用户要求解释代码、看不懂某段逻辑或学习现有代码时
---

请帮助用户理解代码：

1. **整体概览**：先用一句话说明这段代码「做什么」。
2. **分层讲解**：
   - 入口与主流程
   - 关键数据结构
   - 核心算法或业务逻辑
   - 与外部的交互（IO、网络、事件）
3. **设计意图**：解释「为什么这样写」，指出设计模式与权衡。
4. **关键细节**：标注容易踩坑的点（并发、资源释放、边界）。
5. **类比**：对复杂概念用生活类比帮助理解。

按读者水平调整深度；遇到用户追问，深入展开。避免逐行翻译代码，要讲清「为什么」。
`,
  },
  {
    id: 'optimize',
    name: 'optimize',
    description: '分析性能瓶颈并给出优化方案',
    content: `---
name: optimize
description: 分析性能瓶颈并给出优化方案
type: prompt
whenToUse: 当用户要求优化性能、加速、减少内存或排查慢查询时
---

你是性能优化专家。请遵循「测量优先」原则：

1. **测量**：先确认瓶颈所在，不要盲目优化。
   - 时间：profiler / 性能分析 / 计时
   - 内存：heap snapshot / RSS
   - IO：磁盘/网络吞吐
2. **分析**：定位热点函数与资源消耗点，给出量化数据。
3. **方案**：按「收益/成本」排序，给出多个优化层级：
   - 算法层：换更优复杂度（O(n²) → O(n log n)）
   - 结构层：缓存、索引、批处理、异步
   - 实现层：减少分配、避免重复计算、内联
4. **实施**：每次只改一处，重新测量验证收益。
5. **权衡**：说明每项优化的代价（内存换时间、可读性换速度）。

输出：瓶颈报告 + 优化后代码 + 前后对比数据。警惕过早优化。
`,
  },
];

export function listSkillTemplates(): SkillTemplate[] {
  return BUILTIN_SKILL_TEMPLATES;
}

// 从模板创建用户级 skill（若重名则追加 -2/-3 后缀）
export function createSkillFromTemplate(cli: CliId, templateId: string): SkillInfo {
  const tpl = BUILTIN_SKILL_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) throw new Error(`skill template not found: ${templateId}`);
  const base =
    cli === 'kimi'
      ? path.join(home(), '.kimi-code', 'skills')
      : path.join(home(), '.claude', 'skills');
  // 重名时追加数字后缀
  let safe = tpl.name.replace(/[^\w-]/g, '-');
  let dir = path.join(base, safe);
  let n = 2;
  while (fs.existsSync(dir)) {
    safe = `${tpl.name}-${n}`;
    dir = path.join(base, safe);
    n++;
  }
  fs.mkdirSync(dir, { recursive: true });
  // 替换 frontmatter 中的 name 为最终 safe 名
  const content = tpl.content.replace(/^name: .*/m, `name: ${safe}`);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
  return { name: safe, description: tpl.description, scope: 'user', enabled: true, path: dir, dirForm: true };
}
