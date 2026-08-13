// 智能体模式开关组：计划（plan）/ Swarm / 目标（goal）
// 实测（kimi 0.34 ACP）：plan 走 set_config_option('mode','plan')；swarm/goal 在 ACP 下是 "Unknown ACP command"（TUI 专属），置灰标注
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrainCircuit } from 'lucide-react';
import { useHubStore } from '../store';
import type { CliId } from '../../electron/shared';

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

  const isKimi = cliId === 'kimi';
  const isClaude = cliId === 'claude';
  const planOn = current === 'plan';
  const goalActive = Boolean(goalOn);
  const supported = isKimi || isClaude;

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

  return (
    <div className="mode-root" ref={rootRef}>
      <button
        className={`model-selector ${planOn ? 'mode-active' : ''}`}
        disabled={disabled || !supported}
        title={supported ? t('mode.title') : t('mode.unsupported')}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <BrainCircuit size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
        {t('mode.title')}{planOn ? ` · ${t('mode.plan')}` : goalActive ? ` · ${t('mode.goal')}` : ''} ▾
      </button>

      {open && (
        <div className="mode-popover">
          {/* 计划 */}
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
          {/* Swarm */}
          <div className="mode-row mode-row-disabled" title={t('mode.kimiOnly')}>
            <div className="mode-row-text">
              <div className="mode-row-title">{t('mode.swarm')}</div>
              <div className="hint">{t('mode.swarmDesc')}</div>
            </div>
            <button className="toggle" disabled />
          </div>
          {/* 目标（仅 kimi：走 headless -p /goal） */}
          <div className={`mode-row ${isKimi ? '' : 'mode-row-disabled'}`} title={isKimi ? undefined : t('mode.kimiOnly')}>
            <div className="mode-row-text">
              <div className="mode-row-title">{t('mode.goal')}</div>
              <div className="hint">{t('mode.goalDesc')}</div>
            </div>
            <button
              className={`toggle ${goalActive ? 'on' : ''}`}
              disabled={!isKimi}
              onClick={() => void toggleGoal()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
