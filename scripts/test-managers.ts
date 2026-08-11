// 管理器单元验证：skill 扫描/启停、MCP json/toml 读写往返、frontmatter 解析
// 用 USERPROFILE 环境变量伪造 home，避免触碰真实配置
// 运行: esbuild bundle 后 node 执行（skillManager 引 electron 仅 shell.openPath，测试中不调用）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-home-'));
const TMP_PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-proj-'));
process.env.USERPROFILE = TMP_HOME;
process.env.HOME = TMP_HOME;

import { listDirSkills, toggleSkill, parseFrontmatter, createSkill, deleteSkill } from '../electron/skillManager';
import { listMcpServers, upsertMcpServer, deleteMcpServer, setMcpEnabled } from '../electron/mcpManager';
import { modelArgs } from '../electron/modelManager';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

// ---- frontmatter ----
const fm = parseFrontmatter('---\nname: code-style\ndescription: Project style guide\ntype: prompt\n---\n\nbody');
check('frontmatter name', fm.name === 'code-style', fm);
check('frontmatter description', fm.description === 'Project style guide', fm);
check('frontmatter missing', Object.keys(parseFrontmatter('no frontmatter')).length === 0);

// ---- skills ----
const kimiSkills = path.join(TMP_HOME, '.kimi-code', 'skills');
fs.mkdirSync(path.join(kimiSkills, 's1'), { recursive: true });
fs.writeFileSync(path.join(kimiSkills, 's1', 'SKILL.md'), '---\nname: s1\ndescription: first skill\n---\nbody');
fs.writeFileSync(path.join(kimiSkills, 's2.md'), '---\ndescription: second skill\n---\nbody');
fs.mkdirSync(path.join(kimiSkills, 's3.disabled'), { recursive: true });
fs.writeFileSync(path.join(kimiSkills, 's3.disabled', 'SKILL.md'), '---\nname: s3\ndescription: third\n---\nbody');
// 项目级
const projSkills = path.join(TMP_PROJ, '.kimi-code', 'skills');
fs.mkdirSync(path.join(projSkills, 'p1'), { recursive: true });
fs.writeFileSync(path.join(projSkills, 'p1', 'SKILL.md'), '---\nname: p1\ndescription: project skill\n---\nbody');

let list = listDirSkills('kimi', TMP_PROJ);
check('skill count', list.length === 4, list.map((s) => s.name));
check('skill s1 enabled user', list.some((s) => s.name === 's1' && s.enabled && s.scope === 'user'));
check('skill s2 flat enabled', list.some((s) => s.name === 's2' && s.enabled && !s.dirForm));
check('skill s3 disabled', list.some((s) => s.name === 's3' && !s.enabled));
check('skill p1 project', list.some((s) => s.name === 'p1' && s.scope === 'project'));

// 禁用→启用往返
const s1 = list.find((s) => s.name === 's1')!;
toggleSkill(s1.path, false);
list = listDirSkills('kimi', TMP_PROJ);
check('s1 disabled after toggle', list.find((s) => s.name === 's1')?.enabled === false);
toggleSkill(list.find((s) => s.name === 's1')!.path, true);
list = listDirSkills('kimi', TMP_PROJ);
check('s1 re-enabled', list.find((s) => s.name === 's1')?.enabled === true);

// 新建 + 删除
const created = createSkill('kimi', 'my-new', 'a new skill');
check('create skill', fs.existsSync(path.join(created.path, 'SKILL.md')));
check('create listed', listDirSkills('kimi').some((s) => s.name === 'my-new'));
deleteSkill(created.path);
check('delete skill', !fs.existsSync(created.path));

// gemini/codex 不支持
check('gemini no skills', listDirSkills('gemini').length === 0);

// ---- MCP：kimi（JSON）----
const kimiMcpFile = path.join(TMP_HOME, '.kimi-code', 'mcp.json');
fs.mkdirSync(path.dirname(kimiMcpFile), { recursive: true });
fs.writeFileSync(kimiMcpFile, JSON.stringify({
  mcpServers: {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
    legacy: { transport: 'sse', url: 'https://mcp.example.com/sse', enabled: false },
  },
  otherField: { keep: true },
}));

let servers = listMcpServers('kimi');
check('mcp kimi count', servers.length === 2, servers);
check('mcp stdio parsed', servers.some((s) => s.name === 'filesystem' && s.type === 'stdio' && s.command === 'npx'));
check('mcp sse disabled', servers.some((s) => s.name === 'legacy' && s.type === 'sse' && !s.enabled));

upsertMcpServer('kimi', { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp', enabled: true, supported: true });
servers = listMcpServers('kimi');
check('mcp upsert http', servers.some((s) => s.name === 'linear' && s.type === 'http'));
check('mcp otherField preserved', (JSON.parse(fs.readFileSync(kimiMcpFile, 'utf8')) as { otherField?: { keep: boolean } }).otherField?.keep === true);

setMcpEnabled('kimi', 'legacy', true);
check('mcp enable', listMcpServers('kimi').find((s) => s.name === 'legacy')?.enabled === true);
deleteMcpServer('kimi', 'legacy');
check('mcp delete', !listMcpServers('kimi').some((s) => s.name === 'legacy'));

// ---- MCP：codex（TOML）----
const codexConf = path.join(TMP_HOME, '.codex', 'config.toml');
fs.mkdirSync(path.dirname(codexConf), { recursive: true });
fs.writeFileSync(codexConf, `model = "gpt-5"\n\n[mcp_servers.fs]\ncommand = "npx"\nargs = ["-y", "server-fs"]\n`);
const codexServers = listMcpServers('codex');
check('mcp codex toml read', codexServers.some((s) => s.name === 'fs' && s.type === 'stdio'), codexServers);
upsertMcpServer('codex', { name: 'remote', type: 'http', url: 'https://x.example.com', enabled: true, supported: true });
const tomlAfter = fs.readFileSync(codexConf, 'utf8');
check('mcp codex toml write', listMcpServers('codex').some((s) => s.name === 'remote'), tomlAfter);
check('mcp codex other field preserved', tomlAfter.includes('model = "gpt-5"') || tomlAfter.includes('model="gpt-5"'), tomlAfter);

// ---- 模型参数 ----
check('model args kimi', JSON.stringify(modelArgs('kimi', 'kimi-code/k3')) === '["--model","kimi-code/k3"]');
check('model args gemini', JSON.stringify(modelArgs('gemini', 'gemini-2.5-pro')) === '["-m","gemini-2.5-pro"]');
check('model args empty', modelArgs('claude', undefined).length === 0);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
