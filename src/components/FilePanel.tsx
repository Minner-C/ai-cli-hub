// 文件管理面板：右侧可开合文件树（懒加载、类型图标着色、AI 改动标记、搜索过滤）
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText, FileCode, FileImage, FileJson, File, Folder, FolderOpen,
  ChevronRight, ChevronDown, ExternalLink, Search,
} from 'lucide-react';
import { useHubStore } from '../store';
import type { DirEntry } from '../../electron/filePanel';
import type { Task } from '../../electron/shared';

// 按扩展名的图标与颜色
const EXT_STYLE: Record<string, { icon: 'code' | 'json' | 'image' | 'text'; color: string }> = {
  ts: { icon: 'code', color: '#3178c6' }, tsx: { icon: 'code', color: '#3178c6' },
  js: { icon: 'code', color: '#d4a017' }, jsx: { icon: 'code', color: '#d4a017' },
  css: { icon: 'code', color: '#a074c4' }, html: { icon: 'code', color: '#e34c26' },
  py: { icon: 'code', color: '#3572a5' }, rs: { icon: 'code', color: '#dea584' },
  go: { icon: 'code', color: '#00add8' }, java: { icon: 'code', color: '#b07219' },
  json: { icon: 'json', color: '#cbcb41' }, toml: { icon: 'json', color: '#9c4221' },
  yml: { icon: 'json', color: '#cb171e' }, yaml: { icon: 'json', color: '#cb171e' },
  png: { icon: 'image', color: '#a074c4' }, jpg: { icon: 'image', color: '#a074c4' },
  jpeg: { icon: 'image', color: '#a074c4' }, gif: { icon: 'image', color: '#a074c4' },
  svg: { icon: 'image', color: '#a074c4' }, webp: { icon: 'image', color: '#a074c4' },
  md: { icon: 'text', color: '#519aba' }, txt: { icon: 'text', color: '#519aba' },
};

function extOf(name: string): string {
  const m = name.match(/\.(\w+)$/);
  return m ? m[1].toLowerCase() : '';
}

function FileIcon({ entry }: { entry: DirEntry }) {
  if (entry.isDir) return null;
  const style = EXT_STYLE[extOf(entry.name)] ?? { icon: 'text', color: 'var(--fg-muted)' };
  const props = { size: 13, color: style.color };
  switch (style.icon) {
    case 'code': return <FileCode {...props} />;
    case 'json': return <FileJson {...props} />;
    case 'image': return <FileImage {...props} />;
    default: return <FileText {...props} />;
  }
}

// 单目录节点（懒加载）
function DirNode({ path, name, changed, depth }: { path: string; name: string; changed: Set<string>; depth: number }) {
  const { setPreviewPath } = useHubStore();
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    if (open && children === null) {
      void window.hub.listDir(path).then(setChildren);
    }
  }, [open, children, path]);

  return (
    <div>
      <div
        className="file-row"
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} className="hint" /> : <ChevronRight size={12} className="hint" />}
        {open ? <FolderOpen size={13} className="file-folder-icon" /> : <Folder size={13} className="file-folder-icon" />}
        <span className="file-name">{name}</span>
      </div>
      {open && children?.map((entry) =>
        entry.isDir ? (
          <DirNode key={entry.name} path={`${path}/${entry.name}`} name={entry.name} changed={changed} depth={depth + 1} />
        ) : (
          <div
            key={entry.name}
            className="file-row"
            style={{ paddingLeft: 6 + (depth + 1) * 14 }}
            onClick={() => setPreviewPath(`${path}/${entry.name}`)}
          >
            <FileIcon entry={entry} />
            <span className="file-name">{entry.name}</span>
            {changed.has(`${path}/${entry.name}`) && <span className="file-changed-dot" title="AI changed" />}
            <button
              className="icon-btn file-open-btn"
              onClick={(e) => {
                e.stopPropagation();
                void window.hub.openPath(`${path}/${entry.name}`);
              }}
            >
              <ExternalLink size={11} />
            </button>
          </div>
        ),
      )}
    </div>
  );
}

// 从消息 tool 块收集 AI 触碰过的文件路径
function collectChangedFiles(task: Task): Set<string> {
  const set = new Set<string>();
  for (const msg of task.messages) {
    const blocks = msg.blocks ?? [];
    for (const b of blocks) {
      if (b.type === 'tool' && /^(write|edit|multiedit|notebookedit)$/i.test(b.name)) {
        try {
          const args = JSON.parse(b.args || '{}') as { file_path?: string; path?: string };
          const p = args.file_path ?? args.path;
          if (p) set.add(p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : `${task.cwd}/${p}`);
        } catch { /* ignore */ }
      }
    }
    if (msg.role === 'tool' && /^(write|edit)/i.test(msg.toolName ?? '')) {
      try {
        const args = JSON.parse(msg.toolArgs || '{}') as { file_path?: string };
        if (args.file_path) set.add(args.file_path.startsWith('/') || /^[A-Za-z]:/.test(args.file_path) ? args.file_path : `${task.cwd}/${args.file_path}`);
      } catch { /* ignore */ }
    }
  }
  return set;
}

export default function FilePanel({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { setPreviewPath } = useHubStore();
  const [query, setQuery] = useState('');
  const [flat, setFlat] = useState<string[] | null>(null);

  const changed = useMemo(() => collectChangedFiles(task), [task]);

  useEffect(() => {
    if (query.trim()) {
      void window.hub.listFilesFlat(task.cwd).then(setFlat);
    } else {
      setFlat(null);
    }
  }, [query, task.cwd]);

  const filtered = useMemo(() => {
    if (!flat || !query.trim()) return null;
    const q = query.trim().toLowerCase();
    return flat.filter((f) => f.toLowerCase().includes(q)).slice(0, 100);
  }, [flat, query]);

  return (
    <div className="file-panel">
      <div className="file-search">
        <Search size={12} className="hint" />
        <input
          value={query}
          placeholder={t('files.searchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="file-tree">
        {filtered ? (
          filtered.length === 0 ? (
            <div className="hint file-empty">{t('files.noMatch')}</div>
          ) : (
            filtered.map((rel) => (
              <div key={rel} className="file-row" onClick={() => setPreviewPath(`${task.cwd}/${rel}`, task.cwd)}>
                <FileIcon entry={{ name: rel.split('/').pop() ?? rel, isDir: false, size: 0 }} />
                <span className="file-name mono">{rel}</span>
                {changed.has(`${task.cwd}/${rel}`) && <span className="file-changed-dot" />}
              </div>
            ))
          )
        ) : (
          <DirNode path={task.cwd} name={task.cwd.split(/[\\/]/).pop() ?? task.cwd} changed={changed} depth={0} />
        )}
      </div>
    </div>
  );
}
