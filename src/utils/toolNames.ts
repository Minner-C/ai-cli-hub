// 工具名 → 本地化显示名（未覆盖的原样显示）
import type { TFunction } from 'i18next';

export function toolDisplayName(t: TFunction, name: string): string {
  const key = `tools.${name}`;
  const translated = t(key);
  return translated === key ? name : translated;
}
