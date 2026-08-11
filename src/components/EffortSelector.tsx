// 思考强度选择器：关/低/中/高 pill，按任务持久化
// 支持情况由主进程 effortManager 经 IPC 下发（单一数据源，不与主进程分叉）：
// claude/codex 全四档可选；kimi/gemini/其他置灰并 tooltip 说明（假可点不如明确置灰）
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../store';
import type { CliId, EffortLevel } from '../../electron/shared';

const LEVELS: EffortLevel[] = ['off', 'low', 'medium', 'high'];

export default function EffortSelector({
  cliId,
  taskId,
  current,
  disabled,
}: {
  cliId: CliId;
  taskId: string;
  current?: EffortLevel;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { refreshTasks, setError } = useHubStore();
  const [support, setSupport] = useState<{ supported: boolean; note?: string } | null>(null);

  // 从主进程获取该 CLI 的支持情况（claude/codex → supported）
  useEffect(() => {
    let cancelled = false;
    window.hub
      .getEffortSupport(cliId)
      .then((s) => {
        if (!cancelled) setSupport(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cliId]);

  const supported = support?.supported ?? false;

  const onChange = async (effort: EffortLevel) => {
    try {
      await window.hub.setTaskEffort(taskId, effort);
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <select
      className="model-selector"
      value={current ?? 'off'}
      disabled={disabled || !supported}
      title={
        supported
          ? t('effort.title')
          : t(support?.note ?? 'effort.unsupported')
      }
      onChange={(e) => void onChange(e.target.value as EffortLevel)}
    >
      {LEVELS.map((l) => (
        <option key={l} value={l}>
          {t('effort.title')} · {t(`effort.${l}`)}
        </option>
      ))}
    </select>
  );
}
