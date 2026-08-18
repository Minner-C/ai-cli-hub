// 设置页 - 单个 CLI 的设置分区：版本与更新 / 常用设置表单 / 高级原文编辑
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../../store';
import { PageHeader, InfoBanner, Section, FormRow } from './kit';
import { AuthCard } from './AuthTab';
import { FeatureBlocks } from './featureBlocks';
import { ArrowLeft } from 'lucide-react';
import type { CliId } from '../../../electron/shared';
import type { RawConfig } from '../../../electron/cliConfigManager';

// ---- 版本与更新 ----
function VersionBlock({ cliId, installed, installHint }: { cliId: CliId; installed: boolean; installHint: string }) {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [version, setVersion] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateLog, setUpdateLog] = useState('');
  // checkState: null=未检查, 'up-to-date'=已是最新, 'available'=可更新, 'failed'=检查失败, 'unknown'=无法检查
  const [checkState, setCheckState] = useState<null | 'up-to-date' | 'available' | 'failed' | 'unknown'>(null);

  // 订阅更新输出（复用安装事件通道）
  useEffect(() => {
    const offP = window.hub.onInstallProgress((id, chunk) => {
      if (id === cliId) setUpdateLog((s) => (s + chunk).slice(-3000));
    });
    const offD = window.hub.onInstallDone((id, ok) => {
      if (id === cliId && ok) void window.hub.cliVersion(cliId).then(setVersion).catch(() => undefined);
    });
    return () => {
      offP();
      offD();
    };
  }, [cliId]);

  useEffect(() => {
    if (!installed) return;
    void window.hub.cliVersion(cliId).then(setVersion).catch(() => undefined);
  }, [cliId, installed]);

  if (!installed) {
    return (
      <Section title={t('cliSettings.notInstalled')}>
        <div className="hint mono">{installHint}</div>
      </Section>
    );
  }

  const checkUpdate = async () => {
    setChecking(true);
    setCheckState(null);
    try {
      const v = await window.hub.cliCheckLatest(cliId);
      setLatest(v);
      if (v === null) {
        setCheckState('unknown');
      } else if (version && v === version) {
        setCheckState('up-to-date');
      } else {
        setCheckState('available');
      }
    } catch {
      setCheckState('failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Section title={t('cliSettings.version')}>
      <div className="version-row">
        <span className="mono">{version ?? '…'}</span>
        <button className="secondary" disabled={checking} onClick={() => void checkUpdate()}>
          {checking ? t('cliSettings.checking') : t('cliSettings.checkUpdate')}
        </button>
        <button
          className="secondary"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            setUpdateLog('');
            try {
              await window.hub.cliUpdate(cliId);
            } catch (e) {
              setError(String(e));
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking ? t('cliSettings.installing') : t('cliSettings.runUpdate')}
        </button>
      </div>
      {/* 检查结果反馈：明确告知用户当前是最新版 / 可更新版本 / 检查失败 */}
      {checkState === 'up-to-date' && (
        <div className="version-feedback ok">
          <span className="feedback-icon">✓</span>
          {t('cliSettings.upToDateFeedback', { version: version ?? '' })}
        </div>
      )}
      {checkState === 'available' && latest && (
        <div className="version-feedback warn">
          <span className="feedback-icon">↑</span>
          {t('cliSettings.updateAvailable', { current: version ?? '?', latest })}
        </div>
      )}
      {checkState === 'failed' && (
        <div className="version-feedback err">
          <span className="feedback-icon">!</span>
          {t('cliSettings.checkFailed')}
        </div>
      )}
      {checkState === 'unknown' && (
        <div className="version-feedback hint">
          <span className="feedback-icon">?</span>
          {t('cliSettings.checkUnknown')}
        </div>
      )}
      {updateLog && <pre className="install-output">{updateLog}</pre>}
    </Section>
  );
}

// ---- 表单字段定义 ----
type FieldType = 'text' | 'number' | 'checkbox' | 'select';
interface FieldDef {
  key: string;           // 顶层键或一层嵌套 a.b
  label: string;
  type: FieldType;
  options?: string[];
  optionsFromModels?: boolean; // kimi：选项取 config.toml [models] 表的键
}

function kimiFields(): FieldDef[] {
  // 以官方文档为准（config-files.html）：max_retries_per_step 已在 0.32.0 废弃，改名 max_attempts_per_step
  return [
    { key: 'default_model', label: 'default_model', type: 'select', optionsFromModels: true },
    { key: 'default_permission_mode', label: 'default_permission_mode', type: 'select', options: ['manual', 'auto', 'yolo'] },
    { key: 'default_plan_mode', label: 'default_plan_mode', type: 'checkbox' },
    { key: 'merge_all_available_skills', label: 'merge_all_available_skills', type: 'checkbox' },
    { key: 'builtin_product_skills', label: 'builtin_product_skills', type: 'checkbox' },
    { key: 'telemetry', label: 'telemetry', type: 'checkbox' },
    { key: 'thinking.enabled', label: 'thinking.enabled', type: 'checkbox' },
    { key: 'thinking.effort', label: 'thinking.effort', type: 'select', options: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { key: 'loop_control.max_steps_per_turn', label: 'loop_control.max_steps_per_turn', type: 'number' },
    { key: 'loop_control.max_attempts_per_step', label: 'loop_control.max_attempts_per_step', type: 'number' },
    { key: 'loop_control.reserved_context_size', label: 'loop_control.reserved_context_size', type: 'number' },
  ];
}

const SIMPLE_FIELDS: Partial<Record<CliId, FieldDef[]>> = {
  claude: [
    { key: 'model', label: 'model', type: 'text' },
    { key: 'permissions.defaultMode', label: 'permissions.defaultMode', type: 'select', options: ['default', 'acceptEdits', 'plan', 'bypassPermissions'] },
    { key: 'includeCoAuthoredBy', label: 'includeCoAuthoredBy', type: 'checkbox' },
    { key: 'cleanupPeriodDays', label: 'cleanupPeriodDays', type: 'number' },
    { key: 'enableTelemetry', label: 'enableTelemetry', type: 'checkbox' },
    { key: 'autoUpdates', label: 'autoUpdates', type: 'checkbox' },
    { key: 'alwaysThinkingEnabled', label: 'alwaysThinkingEnabled', type: 'checkbox' },
  ],
  gemini: [
    // 以 gemini-cli 捆绑文档 docs/cli/settings.md 的 v2 嵌套路径为准
    { key: 'model.name', label: 'model.name', type: 'text' },
    { key: 'general.defaultApprovalMode', label: 'general.defaultApprovalMode', type: 'select', options: ['default', 'auto_edit', 'plan'] },
    { key: 'general.enableAutoUpdate', label: 'general.enableAutoUpdate', type: 'checkbox' },
    { key: 'general.maxAttempts', label: 'general.maxAttempts', type: 'number' },
    { key: 'general.sessionRetention.enabled', label: 'general.sessionRetention.enabled', type: 'checkbox' },
    { key: 'general.sessionRetention.maxAge', label: 'general.sessionRetention.maxAge', type: 'text' },
    { key: 'model.maxSessionTurns', label: 'model.maxSessionTurns', type: 'number' },
    { key: 'model.compressionThreshold', label: 'model.compressionThreshold', type: 'number' },
    { key: 'security.auth.selectedType', label: 'security.auth.selectedType', type: 'select', options: ['oauth-personal', 'gemini-api-key', 'vertex-ai', 'cloud-shell'] },
    { key: 'security.folderTrust.enabled', label: 'security.folderTrust.enabled', type: 'checkbox' },
    { key: 'ui.hideBanner', label: 'ui.hideBanner', type: 'checkbox' },
    { key: 'skills.enabled', label: 'skills.enabled', type: 'checkbox' },
    { key: 'hooksConfig.enabled', label: 'hooksConfig.enabled', type: 'checkbox' },
  ],
  qwen: [
    // qwen-code（gemini fork）实测键：tools.approvalMode / privacy.usageStatisticsEnabled / general.checkpointing
    { key: 'model.name', label: 'model.name', type: 'text' },
    { key: 'tools.approvalMode', label: 'tools.approvalMode', type: 'select', options: ['plan', 'default', 'auto-edit', 'auto', 'yolo'] },
    { key: 'tools.autoAccept', label: 'tools.autoAccept', type: 'checkbox' },
    { key: 'general.checkpointing.enabled', label: 'general.checkpointing.enabled', type: 'checkbox' },
    { key: 'privacy.usageStatisticsEnabled', label: 'privacy.usageStatisticsEnabled', type: 'checkbox' },
    { key: 'security.auth.selectedType', label: 'security.auth.selectedType', type: 'text' },
    { key: 'ui.theme', label: 'ui.theme', type: 'text' },
  ],
  codex: [
    // 以 codex.exe 二进制内嵌配置键实测为准（disable_response_storage / show_shell_agent_output 已不存在）
    { key: 'model', label: 'model', type: 'text' },
    { key: 'model_reasoning_effort', label: 'model_reasoning_effort', type: 'select', options: ['minimal', 'low', 'medium', 'high'] },
    { key: 'plan_mode_reasoning_effort', label: 'plan_mode_reasoning_effort', type: 'select', options: ['minimal', 'low', 'medium', 'high'] },
    { key: 'approval_policy', label: 'approval_policy', type: 'select', options: ['untrusted', 'on-failure', 'on-request', 'never'] },
    { key: 'sandbox_mode', label: 'sandbox_mode', type: 'select', options: ['read-only', 'workspace-write', 'danger-full-access'] },
    { key: 'hide_agent_reasoning', label: 'hide_agent_reasoning', type: 'checkbox' },
    { key: 'skip_git_repo_check', label: 'skip_git_repo_check', type: 'checkbox' },
  ],
  pi: [
    { key: 'defaultProvider', label: 'defaultProvider', type: 'text' },
    { key: 'defaultModel', label: 'defaultModel', type: 'text' },
    { key: 'defaultThinkingLevel', label: 'defaultThinkingLevel', type: 'select', options: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
    { key: 'defaultProjectTrust', label: 'defaultProjectTrust', type: 'select', options: ['ask', 'always', 'never'] },
    { key: 'hideThinkingBlock', label: 'hideThinkingBlock', type: 'checkbox' },
    { key: 'quietStartup', label: 'quietStartup', type: 'checkbox' },
    { key: 'enableInstallTelemetry', label: 'enableInstallTelemetry', type: 'checkbox' },
    { key: 'enableAnalytics', label: 'enableAnalytics', type: 'checkbox' },
    { key: 'theme', label: 'theme', type: 'select', options: ['dark', 'light'] },
    { key: 'compaction.enabled', label: 'compaction.enabled', type: 'checkbox' },
  ],
  opencode: [
    { key: 'model', label: 'model', type: 'text' },
    { key: 'small_model', label: 'small_model', type: 'text' },
    { key: 'theme', label: 'theme', type: 'text' },
    { key: 'default_agent', label: 'default_agent', type: 'text' },
    { key: 'autoupdate', label: 'autoupdate', type: 'select', options: ['true', 'false', 'notify'] },
    { key: 'share', label: 'share', type: 'select', options: ['manual', 'auto', 'disabled'] },
    { key: 'tui.scroll_speed', label: 'tui.scroll_speed', type: 'number' },
    { key: 'tui.diff_style', label: 'tui.diff_style', type: 'select', options: ['auto', 'stacked'] },
    { key: 'tui.sidebar', label: 'tui.sidebar', type: 'select', options: ['auto', 'show', 'hide'] },
    { key: 'compaction.auto', label: 'compaction.auto', type: 'checkbox' },
    { key: 'compaction.prune', label: 'compaction.prune', type: 'checkbox' },
  ],
  aider: [
    { key: 'model', label: 'model', type: 'text' },
    { key: 'weak-model', label: 'weak-model', type: 'text' },
    { key: 'editor-model', label: 'editor-model', type: 'text' },
    { key: 'edit-format', label: 'edit-format', type: 'select', options: ['udiff', 'architect', 'wholefile', 'diff'] },
    { key: 'architect', label: 'architect', type: 'checkbox' },
    { key: 'auto-accept-architect', label: 'auto-accept-architect', type: 'checkbox' },
    { key: 'auto-commits', label: 'auto-commits', type: 'checkbox' },
    { key: 'show-diffs', label: 'show-diffs', type: 'checkbox' },
    { key: 'dark-mode', label: 'dark-mode', type: 'checkbox' },
    { key: 'pretty', label: 'pretty', type: 'checkbox' },
    { key: 'map-tokens', label: 'map-tokens', type: 'number' },
    { key: 'reasoning-effort', label: 'reasoning-effort', type: 'text' },
    { key: 'thinking-tokens', label: 'thinking-tokens', type: 'number' },
    { key: 'verify-ssl', label: 'verify-ssl', type: 'checkbox' },
    { key: 'attribute-co-authored-by', label: 'attribute-co-authored-by', type: 'checkbox' },
  ],
  hermes: [
    { key: 'model', label: 'model', type: 'text' },
    { key: 'provider', label: 'provider', type: 'select', options: ['nous', 'openai', 'anthropic', 'openrouter', 'deepseek', 'custom'] },
    { key: 'terminal.backend', label: 'terminal.backend', type: 'select', options: ['local', 'docker'] },
    { key: 'tools.enabled', label: 'tools.enabled', type: 'checkbox' },
    { key: 'tools.file_ops', label: 'tools.file_ops', type: 'checkbox' },
    { key: 'tools.terminal', label: 'tools.terminal', type: 'checkbox' },
    { key: 'tools.browser', label: 'tools.browser', type: 'checkbox' },
    { key: 'tools.web_search', label: 'tools.web_search', type: 'checkbox' },
    { key: 'memory.enabled', label: 'memory.enabled', type: 'checkbox' },
    { key: 'compression.enabled', label: 'compression.enabled', type: 'checkbox' },
    { key: 'checkpoints.enabled', label: 'checkpoints.enabled', type: 'checkbox' },
    { key: 'smart_routing', label: 'smart_routing', type: 'checkbox' },
    { key: 'max_turns', label: 'max_turns', type: 'number' },
    { key: 'context_window', label: 'context_window', type: 'number' },
  ],
};

function getPath(doc: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let cur: unknown = doc;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setPath(doc: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split('.');
  const out = { ...doc };
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = { ...((cur[parts[i]] as Record<string, unknown>) ?? {}) };
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  if (value === undefined) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = value;
  return out;
}

// ---- 常用设置表单 ----
function FormBlock({ cliId, busy, onSaved }: { cliId: CliId; busy: boolean; onSaved: () => void }) {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const fields = cliId === 'kimi' ? kimiFields() : SIMPLE_FIELDS[cliId] ?? [];
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);

  const reload = useCallback(async () => {
    setDoc(await window.hub.cliConfigReadDoc(cliId));
  }, [cliId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (fields.length === 0) return null;
  if (!doc) return <div className="hint">…</div>;

  const saveField = async (key: string, value: unknown) => {
    try {
      const next = setPath(doc, key, value);
      await window.hub.cliConfigWriteFields(cliId, next);
      setDoc(next);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Section title={t('cliSettings.commonSettings')} desc={t('cliSettings.advancedHint')}>
      {fields.map((f) => {
        const value = getPath(doc, f.key);
        // kimi default_model：选项实时取 config.toml 的 [models] 表键
        const options = f.optionsFromModels
          ? Object.keys((doc.models as Record<string, unknown>) ?? {})
          : f.options;
        return (
          <FormRow
            key={f.key}
            label={t(`cliFields.${f.label}`, { defaultValue: f.label })}
            desc={f.label}
          >
            {f.type === 'checkbox' ? (
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(value)}
                className={`toggle ${value ? 'on' : ''}`}
                disabled={busy}
                onClick={() => void saveField(f.key, !value)}
              />
            ) : f.type === 'select' ? (
              <select
                value={String(value ?? '')}
                disabled={busy}
                onChange={(e) => void saveField(f.key, e.target.value)}
              >
                <option value="">—</option>
                {/* 当前值不在预设选项里时保留显示（如自定义模型别名） */}
                {value !== undefined && value !== '' && !(options ?? []).includes(String(value)) && (
                  <option value={String(value)}>{String(value)}</option>
                )}
                {(options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {t(`cliFields.opt.${o}`, { defaultValue: o })}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === 'number' ? 'number' : 'text'}
                defaultValue={value === undefined ? '' : String(value)}
                disabled={busy}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  const v = raw === '' ? undefined : f.type === 'number' ? Number(raw) : raw;
                  void saveField(f.key, v);
                }}
              />
            )}
          </FormRow>
        );
      })}
    </Section>
  );
}

// ---- 高级：原文编辑 ----
function AdvancedEditor({ cliId, busy }: { cliId: CliId; busy: boolean }) {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [raw, setRaw] = useState<RawConfig | null>(null);
  const [text, setText] = useState('');
  const [hasBackup, setHasBackup] = useState(false);

  const reload = useCallback(async () => {
    const r = await window.hub.cliConfigReadRaw(cliId);
    setRaw(r);
    setText(r.content);
    setHasBackup(await window.hub.cliConfigHasBackup(cliId));
  }, [cliId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!raw || !raw.format) {
    return (
      <Section title={t('cliSettings.advanced')}>
        <div className="hint">{t('cliSettings.noConfig')}</div>
      </Section>
    );
  }

  const save = async () => {
    try {
      await window.hub.cliConfigWriteRaw(cliId, text);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const restore = async () => {
    try {
      await window.hub.cliConfigRestoreBackup(cliId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Section title={t('cliSettings.advanced')} desc={raw.path ?? undefined}>
      <textarea
        className="config-editor"
        rows={14}
        value={text}
        disabled={busy}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="dialog-actions" style={{ justifyContent: 'flex-start' }}>
        <button disabled={busy} onClick={() => void save()}>{t('auth.save')}</button>
        {hasBackup && (
          <button className="secondary" disabled={busy} onClick={() => void restore()}>
            {t('cliSettings.restoreBackup')}
          </button>
        )}
      </div>
      <div className="hint">{t('cliSettings.advancedHint')}</div>
    </Section>
  );
}

export default function CliSettingsPage({ cliId, onBack }: { cliId: CliId; onBack?: () => void }) {
  const { t } = useTranslation();
  const { clis, runningTaskIds } = useHubStore();
  const cli = clis.find((c) => c.id === cliId);
  const busy = runningTaskIds.size > 0; // 生成中禁止保存（避免与 kimi 临时改写等机制冲突）

  return (
    <div>
      <div className="cli-detail-head">
        {onBack && (
          <button className="icon-btn" onClick={onBack} title={t('cliSettings.back')}>
            <ArrowLeft size={16} />
          </button>
        )}
        <PageHeader title={cli?.displayName ?? cliId} desc={t('cliSettings.detailDesc')} />
      </div>
      {busy && <InfoBanner>{t('cliSettings.busyHint')}</InfoBanner>}
      <AuthCard cliId={cliId} displayName={cli?.displayName ?? cliId} installed={cli?.installed ?? false} />
      <VersionBlock cliId={cliId} installed={cli?.installed ?? false} installHint={cli?.installHint ?? ''} />
      <FeatureBlocks cliId={cliId} />
      <FormBlock cliId={cliId} busy={busy} onSaved={() => undefined} />
      <AdvancedEditor cliId={cliId} busy={busy} />
    </div>
  );
}
