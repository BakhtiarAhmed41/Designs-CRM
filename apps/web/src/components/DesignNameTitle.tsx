import { clipDesignLabel } from '@/lib/format';

export function DesignNameTitle({ names, fallback }: { names: string[]; fallback: string }) {
  const shown = names.map((name) => name.trim()).filter(Boolean);
  const full = shown.join(' / ') || fallback;
  const label = clipDesignLabel(full);

  return (
    <h1 className="ecd-title" title={label.full}>
      {label.text || fallback}
    </h1>
  );
}

export function DetailsSectionHead({
  title,
  description,
  open,
  onToggle,
}: {
  title: string;
  description?: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={open ? 'ecd-sec-h open is-toggle' : 'ecd-sec-h is-toggle'}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <h2>{title}</h2>
      {description ? <p className="ecd-sec-desc">{description}</p> : null}
      <span className="ecd-disclose">{open ? 'Hide details' : 'View details'}</span>
    </div>
  );
}
