// 设置页 - 模型与供应商 tab：两级结构（供应商→模型）
// 供应商同时配置 OpenAI/Anthropic/Gemini 多协议端点，模型只配置 modelId/品牌/显示名
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../../store';
import { PageHeader, SettingRow, InfoBanner } from './kit';
import { Pencil, Trash2, Plus, ChevronDown, ChevronRight, Key, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { ModelEntry, ProviderEntry } from '../../../electron/shared';
import { BRAND_PRESETS } from '../../../electron/shared';
import BrandLogo from '../BrandLogo';

const EMPTY_MODEL = (providerId?: string): ModelEntry => ({
  id: '',
  displayName: '',
  modelId: '',
  providerId,
  brand: '',
  enabled: true,
  contextWindow: 128000,
  multimodal: false,
});

const EMPTY_PROVIDER: ProviderEntry = {
  id: '',
  displayName: '',
  custom: true,
};

// 品牌选项（供应商和模型共用）
const brandOptions = [
  { value: '', label: '— 跟随供应商 —' },
  ...BRAND_PRESETS.map((p) => ({ value: p.brand, label: p.displayName })),
];

export default function ModelProvidersTab() {
  const { t } = useTranslation();
  const { setError, refreshModelEntries } = useHubStore();
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [entries, setEntries] = useState<ModelEntry[]>([]);
  const [providerKeyMap, setProviderKeyMap] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [editModel, setEditModel] = useState<ModelEntry | null>(null);
  const [editProvider, setEditProvider] = useState<ProviderEntry | null>(null);
  const [providerKeyInput, setProviderKeyInput] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    const [ps, es] = await Promise.all([
      window.hub.listProviders(),
      window.hub.listModelEntries(),
    ]);
    setProviders(ps);
    setEntries(es);
    // 同步到全局 store，供 ChatView 的 ContextRing 查询模型 contextWindow
    refreshModelEntries();
    // 检查各供应商是否已存 key
    const keyMap: Record<string, boolean> = {};
    await Promise.all(ps.map(async (p) => {
      keyMap[p.id] = await window.hub.providerHasKey(p.id);
    }));
    setProviderKeyMap(keyMap);
  }, [refreshModelEntries]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = (p: Promise<unknown>) =>
    p.then(refresh).catch((err) => setError(err instanceof Error ? err.message : String(err)));

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- 供应商保存 ----
  const saveProvider = async () => {
    if (!editProvider) return;
    const p: ProviderEntry = {
      ...editProvider,
      id: editProvider.id || `provider:${editProvider.displayName.trim().replace(/\s+/g, '-').toLowerCase()}`,
    };
    await run(window.hub.saveProvider(p));
    if (providerKeyInput.trim()) {
      await window.hub.saveProviderApiKey(p.id, providerKeyInput.trim());
    }
    setEditProvider(null);
    setProviderKeyInput('');
  };

  // ---- 模型保存 ----
  const saveModel = async () => {
    if (!editModel) return;
    const entry: ModelEntry = {
      ...editModel,
      id: editModel.id || `model:${editModel.displayName.trim().replace(/\s+/g, '-').toLowerCase()}`,
    };
    await run(window.hub.saveModelEntry(entry));
    setEditModel(null);
    setTestResult(null);
  };

  // 测试连接：保存当前编辑内容（不关闭弹窗），再发起测试，期间显示动效与结果
  const testModel = async () => {
    if (!editModel) return;
    setTesting(true);
    setTestResult(null);
    setTestOk(null);
    try {
      // 保存到后端但保持弹窗打开，便于用户看到测试动效与结果
      const entry: ModelEntry = {
        ...editModel,
        id: editModel.id || `model:${editModel.displayName.trim().replace(/\s+/g, '-').toLowerCase()}`,
      };
      await window.hub.saveModelEntry(entry);
      // 同步本地 id，避免下次保存重复创建
      setEditModel(entry);
      await refresh();
      const result = await window.hub.testModelEntry(entry.id);
      setTestOk(result.ok);
      setTestResult(result.ok ? t('models.testOk') : result.message);
    } catch (err) {
      setTestOk(false);
      setTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  // 选择品牌预设时自动填充多协议端点
  const onProviderBrandChange = (brand: string) => {
    if (!editProvider) return;
    const preset = BRAND_PRESETS.find((p) => p.brand === brand);
    if (preset) {
      setEditProvider({
        ...editProvider,
        brand: preset.brand,
        displayName: editProvider.displayName || preset.displayName,
        baseUrlOpenai: preset.baseUrlOpenai,
        baseUrlAnthropic: preset.baseUrlAnthropic,
        baseUrlGemini: preset.baseUrlGemini,
      });
    } else {
      // 自定义供应商：清空品牌标识，保留用户已填的端点
      setEditProvider({ ...editProvider, brand: undefined });
    }
  };

  // 当前编辑的供应商是否支持某协议端点（用于动态显示输入框）
  const hasProtocol = (protocol: 'openai' | 'anthropic' | 'gemini'): boolean => {
    if (!editProvider) return false;
    if (protocol === 'openai') return editProvider.baseUrlOpenai !== undefined;
    if (protocol === 'anthropic') return editProvider.baseUrlAnthropic !== undefined;
    return editProvider.baseUrlGemini !== undefined;
  };

  // 切换协议端点的显示/隐藏（自定义供应商可手动开启协议）
  const toggleProtocol = (protocol: 'openai' | 'anthropic' | 'gemini') => {
    if (!editProvider) return;
    const key = protocol === 'openai' ? 'baseUrlOpenai' : protocol === 'anthropic' ? 'baseUrlAnthropic' : 'baseUrlGemini';
    const current = editProvider[key];
    if (current === undefined) {
      // 开启：设为空字符串（表示未填写，但已启用该协议）
      setEditProvider({ ...editProvider, [key]: '' });
    } else {
      // 关闭：删除该字段
      const next = { ...editProvider };
      delete next[key];
      setEditProvider(next);
    }
  };

  // 按供应商分组
  const grouped: Array<{ provider: ProviderEntry | null; models: ModelEntry[] }> = [
    ...providers.map((p) => ({
      provider: p,
      models: entries.filter((e) => e.providerId === p.id),
    })),
    { provider: null, models: entries.filter((e) => !e.providerId) },
  ];

  return (
    <div>
      <PageHeader
        title={t('settings.tab.modelProviders')}
        subtitle={t('models.manage')}
        desc={t('models.listHint')}
        action={{ label: '添加供应商', onClick: () => setEditProvider({ ...EMPTY_PROVIDER }) }}
      />
      <InfoBanner>{t('models.routeHint')}</InfoBanner>

      {entries.length === 0 && providers.length === 0 && (
        <div className="empty-hint" style={{ padding: '24px 12px', color: 'var(--fg-muted)', fontSize: 13 }}>
          {t('models.emptyHint')}
        </div>
      )}

      {grouped.map(({ provider, models }) => {
        if (provider === null && models.length === 0) return null;
        const groupId = provider?.id ?? '__ungrouped__';
        const isOpen = expanded.has(groupId);
        return (
          <div key={groupId} className="provider-group">
            {/* 供应商头 */}
            <div className="provider-group-head">
              <button
                className="icon-btn"
                onClick={() => toggleExpand(groupId)}
                style={{ padding: 2 }}
              >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {provider ? (
                <>
                  <BrandLogo brand={provider.displayName} size={18} />
                  <span className="provider-group-name">{provider.displayName}</span>
                  <span className="hint">（{models.length} 款模型）</span>
                  {/* 协议端点标识 */}
                  {provider.baseUrlOpenai !== undefined && <span className="proto-badge openai">OpenAI</span>}
                  {provider.baseUrlAnthropic !== undefined && <span className="proto-badge anthropic">Anthropic</span>}
                  {provider.baseUrlGemini !== undefined && <span className="proto-badge gemini">Gemini</span>}
                  {providerKeyMap[provider.id] && (
                    <Key size={11} className="hint" style={{ color: 'var(--success)' }} />
                  )}
                  <span style={{ flex: 1 }} />
                  <button
                    className="secondary"
                    onClick={() => setEditModel(EMPTY_MODEL(provider.id))}
                  >
                    <Plus size={12} /> 加模型
                  </button>
                  <button
                    className="icon-btn"
                    title="编辑供应商"
                    onClick={() => {
                      setEditProvider({ ...provider });
                      setProviderKeyInput('');
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    title="删除供应商"
                    onClick={() => {
                      if (window.confirm(`删除供应商「${provider.displayName}」？其下模型将归为未分组。`)) {
                        void run(window.hub.deleteProvider(provider.id));
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              ) : (
                <>
                  <span className="provider-group-name">未分组模型</span>
                  <span className="hint">（{models.length} 款）</span>
                  <span style={{ flex: 1 }} />
                  <button
                    className="secondary"
                    onClick={() => setEditModel(EMPTY_MODEL())}
                  >
                    <Plus size={12} /> 加模型
                  </button>
                </>
              )}
            </div>

            {/* 供应商下的模型列表 */}
            {isOpen && models.length > 0 && (
              <div className="provider-group-body">
                {models.map((entry) => (
                  <SettingRow
                    key={entry.id}
                    title={
                      <>
                        <BrandLogo
                          brand={entry.brand || provider?.displayName || ''}
                          size={18}
                          style={{ marginRight: 6, verticalAlign: 'middle' }}
                        />
                        {entry.displayName}
                      </>
                    }
                    desc={entry.modelId || t('models.endpointDefault')}
                    actions={
                      <>
                        <button
                          className={`toggle ${entry.enabled ? 'on' : ''}`}
                          onClick={() => void run(window.hub.saveModelEntry({ ...entry, enabled: !entry.enabled }))}
                        />
                        <button className="icon-btn" title={t('mcp.edit')} onClick={() => setEditModel({ ...entry })}>
                          <Pencil size={13} />
                        </button>
                        <button
                          className="icon-btn"
                          title={t('sidebar.delete')}
                          onClick={() => {
                            if (window.confirm(t('mcp.deleteConfirm', { name: entry.displayName }))) {
                              void run(window.hub.deleteModelEntry(entry.id));
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* ---- 供应商编辑弹窗 ---- */}
      {editProvider && (
        <div className="dialog-overlay" style={{ zIndex: 200 }}>
          <div className="dialog">
            <h2>{editProvider.id ? '编辑供应商' : '添加供应商'}</h2>

            {/* 快速选择品牌预设 */}
            <label>品牌预设（自动填充端点）</label>
            <select
              value={editProvider.brand ?? ''}
              onChange={(e) => onProviderBrandChange(e.target.value)}
            >
              <option value="">— 自定义供应商 —</option>
              {BRAND_PRESETS.map((p) => (
                <option key={p.brand} value={p.brand}>{p.displayName}</option>
              ))}
            </select>

            <label>供应商名称</label>
            <input
              value={editProvider.displayName}
              onChange={(e) => setEditProvider({ ...editProvider, displayName: e.target.value })}
              placeholder="如：智谱 AI"
            />

            {/* 多协议端点：按品牌动态显示，自定义供应商可手动开启 */}
            <label>API 端点（按协议填写，留空表示该协议官方默认端点）</label>
            {!editProvider.brand && (
              <div className="protocol-toggles">
                {(['openai', 'anthropic', 'gemini'] as const).map((proto) => (
                  <label key={proto} className="checkbox-row" style={{ fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={hasProtocol(proto)}
                      onChange={() => toggleProtocol(proto)}
                    />
                    <span>{proto === 'openai' ? 'OpenAI 协议' : proto === 'anthropic' ? 'Anthropic 协议' : 'Gemini 协议'}</span>
                  </label>
                ))}
              </div>
            )}
            {hasProtocol('openai') && (
              <>
                <label className="endpoint-label">OpenAI 协议端点</label>
                <input
                  value={editProvider.baseUrlOpenai ?? ''}
                  placeholder="https://api.openai.com/v1"
                  onChange={(e) => setEditProvider({ ...editProvider, baseUrlOpenai: e.target.value })}
                />
              </>
            )}
            {hasProtocol('anthropic') && (
              <>
                <label className="endpoint-label">Anthropic 协议端点</label>
                <input
                  value={editProvider.baseUrlAnthropic ?? ''}
                  placeholder="https://api.anthropic.com"
                  onChange={(e) => setEditProvider({ ...editProvider, baseUrlAnthropic: e.target.value })}
                />
              </>
            )}
            {hasProtocol('gemini') && (
              <>
                <label className="endpoint-label">Gemini 协议端点</label>
                <input
                  value={editProvider.baseUrlGemini ?? ''}
                  placeholder="https://generativelanguage.googleapis.com"
                  onChange={(e) => setEditProvider({ ...editProvider, baseUrlGemini: e.target.value })}
                />
              </>
            )}

            <label>API Key{providerKeyMap[editProvider.id] ? '（已配置，留空保持不变）' : ''}</label>
            <input
              type="password"
              value={providerKeyInput}
              onChange={(e) => setProviderKeyInput(e.target.value)}
              placeholder={providerKeyMap[editProvider.id] ? '••••••••' : '输入 API Key（同一平台的 key 通用于多协议端点）'}
            />

            <div className="dialog-actions">
              <button className="secondary" onClick={() => { setEditProvider(null); setProviderKeyInput(''); }}>
                {t('switch.cancel')}
              </button>
              <button
                disabled={!editProvider.displayName.trim() || (!hasProtocol('openai') && !hasProtocol('anthropic') && !hasProtocol('gemini'))}
                onClick={() => void saveProvider()}
              >
                {t('auth.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- 模型编辑弹窗 ---- */}
      {editModel && (
        <div className="dialog-overlay" style={{ zIndex: 200 }}>
          <div className="dialog">
            <h2>{editModel.id ? t('mcp.edit') : t('models.addModel')}</h2>

            {/* 所属供应商 */}
            <label>所属供应商</label>
            <select
              value={editModel.providerId || ''}
              onChange={(e) => setEditModel({ ...editModel, providerId: e.target.value || undefined })}
            >
              <option value="">未分组</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>

            {/* 模型 logo 品牌选择 */}
            <label>模型 Logo（品牌）</label>
            <select
              value={editModel.brand || ''}
              onChange={(e) => setEditModel({ ...editModel, brand: e.target.value || undefined })}
            >
              {brandOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            <label>{t('models.displayName')}</label>
            <input
              value={editModel.displayName}
              onChange={(e) => setEditModel({ ...editModel, displayName: e.target.value })}
            />

            <label>{t('models.modelId')}</label>
            <input
              value={editModel.modelId}
              placeholder={t('models.modelIdHint')}
              onChange={(e) => setEditModel({ ...editModel, modelId: e.target.value })}
            />

            {/* 上下文窗口大小（tokens）—— 决定 kimi config.toml max_context_size 和 UI 上下文占用估算 */}
            <label>上下文窗口大小（tokens）</label>
            <input
              type="number"
              min={1000}
              step={1000}
              value={editModel.contextWindow ?? 128000}
              onChange={(e) => setEditModel({ ...editModel, contextWindow: Math.max(1000, Number(e.target.value) || 128000) })}
            />

            {/* 多模态（图片输入）开关 —— 决定 kimi capabilities 是否包含 image_in */}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={!!editModel.multimodal}
                onChange={(e) => setEditModel({ ...editModel, multimodal: e.target.checked })}
              />
              <span>支持图片输入（多模态）</span>
            </label>

            {testResult && (
              <div className={`test-result ${testOk ? 'ok' : 'fail'}`}>
                {testOk ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                <span>{testResult}</span>
              </div>
            )}

            <div className="dialog-actions">
              <button className="secondary" onClick={() => { setEditModel(null); setTestResult(null); setTestOk(null); }}>
                {t('switch.cancel')}
              </button>
              <button className="secondary test-btn" disabled={!editModel.displayName.trim() || testing} onClick={() => void testModel()}>
                {testing ? <Loader2 size={13} className="spin" /> : null}
                {testing ? t('models.testing') : t('models.testConnection')}
              </button>
              <button disabled={!editModel.displayName.trim()} onClick={() => void saveModel()}>
                {t('auth.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
