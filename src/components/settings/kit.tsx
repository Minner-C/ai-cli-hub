// 设置页共享骨架：页头（大标题+副标题+描述+主操作）与表格化行
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  desc,
  action,
}: {
  title: string;
  subtitle?: string;
  desc?: string;
  action?: { label: string; onClick: () => void; icon?: ReactNode };
}) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h2 className="page-title">{title}</h2>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
        {desc && <div className="page-desc">{desc}</div>}
      </div>
      {action && (
        <button className="primary-pill" onClick={action.onClick}>
          {action.icon ?? '＋'} {action.label}
        </button>
      )}
    </div>
  );
}

// 分区卡片：标题 + 描述 + 内容区，用于把零散表单归组，增强层次感
export function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <div className="settings-section-title">{title}</div>
        {desc && <div className="settings-section-desc">{desc}</div>}
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

// 表单行：左侧标签+描述，右侧控件，用于分区内的单条设置
export function FormRow({
  label,
  desc,
  children,
}: {
  label: ReactNode;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="form-row">
      <div className="form-row-label">
        <div className="form-row-title">{label}</div>
        {desc && <div className="form-row-desc">{desc}</div>}
      </div>
      <div className="form-row-control">{children}</div>
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return <div className="info-banner">{children}</div>;
}

// 表格化行：左侧图标+名称/描述，右侧操作区
export function SettingRow({
  icon,
  title,
  desc,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="setting-row">
      {icon}
      <div className="setting-row-main">
        <div className="setting-row-title">{title}</div>
        {desc && <div className="setting-row-desc">{desc}</div>}
      </div>
      {actions && <div className="setting-row-actions">{actions}</div>}
    </div>
  );
}
