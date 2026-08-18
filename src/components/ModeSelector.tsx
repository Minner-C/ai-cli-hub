// 智能体模式开关组：计划（plan）/ Swarm / 目标（goal）
// 显隐由 CLI_FEATURES 能力矩阵决定：plan（kimi/claude/dsh）、goal（仅 kimi）；都不支持则整体隐藏
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrainCircuit } from 'lucide-react';
import { useHubStore } from '../store';
import { CLI_FEATURES, type CliId } from '../../electron/shared';

export default function ModeSelector({
  cliId,
  taskId,
  current,
  goalOn,
  disabled,
}: {
  cliId: CliId;
  taskId: string;
  current?: string; // '' | 'plan'
  goalOn?: boolean; // task.goalMode
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { refreshTasks, setError } = useHubStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const feats = CLI_FEATURES[cliId];
  const planSupported = feats?.plan ?? false;
  const goalSupported = feats?.goal ?? false;
  const planOn = current === 'plan';
  const goalActive = Boolean(goalOn);
  const supported = planSupported || goalSupported;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggleGoal = async () => {
    try {
      await window.hub.setTaskGoalMode(taskId, !goalActive);
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const togglePlan = async () => {
    try {
      // 计划是独立轴（kimi web 语义）：只切 planMode，不动权限档
      await window.hub.setTaskPlanMode(taskId, !planOn);
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!supported) return null; // 该 CLI 无任何模式能力，整体隐藏

  return (
    <div className="mode-root" ref={rootRef}>
      <button
        className={`model-selector ${planOn ? 'mode-active' : ''}`}
        disabled={disabled}
        title={t('mode.title')}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <BrainCircuit size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
        {t('mode.title')}{planOn ? ` · ${t('mode.plan')}` : goalActive ? ` · ${t('mode.goal')}` : ''} ▾
      </button>

      {open && (
        <div className="mode-popover">
          {/* 计划 */}
          {planSupported && (
            <div className="mode-row">
              <div className="mode-row-text">
                <div className="mode-row-title">{t('mode.plan')}</div>
                <div className="hint">{t('mode.planDesc')}</div>
              </div>
              <button
                className={`toggle ${planOn ? 'on' : ''}`}
                onClick={() => void togglePlan()}
              />
            </div>
          )}
          {/* Swarm（暂无 CLI 在 headless/ACP 下可用，保留占位说明） */}
          <div className="mode-row mode-row-disabled" title={t('mode.kimiOnly')}>
            <div className="mode-row-text">
              <div className="mode-row-title">{t('mode.swarm')}</div>
              <div className="hint">{t('mode.swarmDesc')}</div>
            </div>
            <button className="toggle" disabled />
          </div>
          {/* 目标（仅 kimi：走 headless -p /goal） */}
          {goalSupported && (
            <div className="mode-row">
              <div className="mode-row-text">
                <div className="mode-row-title">{t('mode.goal')}</div>
                <div className="hint">{t('mode.goalDesc')}</div>
              </div>
              <button
                className={`toggle ${goalActive ? 'on' : ''}`}
                onClick={() => void toggleGoal()}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
