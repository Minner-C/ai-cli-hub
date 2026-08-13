// 权限模式选择器：下拉选择，按任务持久化，按档位着色
// 支持：claude/codex（命令行参数）、kimi/qwen/gemini（配置文件写入）；其余置灰并 tooltip 说明
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../store';
import type { CliId, PermissionMode } from '../../electron/shared';

const MODES: PermissionMode[] = ['default', 'auto', 'yolo'];

// 档位 → 颜色类名（用于下拉项着色）
function modeClass(mode: PermissionMode): string {
  switch (mode) {
    case 'auto':
      return 'perm-auto';
    case 'yolo':
      return 'perm-yolo';
    default:
      return 'perm-default';
  }
}

export default function PermissionSelector({
  cliId,
  taskId,
  current,
  disabled,
}: {
  cliId: CliId;
  taskId: string;
  current?: PermissionMode;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { refreshTasks, setError } = useHubStore();
  const [support, setSupport] = useState<{ supported: boolean; note?: string; via?: 'args' | 'config' | 'none' } | null>(null);
  const [configMode, setConfigMode] = useState<PermissionMode | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    window.hub
      .getPermissionSupport(cliId)
      .then((s) => {
        if (!cancelled) setSupport(s);
        // 配置文件类 CLI：读取当前配置中的权限模式作为初始展示
        if (s.via === 'config') {
          window.hub.readPermissionFromConfig(cliId).then((m) => {
            if (!cancelled) setConfigMode(m);
          }).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cliId]);

  const supported = support?.supported ?? false;
  // 任务级权限优先，其次配置文件读取的值；未显式设置时回退 auto（headless 场景无交互审批）
  // 兼容旧数据：permission==='plan' 是计划模式独立轴拆分前的残留，按未设置处理
  const rawCurrent = current === 'plan' ? undefined : current;
  const active = rawCurrent ?? configMode ?? 'auto';

  const onChange = async (mode: PermissionMode) => {
    try {
      await window.hub.setTaskPermission(taskId, mode);
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!supported) {
    // 不支持的 CLI：置灰下拉 + tooltip
    return (
      <select
        className="model-selector perm-disabled"
        disabled
        title={t(support?.note ?? 'permission.unsupported')}
        value="default"
      >
        <option value="default">{t('permission.selectorTitle')} · {t('permission.default')}</option>
      </select>
    );
  }

  return (
    <select
      className={`model-selector ${modeClass(active)}`}
      value={active}
      disabled={disabled}
      title={t('permission.selectorTitle')}
      onChange={(e) => void onChange(e.target.value as PermissionMode)}
    >
      {MODES.map((m) => (
        <option key={m} value={m}>
          {t('permission.selectorTitle')} · {t(`permission.${m}`)}
        </option>
      ))}
    </select>
  );
}
