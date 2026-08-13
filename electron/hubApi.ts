// hubApi：构建 window.hub API（无副作用，供 GUI preload 与 headless 服务中继 preload 复用）
// 与 preload 的 Electron IPC 通信解耦，仅依赖 ipcRenderer
import { ipcRenderer } from 'electron';
import type { HubApi, CliId, AppSettings, EffortLevel, McpServer, PermissionMode, ProviderPreset, StreamEvent } from './shared';

export function buildHubApi(): HubApi {
  return {
    listClis: () => ipcRenderer.invoke('cli:list'),
    detectClis: () => ipcRenderer.invoke('cli:detect'),

    listTasks: () => ipcRenderer.invoke('task:list'),
    createTask: (cliId: CliId, cwd: string) => ipcRenderer.invoke('task:create', cliId, cwd),
    deleteTask: (taskId: string) => ipcRenderer.invoke('task:delete', taskId),
    renameTask: (taskId: string, title: string) => ipcRenderer.invoke('task:rename', taskId, title),
    pinTask: (taskId: string, pinned: boolean) => ipcRenderer.invoke('task:pin', taskId, pinned),
    clearChanges: (taskId: string) => ipcRenderer.invoke('task:clearChanges', taskId),
    clearTodos: (taskId: string) => ipcRenderer.invoke('task:clearTodos', taskId),
    gitRestore: (cwd: string, paths: string[]) => ipcRenderer.invoke('fs:gitRestore', cwd, paths),
    sendMessage: (taskId: string, text: string, images?: Array<{ data: string; mimeType: string; name: string }>) =>
      ipcRenderer.invoke('task:send', taskId, text, images),
    stopTask: (taskId: string) => ipcRenderer.invoke('task:stop', taskId),
    prepareSwitch: (taskId: string, targetCliId: CliId) =>
      ipcRenderer.invoke('task:prepareSwitch', taskId, targetCliId),
    confirmSwitch: (taskId: string, targetCliId: CliId, summary: string) =>
      ipcRenderer.invoke('task:confirmSwitch', taskId, targetCliId, summary),

    onTaskEvent: (cb: (ev: StreamEvent) => void) => {
      const listener = (_e: unknown, ev: StreamEvent) => cb(ev);
      ipcRenderer.on('task:event', listener);
      return () => ipcRenderer.removeListener('task:event', listener);
    },

    getAppInfo: () => ipcRenderer.invoke('app:info'),
    pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
    pickExecutable: () => ipcRenderer.invoke('dialog:pickExecutable'),
    getSettings: () => ipcRenderer.invoke('settings:get'),
    setSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', settings),

    runTest: (taskId, cwd, script, baseURL, headless) =>
      ipcRenderer.invoke('test:run', taskId, cwd, script, baseURL, headless),
    stopTest: (taskId) => ipcRenderer.invoke('test:stop', taskId),
    loadTestScript: (cwd) => ipcRenderer.invoke('test:loadScript', cwd),
    saveTestScript: (cwd, script) => ipcRenderer.invoke('test:saveScript', cwd, script),
    onTestOutput: (cb) => {
      const listener = (_e: unknown, taskId: string, chunk: string) => cb(taskId, chunk);
      ipcRenderer.on('test:output', listener);
      return () => ipcRenderer.removeListener('test:output', listener);
    },
    onBrowserOpenUrl: (cb) => {
      const listener = (_e: unknown, url: string) => cb(url);
      ipcRenderer.on('browser:openUrl', listener);
      return () => ipcRenderer.removeListener('browser:openUrl', listener);
    },
    onPermissionRequest: (cb) => {
      const listener = (_e: unknown, req: import('./shared').PermissionRequestPayload) => cb(req);
      ipcRenderer.on('permission:request', listener);
      return () => ipcRenderer.removeListener('permission:request', listener);
    },
    respondPermission: (requestId: string, optionId: string | null) =>
      ipcRenderer.invoke('permission:respond', requestId, optionId),
    onMenuAction: (cb) => {
      const listener = (_e: unknown, action: string, payload?: unknown) => cb(action, payload);
      ipcRenderer.on('menu:action', listener);
      return () => ipcRenderer.removeListener('menu:action', listener);
    },

    getAuthStatus: () => ipcRenderer.invoke('auth:status'),
    saveApiKey: (cliId: CliId, key: string) => ipcRenderer.invoke('auth:saveKey', cliId, key),
    clearApiKey: (cliId: CliId) => ipcRenderer.invoke('auth:clearKey', cliId),
    loginCli: (cliId: CliId) => ipcRenderer.invoke('auth:login', cliId),

    listModels: (cliId: CliId) => ipcRenderer.invoke('model:list', cliId),
    setTaskModel: (taskId: string, model: string) =>
      ipcRenderer.invoke('task:setModel', taskId, model),
    setTaskEffort: (taskId: string, lvl: EffortLevel) =>
      ipcRenderer.invoke('task:setEffort', taskId, lvl),
    getEffortSupport: (cliId: CliId) => ipcRenderer.invoke('effort:support', cliId),
    setTaskPermission: (taskId: string, mode: PermissionMode) =>
      ipcRenderer.invoke('task:setPermission', taskId, mode),
    setTaskPlanMode: (taskId: string, on: boolean) =>
      ipcRenderer.invoke('task:setPlanMode', taskId, on),
    setTaskGoalMode: (taskId: string, on: boolean) =>
      ipcRenderer.invoke('task:setGoalMode', taskId, on),
    getPermissionSupport: (cliId: CliId) => ipcRenderer.invoke('permission:support', cliId),
    readPermissionFromConfig: (cliId: CliId) => ipcRenderer.invoke('permission:readConfig', cliId),
    getProviderState: (cliId: CliId) => ipcRenderer.invoke('provider:state', cliId),
    setActiveProvider: (cliId: CliId, presetId: string) =>
      ipcRenderer.invoke('provider:setActive', cliId, presetId),
    saveProviderKey: (cliId: CliId, presetId: string, key: string) =>
      ipcRenderer.invoke('provider:saveKey', cliId, presetId, key),
    saveCustomProvider: (cliId: CliId, preset: ProviderPreset) =>
      ipcRenderer.invoke('provider:saveCustom', cliId, preset),

    listSkills: (cliId: CliId, cwd?: string) => ipcRenderer.invoke('skill:list', cliId, cwd),
    toggleSkill: (p: string, dirForm: boolean, enable: boolean) =>
      ipcRenderer.invoke('skill:toggle', p, dirForm, enable),
    createSkill: (cliId: CliId, name: string, description: string) =>
      ipcRenderer.invoke('skill:create', cliId, name, description),
    deleteSkill: (p: string) => ipcRenderer.invoke('skill:delete', p),
    openSkill: (p: string) => ipcRenderer.invoke('skill:open', p),
    listSkillTemplates: () => ipcRenderer.invoke('skill:templates'),
    createSkillFromTemplate: (cliId: CliId, templateId: string) =>
      ipcRenderer.invoke('skill:createFromTemplate', cliId, templateId),

    getUsageSummary: (weeks?: number, sinceDays?: number) => ipcRenderer.invoke('usage:summary', weeks, sinceDays),
    getTaskUsage: (taskId: string) => ipcRenderer.invoke('usage:task', taskId),
    getTaskUsageDetail: (taskId: string) => ipcRenderer.invoke('usage:taskDetail', taskId),

    listModelEntries: () => ipcRenderer.invoke('modelEntries:list'),
    saveModelEntry: (entry: import('./shared').ModelEntry) =>
      ipcRenderer.invoke('modelEntries:save', entry),
    deleteModelEntry: (id: string) => ipcRenderer.invoke('modelEntries:delete', id),
    setTaskModelEntry: (taskId: string, entryId: string) =>
      ipcRenderer.invoke('modelEntries:setTaskEntry', taskId, entryId),
    testModelEntry: (entryId: string) => ipcRenderer.invoke('modelEntries:test', entryId),

    listProviders: () => ipcRenderer.invoke('providers:list'),
    saveProvider: (provider: import('./shared').ProviderEntry) =>
      ipcRenderer.invoke('providers:save', provider),
    deleteProvider: (id: string) => ipcRenderer.invoke('providers:delete', id),
    saveProviderApiKey: (providerId: string, key: string) =>
      ipcRenderer.invoke('providers:saveKey', providerId, key),
    providerHasKey: (providerId: string) => ipcRenderer.invoke('providers:hasKey', providerId),

    cliConfigReadRaw: (cliId: CliId) => ipcRenderer.invoke('cliConfig:readRaw', cliId),
    cliConfigWriteRaw: (cliId: CliId, content: string) =>
      ipcRenderer.invoke('cliConfig:writeRaw', cliId, content),
    cliConfigRestoreBackup: (cliId: CliId) => ipcRenderer.invoke('cliConfig:restore', cliId),
    cliConfigHasBackup: (cliId: CliId) => ipcRenderer.invoke('cliConfig:hasBackup', cliId),
    cliConfigReadDoc: (cliId: CliId) => ipcRenderer.invoke('cliConfig:readDoc', cliId),
    cliConfigWriteFields: (cliId: CliId, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('cliConfig:writeFields', cliId, patch),
    cliVersion: (cliId: CliId) => ipcRenderer.invoke('cli:version', cliId),
    cliCheckLatest: (cliId: CliId) => ipcRenderer.invoke('cli:checkLatest', cliId),
    cliRunUpdate: (cliId: CliId) => ipcRenderer.invoke('cli:runUpdate', cliId),
    cliInstall: (cliId: CliId) => ipcRenderer.invoke('cli:installStart', cliId),
    runCodingHelper: () => ipcRenderer.invoke('cli:runCodingHelper'),
    cliUpdate: (cliId: CliId) => ipcRenderer.invoke('cli:updateStart', cliId),
    onInstallProgress: (cb) => {
      const listener = (_e: unknown, cliId: CliId, chunk: string) => cb(cliId, chunk);
      ipcRenderer.on('cli:installProgress', listener);
      return () => ipcRenderer.removeListener('cli:installProgress', listener);
    },
    onInstallDone: (cb) => {
      const listener = (_e: unknown, cliId: CliId, ok: boolean, message: string) => cb(cliId, ok, message);
      ipcRenderer.on('cli:installDone', listener);
      return () => ipcRenderer.removeListener('cli:installDone', listener);
    },
    // 运行时环境（Node.js / Python）
    checkRuntimes: () => ipcRenderer.invoke('env:check'),
    installRuntime: (kind) => ipcRenderer.invoke('env:install', kind),
    onRuntimeProgress: (cb) => {
      const listener = (_e: unknown, kind: import('./envInstaller').RuntimeKind, chunk: string) => cb(kind, chunk);
      ipcRenderer.on('env:progress', listener);
      return () => ipcRenderer.removeListener('env:progress', listener);
    },
    onRuntimeDone: (cb) => {
      const listener = (_e: unknown, kind: import('./envInstaller').RuntimeKind, ok: boolean, message: string) => cb(kind, ok, message);
      ipcRenderer.on('env:done', listener);
      return () => ipcRenderer.removeListener('env:done', listener);
    },
    // ACP adapter（claude-code-acp / codex-acp）检测与一键安装
    checkAdapters: () => ipcRenderer.invoke('acp:checkAdapters'),
    installAdapter: (cliId) => ipcRenderer.invoke('acp:installAdapter', cliId),
    onAdapterProgress: (cb) => {
      const listener = (_e: unknown, cliId: import('./shared').CliId, chunk: string) => cb(cliId, chunk);
      ipcRenderer.on('acp:progress', listener);
      return () => ipcRenderer.removeListener('acp:progress', listener);
    },
    onAdapterDone: (cb) => {
      const listener = (_e: unknown, cliId: import('./shared').CliId, ok: boolean, message: string) => cb(cliId, ok, message);
      ipcRenderer.on('acp:done', listener);
      return () => ipcRenderer.removeListener('acp:done', listener);
    },

    listDir: (dir: string) => ipcRenderer.invoke('fs:listDir', dir),
    listFilesFlat: (dir: string) => ipcRenderer.invoke('fs:listFilesFlat', dir),
    saveImage: (cwd: string, dataBase64: string, mimeType: string) =>
      ipcRenderer.invoke('fs:saveImage', cwd, dataBase64, mimeType),

    readFilePreview: (path: string, cwd?: string) => ipcRenderer.invoke('fs:readPreview', path, cwd),
    writeFile: (path: string, content: string, cwd?: string) =>
      ipcRenderer.invoke('fs:writeFile', path, content, cwd),
    readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),
    openPath: (path: string, cwd?: string) => ipcRenderer.invoke('fs:openPath', path, cwd),
    revealInFolder: (path: string) => ipcRenderer.invoke('fs:revealInFolder', path),
    openExternal: (url: string) => ipcRenderer.invoke('fs:openExternal', url),

    listMcpServers: (cliId: CliId) => ipcRenderer.invoke('mcp:list', cliId),
    upsertMcpServer: (cliId: CliId, server: McpServer, originalName?: string) =>
      ipcRenderer.invoke('mcp:upsert', cliId, server, originalName),
    deleteMcpServer: (cliId: CliId, name: string) => ipcRenderer.invoke('mcp:delete', cliId, name),
    setMcpEnabled: (cliId: CliId, name: string, enabled: boolean) =>
      ipcRenderer.invoke('mcp:setEnabled', cliId, name, enabled),
    listMcpPresets: () => ipcRenderer.invoke('mcp:presets'),

    // 窗口控制（自定义标题栏）
    winMinimize: () => ipcRenderer.invoke('win:minimize'),
    winMaximizeToggle: () => ipcRenderer.invoke('win:maximize'),
    winClose: () => ipcRenderer.invoke('win:close'),
    winIsMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onMaximizeChange: (cb: (maximized: boolean) => void) => {
      const listener = (_e: unknown, maximized: boolean) => cb(maximized);
      ipcRenderer.on('win:maximizeChanged', listener);
      return () => ipcRenderer.removeListener('win:maximizeChanged', listener);
    },
  };
}
