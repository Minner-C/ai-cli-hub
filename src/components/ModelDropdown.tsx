// 模型下拉面板：CLI 内置模型列表 + 第三方供应商模型 + 厂商原生 logo
// 模型与 CLI 解耦：所有 enabled 第三方模型都可被任意已安装 CLI 调用
// CLI 内置模型：通过 listModels 获取每个 CLI 自带的多个官方模型
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Check, AlertTriangle } from 'lucide-react';
import { useHubStore } from '../store';
import type { CliId, ModelEntry, ModelInfo, ProviderEntry } from '../../electron/shared';
import BrandLogo from './BrandLogo';

export default function ModelDropdown({
  taskId,
  taskCli,
  currentEntryId,
  taskModel,
  disabled,
  onAddModel,
}: {
  taskId: string;
  taskCli: CliId;
  currentEntryId?: string;
  taskModel?: string;
  disabled?: boolean;
  onAddModel: () => void;
}) {
  const { t } = useTranslation();
  const { refreshTasks, setError, tasks, createTask } = useHubStore();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ModelEntry[]>([]);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [builtins, setBuiltins] = useState<ModelInfo[]>([]);
  // 待切换的非多模态模型（历史含图片时弹窗确认）
  const [pendingEntry, setPendingEntry] = useState<ModelEntry | null>(null);
  const [switching, setSwitching] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 打开时并行加载第三方模型、供应商与当前 CLI 的内置模型
  useEffect(() => {
    if (!open) return;
    void Promise.all([
      window.hub.listModelEntries(),
      window.hub.listProviders(),
      window.hub.listModels(taskCli),
    ]).then(([list, ps, bl]) => {
      setEntries(list.filter((e) => e.enabled));
      setProviders(ps);
      setBuiltins(bl);
    });
  }, [open, taskCli]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = entries.find((e) => e.id === currentEntryId);
  // 当前选中的内置模型（无第三方条目时，按 taskModel 匹配）
  const currentBuiltin = !currentEntryId && taskModel
    ? builtins.find((m) => m.id === taskModel)
    : undefined;
  const usingDefault = !currentEntryId && !taskModel;

  // 检测任务历史消息中是否包含图片/视频附件
  // Kimi Code 在 session/load 恢复历史时会一并上传图片，切换到非多模态模型会报 400 错误
  const task = tasks.find((t) => t.id === taskId);
  const hasMediaInHistory = (task?.messages ?? []).some((m) => m.images && m.images.length > 0);

  // 选择 CLI 内置模型：清空第三方条目，写入 task.model
  const pickBuiltin = async (m: ModelInfo | null) => {
    try {
      await window.hub.setTaskModelEntry(taskId, '');
      if (m) await window.hub.setTaskModel(taskId, m.id);
      else await window.hub.setTaskModel(taskId, '');
      await refreshTasks();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // 选择第三方模型：写入 modelEntryId（优先级高于 task.model）
  const pickEntry = async (entry: ModelEntry) => {
    // 历史含图片/视频且目标模型非多模态：弹窗提示用户新开任务
    if (hasMediaInHistory && !entry.multimodal) {
      setPendingEntry(entry);
      return;
    }
    try {
      await window.hub.setTaskModelEntry(taskId, entry.id);
      await refreshTasks();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // 确认新开任务：同 CLI + 同 cwd 创建新任务，并设置目标模型
  const confirmNewTask = async () => {
    if (!pendingEntry || !task) return;
    setSwitching(true);
    try {
      await createTask(taskCli, task.cwd);
      // createTask 会将新任务设为 activeTaskId；读取最新的 activeTaskId
      const newTaskId = useHubStore.getState().activeTaskId;
      if (newTaskId) {
        await window.hub.setTaskModelEntry(newTaskId, pendingEntry.id);
        await refreshTasks();
      }
      setPendingEntry(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSwitching(false);
    }
  };

  // 按钮显示文案
  const label = current
    ? current.displayName
    : currentBuiltin
      ? currentBuiltin.displayName
      : t('chat.modelDefault');

  return (
    <div className="model-dropdown-root" ref={rootRef}>
      <button className="model-selector" disabled={disabled} onClick={() => setOpen(!open)} type="button">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <BrandLogo brand={current?.brand ?? taskCli} size={14} />
          {label}
        </span>{' '}
        ▾
      </button>

      {open && (
        <div className="model-dropdown-panel">
          {/* CLI 内置模型（当前 CLI 自带的官方模型） */}
          <div className="model-group">
            <div className="model-group-title">{t('models.nativeGroup')}</div>
            {/* 自动默认：不传 --model，由 CLI 自行决定 */}
            <div
              className={`model-item ${usingDefault ? 'active' : ''}`}
              onClick={() => void pickBuiltin(null)}
            >
              <BrandLogo brand={taskCli} size={18} />
              <span className="model-item-name">{t('chat.modelDefault')}</span>
              {usingDefault && <Check size={13} />}
            </div>
            {/* 各内置模型 */}
            {builtins.map((m) => {
              const active = !currentEntryId && taskModel === m.id;
              return (
                <div
                  key={m.id}
                  className={`model-item ${active ? 'active' : ''}`}
                  onClick={() => void pickBuiltin(m)}
                >
                  <BrandLogo brand={taskCli} size={18} />
                  <span className="model-item-name">{m.displayName}</span>
                  {active && <Check size={13} />}
                </div>
              );
            })}
          </div>

          {/* 第三方模型：按供应商分组 */}
          {entries.length > 0 && (
            <>
              {providers.map((p) => {
                const models = entries.filter((e) => e.providerId === p.id);
                if (models.length === 0) return null;
                return (
                  <div className="model-group" key={p.id}>
                    <div className="model-group-title">
                      <BrandLogo brand={p.displayName} size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                      {p.displayName}
                    </div>
                    {models.map((e) => (
                      <div
                        key={e.id}
                        className={`model-item ${e.id === currentEntryId ? 'active' : ''}`}
                        onClick={() => void pickEntry(e)}
                      >
                        <BrandLogo brand={e.brand || p.displayName} size={18} />
                        <span className="model-item-name">{e.displayName}</span>
                        {e.id === currentEntryId && <Check size={13} />}
                      </div>
                    ))}
                  </div>
                );
              })}
              {/* 未分组的第三方模型 */}
              {(() => {
                const ungrouped = entries.filter((e) => !e.providerId);
                if (ungrouped.length === 0) return null;
                return (
                  <div className="model-group">
                    <div className="model-group-title">{t('models.customGroup')}</div>
                    {ungrouped.map((e) => (
                      <div
                        key={e.id}
                        className={`model-item ${e.id === currentEntryId ? 'active' : ''}`}
                        onClick={() => void pickEntry(e)}
                      >
                        <BrandLogo brand={e.brand} size={18} />
                        <span className="model-item-name">{e.displayName}</span>
                        {e.id === currentEntryId && <Check size={13} />}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          )}

          <div
            className="model-item model-add"
            onClick={() => {
              setOpen(false);
              onAddModel();
            }}
          >
            <Plus size={14} /> {t('models.addModel')}
          </div>
        </div>
      )}

      {/* 红色警告弹窗：历史含图片/视频，切换非多模态模型需新开任务 */}
      {pendingEntry && (
        <div className="dialog-overlay">
          <div className="dialog dialog-warning">
            <div className="warning-header">
              <AlertTriangle size={20} className="warning-icon" />
              <h2>{t('modelSwitch.warningTitle')}</h2>
            </div>
            <div className="warning-body">
              {t('modelSwitch.warningBody')}
            </div>
            <div className="warning-target">
              {t('modelSwitch.targetModel')}: <strong>{pendingEntry.displayName}</strong>
            </div>
            <div className="hint">{t('modelSwitch.newTaskHint')}</div>
            <div className="dialog-actions">
              <button className="secondary" onClick={() => setPendingEntry(null)} disabled={switching}>
                {t('modelSwitch.cancel')}
              </button>
              <button className="danger-fill" onClick={() => void confirmNewTask()} disabled={switching}>
                {switching ? t('modelSwitch.switching') : t('modelSwitch.confirmNewTask')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
