// dsh 数据目录与插件体系管理（设置页后端）
// 调研结论（实测 dsh 0.1.0-rc.x）：
//   DSH_HOME = ~/.dsh；settings.yaml / sessions / storages / profiles
//   profile = profiles/<name>/{package.json(dsh.profile.bundles + dependencies), cordis.yml, cordis.patch.yml(用户层)}
//   插件树 = cordis loader patch 层叠：bundle 层 → cordis.patch.yml → --patch
//   `dsh --profile <p> --dump-config` 打印合成树（"# == 来源" 注释 + "- id/name/config/disabled" 条目）
//   `dsh plugin --profile <p> <args>` 等价于在 profile 目录跑 pnpm <args>（本机无全局 pnpm，用 corepack pnpm 等价替代）
//   凭证存 ~/.dsh/.credentials.yaml（YAML 键值：DEEPSEEK_API_KEY: sk-...）
//   默认模型 = agent-default-model 插件 config {provider, model}，可经 patch 覆盖
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import * as yaml from 'js-yaml';

export function dshHome(): string {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
}

export function profileDir(profile: string): string {
  return path.join(dshHome(), 'profiles', profile);
}

export function patchPath(profile: string): string {
  return path.join(profileDir(profile), 'cordis.patch.yml');
}

// ---- profile 列表 ----
export interface DshProfile {
  name: string;
  bundles: string[];
  dependencies: string[]; // 用户经 pnpm 装入的包
}

export function listProfiles(): DshProfile[] {
  const root = path.join(dshHome(), 'profiles');
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root).filter((d) => {
      try {
        return fs.statSync(path.join(root, d)).isDirectory() && d !== 'node_modules';
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
  return dirs.map((name) => {
    let bundles: string[] = [];
    let dependencies: string[] = [];
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, name, 'package.json'), 'utf8')) as {
        dsh?: { profile?: { bundles?: string[] } };
        dependencies?: Record<string, string>;
      };
      bundles = pkg.dsh?.profile?.bundles ?? [];
      dependencies = Object.keys(pkg.dependencies ?? {});
    } catch {
      // 无 package.json 的目录也列出
    }
    return { name, bundles, dependencies };
  });
}

// ---- 插件树解析（--dump-config 输出）----
export interface DshPluginEntry {
  id: string;
  name?: string;
  disabled: boolean;
  source: string; // 来源层（bundle 名 / cordis.patch.yml / --patch）
  hasConfig: boolean;
}

// 行级解析：dump 里 config 可能含 !!js 表达式（js-yaml 无法解析），条目结构简单直接按行解析
const unquote = (s: string): string => s.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

export function parseDumpConfig(text: string): DshPluginEntry[] {
  const entries: DshPluginEntry[] = [];
  let cur: DshPluginEntry | null = null;
  let pendingSource = '';
  let depth = 0; // config: 块内的缩进跳过
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const srcMatch = line.match(/^#\s*==\s*(.+)$/);
    if (srcMatch) {
      pendingSource = srcMatch[1].trim();
      continue;
    }
    if (line.startsWith('#')) continue;
    const itemMatch = line.match(/^-\s+id:\s*(.+)$/);
    if (itemMatch) {
      cur = { id: unquote(itemMatch[1]), disabled: false, source: pendingSource, hasConfig: false };
      entries.push(cur);
      depth = 0;
      continue;
    }
    if (line.startsWith('- ') && !itemMatch) {
      // 无 id 的插入条目（如用户层直接 - name: xxx）
      cur = { id: '', disabled: false, source: pendingSource, hasConfig: false };
      entries.push(cur);
      depth = 0;
      const nameInLine = line.match(/^-\s+name:\s*(.+)$/);
      if (nameInLine) cur.name = unquote(nameInLine[1]);
      continue;
    }
    if (!cur) continue;
    const indent = line.length - line.trimStart().length;
    if (depth > 0 && indent >= depth) continue; // config 块内容跳过
    depth = 0;
    const nameMatch = line.match(/^\s+name:\s*(.+)$/);
    if (nameMatch) {
      cur.name = unquote(nameMatch[1]);
      continue;
    }
    if (/^\s+config:/.test(line)) {
      cur.hasConfig = true;
      depth = indent + 1;
      continue;
    }
    const disMatch = line.match(/^\s+disabled:\s*(true|false)/);
    if (disMatch) cur.disabled = disMatch[1] === 'true';
  }
  return entries;
}

export function dumpProfileConfig(
  dsh: { file: string; argsPrefix: string[] },
  profile: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      dsh.file,
      [...dsh.argsPrefix, '--profile', profile, '--dump-config'],
      { timeout: 120_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve(stdout);
      },
    );
  });
}

// ---- 用户层 patch 编辑 ----
export interface PatchEntry {
  id?: string;
  name?: string;
  config?: Record<string, unknown>;
  disabled?: boolean;
}

export function readPatchEntries(profile: string): PatchEntry[] {
  try {
    const doc = yaml.load(fs.readFileSync(patchPath(profile), 'utf8'));
    return Array.isArray(doc) ? (doc as PatchEntry[]) : [];
  } catch {
    return [];
  }
}

export function writePatchEntries(profile: string, entries: PatchEntry[]): void {
  const p = patchPath(profile);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');
  fs.writeFileSync(p, yaml.dump(entries, { lineWidth: -1 }), 'utf8');
}

// 启用/禁用：禁用在用户层 upsert {id, disabled:true}；启用时若用户层该条目仅含 disabled 则整条移除
export function setPluginDisabled(profile: string, id: string, disabled: boolean): void {
  const entries = readPatchEntries(profile);
  const idx = entries.findIndex((e) => e.id === id);
  if (disabled) {
    if (idx >= 0) entries[idx] = { ...entries[idx], id, disabled: true };
    else entries.push({ id, disabled: true });
  } else if (idx >= 0) {
    const rest = { ...entries[idx] };
    delete rest.disabled;
    // 只剩 id 的空壳条目直接删除，保持 patch 文件干净
    if (!rest.name && !rest.config) entries.splice(idx, 1);
    else entries[idx] = rest;
  }
  writePatchEntries(profile, entries);
}

// 安装：pnpm add 到 profile 目录 + patch 层插入 - name: <pkg>
export async function installPlugin(
  profile: string,
  pkg: string,
): Promise<{ ok: boolean; output: string }> {
  const dir = profileDir(profile);
  if (!fs.existsSync(dir)) return { ok: false, output: `profile 不存在: ${profile}` };
  const output = await runPnpm(dir, ['add', pkg]);
  const ok = /Added|added|done|Already up to date|up to date/i.test(output) || !/ERR_PNPM|error/i.test(output);
  if (ok) {
    const entries = readPatchEntries(profile);
    if (!entries.some((e) => e.name === pkg)) {
      entries.push({ name: pkg });
      writePatchEntries(profile, entries);
    }
  }
  return { ok, output };
}

// 卸载：pnpm remove + 移除 patch 层中 name 匹配的条目
export async function uninstallPlugin(
  profile: string,
  name: string,
): Promise<{ ok: boolean; output: string }> {
  const dir = profileDir(profile);
  const output = await runPnpm(dir, ['remove', name]);
  const entries = readPatchEntries(profile).filter((e) => e.name !== name);
  writePatchEntries(profile, entries);
  return { ok: !/ERR_PNPM|error/i.test(output), output };
}

function runPnpm(cwd: string, args: string[]): Promise<string> {
  // dsh plugin 等价于在 profile 目录跑 pnpm；本机无全局 pnpm，走 corepack（Node 自带）
  return new Promise((resolve) => {
    execFile(
      'corepack',
      ['pnpm', ...args],
      { cwd, timeout: 300_000, windowsHide: true, shell: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve(`${stdout}\n${stderr}`.trim() || (err ? err.message : '')),
    );
  });
}

// ---- 默认模型（agent-default-model 插件 config 覆盖）----
export function getDefaultModelOverride(profile: string): { provider?: string; model?: string } {
  const e = readPatchEntries(profile).find((x) => x.id === 'agent-default-model');
  return (e?.config ?? {}) as { provider?: string; model?: string };
}

export function setDefaultModelOverride(profile: string, provider: string, model: string): void {
  const entries = readPatchEntries(profile);
  const idx = entries.findIndex((x) => x.id === 'agent-default-model');
  const entry: PatchEntry = { id: 'agent-default-model', config: { provider, model } };
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  writePatchEntries(profile, entries);
}

// ---- 凭证状态（~/.dsh/.credentials.yaml，YAML 键值格式）----
export interface DshCredentialStatus {
  envPath: string;
  keys: string[]; // 已配置的变量名（不暴露值）
}

function credentialFile(): string {
  return path.join(dshHome(), '.credentials.yaml');
}

export function readCredentialStatus(): DshCredentialStatus {
  const envPath = credentialFile();
  const keys: string[] = [];
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      // YAML 键值：DEEPSEEK_API_KEY: sk-xxx
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\S+)\s*$/);
      if (m && m[2] && m[2] !== '""' && m[2] !== "''") keys.push(m[1]);
    }
  } catch {
    // 文件不存在 = 未配置
  }
  return { envPath, keys };
}

// 写入/清除凭证文件中的某个 key（保留其他行）
export function writeCredentialKey(ref: string, value: string | null): void {
  const envPath = credentialFile();
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  } catch {
    lines = [];
  }
  const re = new RegExp(`^\\s*${ref}\\s*:`);
  const kept = lines.filter((l) => l.trim() && !re.test(l));
  if (value) kept.push(`${ref}: ${value}`);
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, kept.join('\n') + '\n', 'utf8');
}
