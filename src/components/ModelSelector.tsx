// 模型选择器：当前 CLI 的模型下拉，选择持久化到任务
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../store';
import type { CliId, ModelInfo } from '../../electron/shared';

interface Props {
  cliId: CliId;
  taskId: string;
  currentModel?: string;
  disabled?: boolean;
}

export default function ModelSelector({ cliId, taskId, currentModel, disabled }: Props) {
  const { t } = useTranslation();
  const { refreshTasks, setError } = useHubStore();
  const [models, setModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.hub
      .listModels(cliId)
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cliId]);

  const onChange = async (model: string) => {
    try {
      await window.hub.setTaskModel(taskId, model);
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (models.length === 0) return null;

  return (
    <select
      className="model-selector"
      value={currentModel ?? ''}
      disabled={disabled}
      title={t('chat.model')}
      onChange={(e) => void onChange(e.target.value)}
    >
      <option value="">{t('chat.modelDefault')}</option>
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}
