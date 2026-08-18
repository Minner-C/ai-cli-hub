// MCP 管理：读写各 CLI 的 MCP 配置文件（保留文件中其他字段）
// 配置位置（kimi 官方文档核实；其余按公开约定）：
//   kimi:   ~/.kimi-code/mcp.json        { mcpServers: { name: { command,args,env | url,transport,headers, enabled } } }
//   claude: ~/.claude.json               { mcpServers: {...} }（保留该 JSON 其他顶层字段）
//   gemini: ~/.gemini/settings.json      { mcpServers: {...} }
//   codex:  ~/.codex/config.toml         [mcp_servers.<name>] 表
//   hermes: ~/.hermes/config.yaml        mcp_servers: { name: {...} }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import * as yaml from 'js-yaml';
import type { CliId, McpServer, McpType, McpPreset } from './shared';

const home = () => os.homedir();

function configPath(cli: CliId): string | null {
  switch (cli) {
    case 'qwen':
      return path.join(home(), '.qwen', 'settings.json');
    case 'opencode':
    case 'aider':
    case 'pi':
    case 'dsh':
      return null; // 无公开 MCP 配置约定，暂不支持
    case 'kimi':
      return path.join(home(), '.kimi-code', 'mcp.json');
    case 'claude':
      return path.join(home(), '.claude.json');
    case 'gemini':
      return path.join(home(), '.gemini', 'settings.json');
    case 'codex':
      return path.join(home(), '.codex', 'config.toml');
    case 'hermes':
      return path.join(home(), '.hermes', 'config.yaml');
  }
}

// ---- 条目 <-> 规范化 McpServer ----
type RawEntry = Record<string, unknown>;

function entryToServer(name: string, entry: RawEntry): McpServer {
  const isStdio = typeof entry.command === 'string';
  const type: McpType = isStdio
    ? 'stdio'
    : entry.transport === 'sse' || entry.type === 'sse'
      ? 'sse'
      : 'http';
  return {
    name,
    type,
    command: isStdio ? (entry.command as string) : undefined,
    args: Array.isArray(entry.args) ? (entry.args as string[]) : undefined,
    env: (entry.env as Record<string, string>) ?? undefined,
    url: typeof entry.url === 'string' ? entry.url : undefined,
    headers: (entry.headers as Record<string, string>) ?? undefined,
    enabled: entry.enabled !== false,
    supported: true,
  };
}

function serverToEntry(server: McpServer): RawEntry {
  const entry: RawEntry = {};
  if (server.type === 'stdio') {
    entry.command = server.command ?? '';
    if (server.args?.length) entry.args = server.args;
    if (server.env && Object.keys(server.env).length) entry.env = server.env;
  } else {
    entry.url = server.url ?? '';
    if (server.type === 'sse') entry.transport = 'sse';
    if (server.headers && Object.keys(server.headers).length) entry.headers = server.headers;
  }
  if (!server.enabled) entry.enabled = false;
  return entry;
}

// ---- JSON 配置（kimi/claude/gemini）----
function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(file: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ---- TOML 配置（codex）----
function readToml(file: string): Record<string, unknown> {
  try {
    return TOML.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeToml(file: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, TOML.stringify(data as Parameters<typeof TOML.stringify>[0]), 'utf8');
}

// ---- YAML 配置（hermes）----
function readYaml(file: string): Record<string, unknown> {
  try {
    return (yaml.load(fs.readFileSync(file, 'utf8')) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function writeYaml(file: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(data, { lineWidth: -1 }), 'utf8');
}

// ---- 统一读写 ----
function readServers(cli: CliId): Record<string, RawEntry> {
  const file = configPath(cli);
  if (!file) return {};
  if (cli === 'codex') {
    const doc = readToml(file);
    return (doc.mcp_servers as Record<string, RawEntry>) ?? {};
  }
  if (cli === 'hermes') {
    const doc = readYaml(file);
    return (doc.mcp_servers as Record<string, RawEntry>) ?? {};
  }
  const doc = readJson(file);
  return (doc.mcpServers as Record<string, RawEntry>) ?? {};
}

function writeServers(cli: CliId, servers: Record<string, RawEntry>): void {
  const file = configPath(cli);
  if (!file) throw new Error('MCP not supported for this CLI');
  if (cli === 'codex') {
    const doc = readToml(file);
    doc.mcp_servers = servers as never;
    writeToml(file, doc);
    return;
  }
  if (cli === 'hermes') {
    const doc = readYaml(file);
    doc.mcp_servers = servers;
    writeYaml(file, doc);
    return;
  }
  const doc = readJson(file);
  doc.mcpServers = servers;
  writeJson(file, doc);
}

// ---- 对外操作 ----
export function listMcpServers(cli: CliId): McpServer[] {
  const entries = readServers(cli);
  return Object.entries(entries).map(([name, entry]) => entryToServer(name, entry));
}

// 新增/编辑；改名时传 originalName 以删除旧条目
export function upsertMcpServer(cli: CliId, server: McpServer, originalName?: string): void {
  const servers = readServers(cli);
  if (originalName && originalName !== server.name) delete servers[originalName];
  servers[server.name] = serverToEntry(server);
  writeServers(cli, servers);
}

export function deleteMcpServer(cli: CliId, name: string): void {
  const servers = readServers(cli);
  delete servers[name];
  writeServers(cli, servers);
}

export function setMcpEnabled(cli: CliId, name: string, enabled: boolean): void {
  const servers = readServers(cli);
  const entry = servers[name];
  if (!entry) return;
  if (enabled) delete entry.enabled;
  else entry.enabled = false;
  writeServers(cli, servers);
}

// ---- 内置 MCP 预设：常用 @modelcontextprotocol 服务器模板 ----
// 内存硬编码、不落盘；用户点击「添加」后载入编辑表单，确认参数后写入对应 CLI 配置文件
const BUILTIN_MCP_PRESETS: McpPreset[] = [
  {
    id: 'filesystem',
    name: 'filesystem',
    title: 'Filesystem',
    description: '文件系统读写访问，限定允许目录',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '<allowed-dir>'],
    needsConfig: true,
  },
  {
    id: 'git',
    name: 'git',
    title: 'Git',
    description: 'Git 仓库操作：status/diff/log/commit 等',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git', '--repository', '<repo-path>'],
    needsConfig: true,
  },
  {
    id: 'fetch',
    name: 'fetch',
    title: 'Fetch',
    description: '抓取网页内容并转为 Markdown',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    needsConfig: false,
  },
  {
    id: 'memory',
    name: 'memory',
    title: 'Memory',
    description: '基于知识图谱的持久记忆',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    needsConfig: false,
  },
  {
    id: 'sequential-thinking',
    name: 'sequential-thinking',
    title: 'Sequential Thinking',
    description: '分步思考与推理，适合复杂问题拆解',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    needsConfig: false,
  },
  {
    id: 'puppeteer',
    name: 'puppeteer',
    title: 'Puppeteer',
    description: '浏览器自动化：截图、点击、表单填写',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    needsConfig: false,
  },
  {
    id: 'time',
    name: 'time',
    title: 'Time',
    description: '获取当前时间与时区转换',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-time'],
    needsConfig: false,
  },
  {
    id: 'sqlite',
    name: 'sqlite',
    title: 'SQLite',
    description: '查询本地 SQLite 数据库',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '<db-path>'],
    needsConfig: true,
  },
  {
    id: 'postgres',
    name: 'postgres',
    title: 'PostgreSQL',
    description: '查询 PostgreSQL 数据库（只读）',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '<connection-string>'],
    needsConfig: true,
  },
  {
    id: 'brave-search',
    name: 'brave-search',
    title: 'Brave Search',
    description: 'Brave 网页搜索（需 API Key）',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '<your-api-key>' },
    needsConfig: true,
  },
  {
    id: 'github',
    name: 'github',
    title: 'GitHub',
    description: 'GitHub 仓库/Issue/PR 操作（需 Token）',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '<your-token>' },
    needsConfig: true,
  },
  {
    id: 'slack',
    name: 'slack',
    title: 'Slack',
    description: 'Slack 消息收发（需 Bot Token）',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '<xoxb-your-token>' },
    needsConfig: true,
  },
];

export function listMcpPresets(): McpPreset[] {
  return BUILTIN_MCP_PRESETS;
}
