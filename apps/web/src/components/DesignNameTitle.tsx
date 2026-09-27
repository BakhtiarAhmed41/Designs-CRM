import { useLayoutEffect, useRef } from 'react';

export function DesignNameTitle({ names, fallback }: { names: string[]; fallback: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const shown = names.map((name) => name.trim()).filter(Boolean);
  const many = shown.length > 1;

  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box || !many) return;
    let fitting = false;
    const fit = () => {
      if (fitting) return;
      fitting = true;
      el.classList.remove('is-clipped');
      el.style.fontSize = '';
      el.style.setProperty('--slash-pad', '8px');
      let pad = 8;
      while (el.scrollWidth > el.clientWidth + 1 && pad > 2) {
        pad -= 1;
        el.style.setProperty('--slash-pad', `${pad}px`);
      }
      let font = parseFloat(getComputedStyle(el).fontSize) || 28;
      while (el.scrollWidth > el.clientWidth + 1 && font > 15) {
        font -= 0.5;
        el.style.fontSize = `${font}px`;
      }
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add('is-clipped');
      fitting = false;
    };
    fit();
    const observer = new ResizeObserver(() => fit());
    observer.observe(box);
    return () => observer.disconnect();
  }, [many, shown.join('\n')]);

  if (!many) {
    return <h1>{shown[0] || fallback}</h1>;
  }

  return (
    <h1 className="ecd-title" ref={ref} title={shown.join(' / ')}>
      {shown.map((name, index) => (
        <span key={`${name}-${index}`} className="ecd-title-part">
          {index > 0 && (
            <span className="ecd-title-slash" aria-hidden="true">
              /
            </span>
          )}
          <span className="ecd-title-name">{name}</span>
        </span>
      ))}
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
      <span className="ecd-disclose" aria-hidden="true">
        <i className={open ? 'ti ti-minus' : 'ti ti-plus'} />
      </span>
    </div>
  );
}
