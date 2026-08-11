// 设置页 - MCP tab：各 CLI 的 MCP 服务器列表 + 新增/编辑/启停/删除
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../../store';
import { PageHeader, SettingRow, Section, FormRow } from './kit';
import { Pencil, Trash2 } from 'lucide-react';
import type { CliId, McpServer, McpPreset, McpType } from '../../../electron/shared';

interface EditState {
  originalName?: string;
  name: string;
  type: McpType;
  command: string;
  args: string;   // 空格分隔
  env: string;    // KEY=VALUE 每行一个
  url: string;
  headers: string; // KEY=VALUE 每行一个
}

const EMPTY_EDIT: EditState = {
  name: '',
  type: 'stdio',
  command: '',
  args: '',
  env: '',
  url: '',
  headers: '',
};

function parseKvLines(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function kvToLines(kv?: Record<string, string>): string {
  return kv ? Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') : '';
}

export default function McpTab() {
  const { t } = useTranslation();
  const { clis, setError } = useHubStore();
  const [cliId, setCliId] = useState<CliId>('kimi');
  const [servers, setServers] = useState<McpServer[]>([]);
  const [presets, setPresets] = useState<McpPreset[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);

  const refresh = useCallback(async () => {
    setServers(await window.hub.listMcpServers(cliId));
  }, [cliId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void window.hub.listMcpPresets().then(setPresets).catch(() => undefined);
  }, []);

  const run = (p: Promise<unknown>) =>
    p.then(refresh).catch((err) => setError(err instanceof Error ? err.message : String(err)));

  const save = () => {
    if (!edit) return;
    const server: McpServer = {
      name: edit.name.trim(),
      type: edit.type,
      enabled: true,
      supported: true,
      ...(edit.type === 'stdio'
        ? {
            command: edit.command.trim(),
            args: edit.args.trim() ? edit.args.trim().split(/\s+/) : undefined,
            env: parseKvLines(edit.env),
          }
        : {
            url: edit.url.trim(),
            headers: parseKvLines(edit.headers),
          }),
    };
    void run(window.hub.upsertMcpServer(cliId, server, edit.originalName)).then(() =>
      setEdit(null),
    );
  };

  const startEdit = (s: McpServer) =>
    setEdit({
      originalName: s.name,
      name: s.name,
      type: s.type,
      command: s.command ?? '',
      args: (s.args ?? []).join(' '),
      env: kvToLines(s.env),
      url: s.url ?? '',
      headers: kvToLines(s.headers),
    });

  // 点击预设：载入编辑表单，用户确认参数（替换占位符）后保存
  const applyPreset = (p: McpPreset) => {
    setEdit({
      name: p.name,
      type: p.type,
      command: p.command ?? '',
      args: (p.args ?? []).join(' '),
      env: kvToLines(p.env),
      url: p.url ?? '',
      headers: kvToLines(p.headers),
    });
  };

  return (
    <div>
      <PageHeader
        title={t('settings.tab.mcp')}
        desc={t('mcp.hint')}
        action={{ label: t('mcp.new'), onClick: () => setEdit({ ...EMPTY_EDIT }) }}
      />
      <Section title={t('app.chooseCli')}>
        <FormRow label={t('app.chooseCli')}>
          <select value={cliId} onChange={(e) => setCliId(e.target.value as CliId)}>
            {clis.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </FormRow>
      </Section>

      {/* 内置 MCP 预设：一键载入编辑表单 */}
      {presets.length > 0 && !edit && (
        <Section title={t('mcp.presets')} desc={t('mcp.presetsHint')}>
          <div className="mcp-preset-grid">
            {presets.map((p) => {
              const added = servers.some((s) => s.name === p.name);
              return (
                <div key={p.id} className={`mcp-preset-card ${added ? 'added' : ''}`}>
                  <div className="mcp-preset-head">
                    <span className="mcp-preset-title">{p.title}</span>
                    {p.needsConfig && <span className="badge">{t('mcp.needsConfig')}</span>}
                    {added && <span className="badge">{t('mcp.added')}</span>}
                  </div>
                  <div className="hint mcp-preset-desc">{p.description}</div>
                  <button
                    className="mcp-preset-add"
                    disabled={added}
                    onClick={() => applyPreset(p)}
                  >
                    {added ? t('mcp.added') : `+ ${t('mcp.add')}`}
                  </button>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {edit && (
        <div className="auth-card">
          <label>{t('mcp.name')}</label>
          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <label>{t('mcp.type')}</label>
          <select
            value={edit.type}
            onChange={(e) => setEdit({ ...edit, type: e.target.value as McpType })}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
            <option value="sse">sse</option>
          </select>
          {edit.type === 'stdio' ? (
            <>
              <label>{t('mcp.command')}</label>
              <input
                value={edit.command}
                placeholder="npx"
                onChange={(e) => setEdit({ ...edit, command: e.target.value })}
              />
              <label>{t('mcp.args')}</label>
              <input
                value={edit.args}
                placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                onChange={(e) => setEdit({ ...edit, args: e.target.value })}
              />
              <label>{t('mcp.env')}</label>
              <textarea
                rows={2}
                value={edit.env}
                placeholder={'KEY=VALUE'}
                onChange={(e) => setEdit({ ...edit, env: e.target.value })}
              />
            </>
          ) : (
            <>
              <label>{t('mcp.url')}</label>
              <input
                value={edit.url}
                placeholder="https://mcp.example.com/mcp"
                onChange={(e) => setEdit({ ...edit, url: e.target.value })}
              />
              <label>{t('mcp.headers')}</label>
              <textarea
                rows={2}
                value={edit.headers}
                placeholder={'Authorization=Bearer xxx'}
                onChange={(e) => setEdit({ ...edit, headers: e.target.value })}
              />
            </>
          )}
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setEdit(null)}>
              {t('switch.cancel')}
            </button>
            <button disabled={!edit.name.trim()} onClick={save}>
              {t('auth.save')}
            </button>
          </div>
        </div>
      )}

      {servers.length === 0 && !edit && <div className="hint">{t('mcp.empty')}</div>}
      {servers.map((s) => (
        <SettingRow
          key={s.name}
          title={
            <>
              {s.name} <span className="badge">{s.type}</span>
            </>
          }
          desc={s.type === 'stdio' ? `${s.command ?? ''} ${(s.args ?? []).join(' ')}` : s.url}
          actions={
            <>
              <button
                className={`toggle ${s.enabled ? 'on' : ''}`}
                onClick={() => void run(window.hub.setMcpEnabled(cliId, s.name, !s.enabled))}
              />
              <button className="icon-btn" title={t('mcp.edit')} onClick={() => startEdit(s)}>
                <Pencil size={13} />
              </button>
              <button
                className="icon-btn"
                title={t('sidebar.delete')}
                onClick={() => {
                  if (window.confirm(t('mcp.deleteConfirm', { name: s.name }))) {
                    void run(window.hub.deleteMcpServer(cliId, s.name));
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </>
          }
        />
      ))}
    </div>
  );
}
