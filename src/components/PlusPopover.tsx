// 输入栏「+」弹出面板：当前 CLI 的 Skills 与 MCP 服务器列表（含内置项）
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../store';
import type { CliId, McpServer, SkillInfo } from '../../electron/shared';

export default function PlusPopover({ cliId, cwd }: { cliId: CliId; cwd: string }) {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [sk, mc] = await Promise.all([
        window.hub.listSkills(cliId, cwd),
        window.hub.listMcpServers(cliId),
      ]);
      setSkills(sk);
      setServers(mc);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [cliId, cwd, setError]);

  // 打开时与 CLI 切换时刷新
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // 点击面板外关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggleSkill = (skill: SkillInfo) => {
    if (skill.scope === 'builtin') return; // 内置项无官方禁用机制
    void window.hub
      .toggleSkill(skill.path, skill.dirForm, !skill.enabled)
      .then(refresh)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const toggleMcp = (s: McpServer) => {
    void window.hub
      .setMcpEnabled(cliId, s.name, !s.enabled)
      .then(refresh)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const scopeBadge = (scope: SkillInfo['scope']) => (
    <span className="badge">{t(`skills.scope.${scope}`)}</span>
  );

  return (
    <div className="plus-root" ref={rootRef}>
      <button
        className="plus-btn"
        title={t('chat.plusTitle')}
        onClick={() => setOpen(!open)}
        type="button"
      >
        ＋
      </button>

      {open && (
        <div className="plus-popover">
          <div className="plus-section">
            <div className="plus-section-title">{t('chat.plusSkills')}</div>
            {skills.length === 0 && <div className="hint">{t('skills.empty')}</div>}
            {skills.map((skill) => (
              <div key={skill.path || skill.name} className="plus-item">
                <span className="plus-item-name" title={skill.description}>
                  {skill.name}
                </span>
                {scopeBadge(skill.scope)}
                <button
                  className={`toggle ${skill.enabled ? 'on' : ''}`}
                  disabled={skill.scope === 'builtin'}
                  title={
                    skill.scope === 'builtin' ? t('chat.builtinNoToggle') : undefined
                  }
                  onClick={() => toggleSkill(skill)}
                />
              </div>
            ))}
          </div>

          <div className="plus-section">
            <div className="plus-section-title">{t('chat.plusMcp')}</div>
            {servers.length === 0 && <div className="hint">{t('mcp.empty')}</div>}
            {servers.map((s) => (
              <div key={s.name} className="plus-item">
                <span className="plus-item-name" title={s.type === 'stdio' ? s.command : s.url}>
                  {s.name}
                </span>
                <span className="badge">{s.type}</span>
                <button
                  className={`toggle ${s.enabled ? 'on' : ''}`}
                  onClick={() => toggleMcp(s)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
