type Props = {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function EmptyState({ icon = 'ti-inbox', title, description, action }: Props) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-icon" aria-hidden>
        <i className={`ti ${icon}`} />
      </div>
      <div className="empty-state-title">{title}</div>
      {description && <p className="empty-state-desc">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="alert-error" role="alert">
      <i className="ti ti-alert-circle" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

export function SuccessBanner({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="alert-success" role="status">
      <i className="ti ti-circle-check" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
