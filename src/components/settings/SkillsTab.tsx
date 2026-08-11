// 设置页 - Skills tab：列出/启停/新建/删除/打开 各 CLI 的 skills
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../../store';
import { PageHeader, Section, FormRow } from './kit';
import { Pencil, X } from 'lucide-react';
import type { CliId, SkillInfo, SkillTemplate } from '../../../electron/shared';

const SUPPORTED: CliId[] = ['kimi', 'claude'];

export default function SkillsTab() {
  const { t } = useTranslation();
  const { clis, tasks, setError } = useHubStore();
  const [cliId, setCliId] = useState<CliId>('kimi');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // 项目级扫描用最近一个该 CLI 任务的 cwd
  const cwd = tasks.find((task) => task.cli === cliId)?.cwd;

  const refresh = useCallback(async () => {
    setSkills(await window.hub.listSkills(cliId, cwd));
  }, [cliId, cwd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void window.hub.listSkillTemplates().then(setTemplates).catch(() => undefined);
  }, []);

  const run = (p: Promise<unknown>) =>
    p.then(refresh).catch((err) => setError(err instanceof Error ? err.message : String(err)));

  const installed = clis.filter((c) => SUPPORTED.includes(c.id));

  return (
    <div>
      <PageHeader
        title={t('settings.tab.skills')}
        desc={t('skills.unsupportedNote')}
        action={{ label: t('skills.new'), onClick: () => setCreating(!creating) }}
      />
      <Section title={t('app.chooseCli')}>
        <FormRow label={t('app.chooseCli')}>
          <select value={cliId} onChange={(e) => setCliId(e.target.value as CliId)}>
            {installed.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </FormRow>
      </Section>

      {/* 内置 Skill 模板：一键创建为用户级 skill */}
      {templates.length > 0 && !creating && (
        <Section title={t('skills.templates')} desc={t('skills.templatesHint')}>
          <div className="mcp-preset-grid">
            {templates.map((tpl) => {
              // 同名（含 -N 后缀）的 user/project skill 视为已创建
              const created = skills.some(
                (s) =>
                  s.scope !== 'builtin' &&
                  (s.name === tpl.name || s.name.startsWith(`${tpl.name}-`)),
              );
              return (
                <div key={tpl.id} className={`mcp-preset-card ${created ? 'added' : ''}`}>
                  <div className="mcp-preset-head">
                    <span className="mcp-preset-title">{tpl.name}</span>
                    {created && <span className="badge">{t('skills.created')}</span>}
                  </div>
                  <div className="hint mcp-preset-desc">{tpl.description}</div>
                  <button
                    className="mcp-preset-add"
                    disabled={created}
                    onClick={() => void run(window.hub.createSkillFromTemplate(cliId, tpl.id))}
                  >
                    {created ? t('skills.created') : `+ ${t('skills.create')}`}
                  </button>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {creating && (
        <div className="auth-card">
          <input
            placeholder={t('skills.namePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            placeholder={t('skills.descPlaceholder')}
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            style={{ marginTop: 6 }}
          />
          <div className="dialog-actions">
            <button
              disabled={!newName.trim() || !newDesc.trim()}
              onClick={() => {
                void run(window.hub.createSkill(cliId, newName.trim(), newDesc.trim())).then(() => {
                  setCreating(false);
                  setNewName('');
                  setNewDesc('');
                });
              }}
            >
              {t('app.create')}
            </button>
          </div>
        </div>
      )}

      {skills.length === 0 && <div className="hint">{t('skills.empty')}</div>}
      {skills.map((skill) => (
        <div key={skill.path} className="skill-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div>
              <strong>{skill.name}</strong>{' '}
              <span className="badge">{t(`skills.scope.${skill.scope}`)}</span>{' '}
              {!skill.enabled && <span className="badge">{t('skills.disabled')}</span>}
            </div>
            <div className="hint skill-desc">{skill.description}</div>
          </div>
          <div className="session-actions">
            <button
              className={`toggle ${skill.enabled ? 'on' : ''}`}
              title={
                skill.scope === 'builtin'
                  ? t('chat.builtinNoToggle')
                  : skill.enabled
                    ? t('skills.disable')
                    : t('skills.enable')
              }
              disabled={skill.scope === 'builtin'}
              onClick={() => void run(window.hub.toggleSkill(skill.path, skill.dirForm, !skill.enabled))}
            />
            {skill.scope !== 'builtin' && (
              <>
                <button title={t('skills.open')} onClick={() => void window.hub.openSkill(skill.path)}>
                  <Pencil size={12} />
                </button>
                <button
                  title={t('sidebar.delete')}
                  onClick={() => {
                    if (window.confirm(t('skills.deleteConfirm', { name: skill.name }))) {
                      void run(window.hub.deleteSkill(skill.path));
                    }
                  }}
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
