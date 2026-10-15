import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { PHONE_COUNTRIES } from '@/lib/phoneCountries';

export function PhoneCountrySelect({ value, onChange }: { value: string; onChange: (country: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const selected = PHONE_COUNTRIES.find(([country]) => country === value) ?? PHONE_COUNTRIES[0];
  const term = query.trim().toLowerCase().replace(/^\+/, '');
  const options = PHONE_COUNTRIES.filter(([country, code, name]) => `${country} ${code} ${name}`.toLowerCase().includes(term));

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  function show() {
    setQuery('');
    setActive(PHONE_COUNTRIES.findIndex(([country]) => country === value));
    setPosition(null);
    setOpen(true);
  }
  function choose(country: string) {
    onChange(country);
    close(true);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    if (event.key === 'Tab') {
      event.preventDefault();
      close();
      if (event.shiftKey) trigger.current?.focus();
      else trigger.current?.closest('.login-phone-wrap')?.querySelector<HTMLInputElement>('input')?.focus();
    }
    if (!options.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    }
    if (event.key === 'Enter') { event.preventDefault(); choose(options[active]?.[0] ?? options[0][0]); }
  }

  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const up = below < 300 && above > below;
      const width = Math.min(320, window.innerWidth - 24);
      setPosition({
        width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        maxHeight: Math.max(100, Math.min(340, (up ? above : below) - 20)),
        ...(up ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      });
    }
    function outside(event: PointerEvent) {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    }
    place();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const positioned = Boolean(position);
  useEffect(() => { if (open && positioned) search.current?.focus(); }, [open, positioned]);
  useEffect(() => {
    if (open) menu.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, positioned]);

  return (
    <>
      <button ref={trigger} type="button" className="phone-country-trigger" aria-label={`Phone country code: ${selected[2]} +${selected[1]}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => open ? close() : show()} onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
        }}>
        <span className="phone-country-abbr">{selected[0]}</span>
        <span>+{selected[1]}</span>
        <i className="ti ti-chevron-down" aria-hidden />
      </button>
      {open && position && createPortal(
        <div ref={menu} id={id} className="phone-country-menu" style={position} role="dialog" aria-label="Choose a country code">
          <div className="phone-country-search">
            <i className="ti ti-search" aria-hidden />
            <input ref={search} type="search" role="combobox" aria-label="Search country or calling code" aria-controls={`${id}-options`} aria-expanded="true" aria-autocomplete="list"
              aria-activedescendant={options.length ? `${id}-option-${active}` : undefined}
              placeholder="Search country or code" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown} />
          </div>
          <div className="phone-country-options" id={`${id}-options`} role="listbox" aria-label="Countries">
            {options.map(([country, code, name], index) => (
              <button key={country} id={`${id}-option-${index}`} type="button" role="option" tabIndex={-1} aria-selected={country === value} data-option-index={index}
                className={index === active ? 'is-active' : ''} onMouseEnter={() => setActive(index)} onClick={() => choose(country)}>
                <span className="phone-country-abbr">{country}</span>
                <span className="phone-country-name">{name}</span>
                <span className="phone-country-code">+{code}</span>
                <span className="phone-country-check">{country === value && <i className="ti ti-check" aria-hidden />}</span>
              </button>
            ))}
            {!options.length && <p className="phone-country-empty" role="status">No matching countries</p>}
          </div>
        </div>, document.body,
      )}
    </>
  );
}
