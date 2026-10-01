import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type SelectMenuOption = {
  value: string;
  label: string;
};

export function SelectMenu({
  value,
  onChange,
  options,
  id,
  ariaLabel,
  disabled,
  size = 'field',
  className,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectMenuOption[];
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: 'field' | 'compact' | 'ead';
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const label = selected?.label ?? 'Select…';

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!menu || !button) return;

    function place() {
      if (!menu || !button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(
        Math.max(rect.width, size === 'compact' ? 180 : rect.width),
        window.innerWidth - 16,
      );
      menu.style.width = `${width}px`;
      const height = menu.offsetHeight;
      const gap = 6;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const openUp = spaceBelow < height && rect.top > spaceBelow;
      let top = openUp ? rect.top - gap - height : rect.bottom + gap;
      top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
      if (left < 8) left = 8;
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    }

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, options.length, size]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={`select-menu-wrap is-${size}${className ? ` ${className}` : ''}`} style={style}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={`select-menu-btn${open ? ' is-open' : ''}${value === '' ? ' is-empty' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
      >
        <span>{label}</span>
        <i className="ti ti-chevron-down" aria-hidden />
      </button>
      {open &&
        createPortal(
          <>
            <div
              className="select-menu-backdrop"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div ref={menuRef} className="select-menu" role="listbox" aria-label={ariaLabel}>
              {options.length === 0 && <div className="select-menu-empty">No options</div>}
              {options.map((option, index) => {
                const on = option.value === value;
                return (
                  <button
                    key={`${option.value}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={on ? 'is-on' : ''}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      if (!on) onChange(option.value);
                    }}
                  >
                    <span>{option.label}</span>
                    {on && <i className="ti ti-check" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
