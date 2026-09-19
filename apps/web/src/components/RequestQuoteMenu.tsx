import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRequestQuote } from '@/context/RequestQuoteContext';

const SERVICES = [
  {
    key: 'embroidery',
    title: 'Embroidery Digitizing',
    desc: 'Turn your logo into a stitch file. DST, PES and more.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" />
      </svg>
    ),
  },
  {
    key: 'vector',
    title: 'Vector & Print',
    desc: 'Logo redraws and print-ready color separations.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="2.2" />
        <circle cx="18" cy="6" r="2.2" />
        <circle cx="12" cy="18" r="2.2" />
        <path d="M7.8 7.2 10.5 16M16.2 7.2 13.5 16M8.2 6h7.6" />
      </svg>
    ),
  },
  {
    key: 'laser',
    title: 'Cut, Print & Engraving',
    desc: 'Cutting, engraving, print files and plasma files.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2" />
        <rect x="6" y="14" width="12" height="7" rx="1" />
      </svg>
    ),
  },
] as const;

export function RequestQuoteMenu({
  className = 'btn btn-primary',
  children,
  beforePick,
}: {
  className?: string;
  children: React.ReactNode;
  beforePick?: () => boolean | Promise<boolean>;
}) {
  const navigate = useNavigate();
  const { openRequestQuote } = useRequestQuote();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function pick(key: string) {
    if (beforePick) {
      const ok = await beforePick();
      if (!ok) return;
    }
    setOpen(false);
    openRequestQuote(key);
  }

  function chat() {
    setOpen(false);
    navigate('/portal/messages');
  }

  return (
    <div className={`quote-menu${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className={className}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>

      {open && (
        <>
          <div className="qd-overlay open" onClick={() => setOpen(false)} />
          <div className="quote-dropdown open" id={menuId} role="dialog" aria-label="Request a quote">
            <div className="qd-header">
              <h2>
                <span className="plus">+</span>Request a quote
              </h2>
              <button type="button" className="qd-close" aria-label="Close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="qd-body">
              <div className="qd-list">
                {SERVICES.map((s) => (
                  <button key={s.key} type="button" className="qd-row" onClick={() => pick(s.key)}>
                    <div className="qd-icon">{s.icon}</div>
                    <div className="qd-text">
                      <p className="t">{s.title}</p>
                      <p className="d">{s.desc}</p>
                    </div>
                    <span className="qd-arrow">→</span>
                  </button>
                ))}
              </div>

              <div className="qd-help">
                <div className="qd-help-left">
                  <div className="qd-icon">
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                  </div>
                  <div>
                    <p className="t">Need help?</p>
                    <p className="d">Our team can help with artwork, sizing and file requirements.</p>
                  </div>
                </div>
                <button type="button" className="qd-chat-btn" onClick={chat}>
                  Chat
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
