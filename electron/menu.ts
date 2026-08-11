// 原生应用菜单：按当前语言动态构建，点击经 webContents.send 通知渲染进程
import { app, BrowserWindow, Menu, dialog } from 'electron';
import { safeSend } from './safeSend';
import type { Language } from './shared';

// 菜单文案（主进程不依赖 react-i18next，自带两份词典）
const T = {
  zh: {
    file: '文件',
    newChat: '新增对话',
    settings: '设置',
    quit: '退出',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    view: '视图',
    reload: '刷新',
    zoomIn: '放大',
    zoomOut: '缩小',
    resetZoom: '重置缩放',
    toggleDevtools: '开发者工具',
    theme: '主题',
    themeLight: '明亮',
    themeDark: '黑暗',
    themeSystem: '跟随系统',
    language: '语言',
    help: '帮助',
    about: '关于',
    aboutTitle: '关于 AI CLI Hub',
  },
  en: {
    file: 'File',
    newChat: 'New Chat',
    settings: 'Settings',
    quit: 'Quit',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    reload: 'Reload',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    resetZoom: 'Reset Zoom',
    toggleDevtools: 'Toggle Developer Tools',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    language: 'Language',
    help: 'Help',
    about: 'About',
    aboutTitle: 'About AI CLI Hub',
  },
} as const;

// 向渲染进程发送菜单动作
function send(action: string, payload?: unknown) {
  safeSend(BrowserWindow.getAllWindows()[0]?.webContents, 'menu:action', action, payload);
}

export function buildAppMenu(lang: Language) {
  const t = T[lang] ?? T.en;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: t.file,
      submenu: [
        { label: t.newChat, accelerator: 'CmdOrCtrl+N', click: () => send('menu:newChat') },
        { label: t.settings, accelerator: 'CmdOrCtrl+,', click: () => send('menu:openSettings') },
        { type: 'separator' },
        { label: t.quit, role: 'quit' },
      ],
    },
    {
      label: t.edit,
      submenu: [
        { label: t.undo, role: 'undo' },
        { label: t.redo, role: 'redo' },
        { type: 'separator' },
        { label: t.cut, role: 'cut' },
        { label: t.copy, role: 'copy' },
        { label: t.paste, role: 'paste' },
        { label: t.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: t.view,
      submenu: [
        { label: t.reload, role: 'reload' },
        { type: 'separator' },
        { label: t.zoomIn, role: 'zoomIn' },
        { label: t.zoomOut, role: 'zoomOut' },
        { label: t.resetZoom, role: 'resetZoom' },
        { type: 'separator' },
        {
          label: t.theme,
          submenu: (['light', 'dark', 'system'] as const).map((mode) => ({
            label: mode === 'light' ? t.themeLight : mode === 'dark' ? t.themeDark : t.themeSystem,
            type: 'radio' as const,
            click: () => send('menu:setTheme', mode),
          })),
        },
        { type: 'separator' },
        { label: t.toggleDevtools, role: 'toggleDevTools' },
      ],
    },
    {
      label: t.language,
      submenu: [
        { label: '中文', type: 'radio', checked: lang === 'zh', click: () => send('menu:setLanguage', 'zh') },
        { label: 'English', type: 'radio', checked: lang === 'en', click: () => send('menu:setLanguage', 'en') },
      ],
    },
    {
      label: t.help,
      submenu: [
        {
          label: t.about,
          click: () => {
            void dialog.showMessageBox({
              title: t.aboutTitle,
              message: 'AI CLI Hub',
              detail: `Version ${app.getVersion()}\nUnified GUI for AI CLIs (Kimi / Claude / Gemini / Codex)`,
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
