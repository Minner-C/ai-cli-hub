// 错误模式识别：常见 API 错误 → 友好提示类别（原始错误保留展示）
export type ErrorKind = 'auth' | 'quota' | 'model' | 'network' | 'unknown';

export function classifyError(raw: string): ErrorKind {
  const s = raw.toLowerCase();
  if (/\b401\b|unauthorized|authentication_failed|invalid.?api.?key|not logged in|鉴权/.test(s)) {
    return 'auth';
  }
  if (/\b429\b|rate.?limit|quota|insufficient|balance|usage.?limit|billing.?cycle|reached.*limit|billing|额度已?(用尽|用完|不足|耗尽|超限)|限流/.test(s)) {
    return 'quota';
  }
  if (/model.?not.?found|no such model|model.*not.*exist|unknown model|model.*not configured|模型不存在/.test(s)) {
    return 'model';
  }
  if (/econn|enotfound|etimedout|network|socket|fetch failed|网络/.test(s)) {
    return 'network';
  }
  return 'unknown';
}
