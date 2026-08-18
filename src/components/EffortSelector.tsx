// 思考强度选择器：档位按 CLI_FEATURES 能力矩阵逐 CLI 给出（不支持的 CLI 直接隐藏）
// dsh 实测档位 off/high/max；claude/codex/kimi 四~五档
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../store';
import { CLI_FEATURES, type CliId, type EffortLevel } from '../../electron/shared';

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

  // 从主进程获取该 CLI 的支持情况（与矩阵交叉确认）
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

  const levels = CLI_FEATURES[cliId]?.efforts ?? null;
  const supported = (support?.supported ?? false) && levels !== null;

  const onChange = async (effort: EffortLevel) => {
    try {
      await window.hub.setTaskEffort(taskId, effort);
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!supported || !levels) return null;

  // 当前档位不在该 CLI 档位表时（如切 CLI 遗留的 low/medium）回退到表内最近档显示
  const shown = current && levels.includes(current) ? current : levels[0];

  return (
    <select
      className="model-selector"
      value={shown}
      disabled={disabled}
      title={t('effort.title')}
      onChange={(e) => void onChange(e.target.value as EffortLevel)}
    >
      {levels.map((l) => (
        <option key={l} value={l}>
          {t('effort.title')} · {t(`effort.${l}`)}
        </option>
      ))}
    </select>
  );
}
