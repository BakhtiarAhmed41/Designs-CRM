import { Link } from 'react-router-dom';

type Crumb = { label: string; to?: string };

export function PageHeader({
  title,
  subtitle,
  crumbs,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  return (
    <div className="ph">
      <div className="ph-main">
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="crumb">
                {i > 0 && (
                  <i className="ti ti-chevron-right" aria-hidden />
                )}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </div>
  );
}
