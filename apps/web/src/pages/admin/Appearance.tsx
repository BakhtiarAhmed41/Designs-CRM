import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { getErrorMessage } from '@/lib/api';
import {
  DEFAULT_THEME_COLORS,
  THEME_FIELDS,
  normalizeHex,
  themesEqual,
  type ThemeColorKey,
  type ThemeColors,
} from '@/lib/theme';
import { ErrorBanner, SuccessBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

export function AdminAppearance() {
  const { colors: saved, loaded, preview, persist } = useTheme();
  const [draft, setDraft] = useState<ThemeColors>(saved);
  const [hexDraft, setHexDraft] = useState<Record<ThemeColorKey, string>>(saved);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savedRef = useRef(saved);
  savedRef.current = saved;

  useEffect(() => {
    if (!loaded) return;
    setDraft(saved);
    setHexDraft(saved);
    // Only sync when the server theme finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    return () => {
      preview(savedRef.current);
    };
    // Put the last saved colors back if this page is left without Save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = !themesEqual(draft, saved);

  function setColor(key: ThemeColorKey, value: string) {
    setHexDraft((prev) => ({ ...prev, [key]: value }));
    const hex = normalizeHex(value);
    if (!hex) return;
    const next = { ...draft, [key]: hex };
    setDraft(next);
    preview(next);
    setMsg(null);
  }

  async function onSave() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const next = await persist(draft);
      setDraft(next);
      setHexDraft(next);
      setMsg('Colors saved. They now apply for everyone.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const next = await persist(DEFAULT_THEME_COLORS);
      setDraft(next);
      setHexDraft(next);
      setMsg('Default colors are back.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const groups: Array<{ id: (typeof THEME_FIELDS)[number]['group']; title: string }> = [
    { id: 'app', title: 'App' },
    { id: 'sidebar', title: 'Sidebar & top bar' },
    { id: 'form', title: 'Forms' },
    { id: 'status', title: 'Status labels' },
  ];

  return (
    <div>
      <PageHeader
        title="Colors"
        subtitle="Try colors here. Save applies them for everyone — admin, customer portal, login, pay pages, and quote forms."
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => void onReset()} disabled={busy}>
              Reset to default
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onSave()}
              disabled={busy || !dirty}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      />

      {(msg || error) && (
        <div style={{ marginBottom: 14 }}>
          {msg && <SuccessBanner>{msg}</SuccessBanner>}
          {error && <ErrorBanner>{error}</ErrorBanner>}
        </div>
      )}

      {groups.map((group) => (
        <div key={group.id} className="card card-pad theme-card">
          <div className="theme-card-title">{group.title}</div>
          <div className="theme-fields">
            {THEME_FIELDS.filter((field) => field.group === group.id).map((field) => (
              <ColorField
                key={field.key}
                label={field.label}
                hint={field.hint}
                hex={hexDraft[field.key]}
                onChange={(value) => setColor(field.key, value)}
              />
            ))}
          </div>
          {group.id === 'app' && (
            <div className="theme-preview">
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: draft.buttonBg, color: draft.buttonText, border: 'none' }}
              >
                Primary
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: draft.cardBg,
                  color: draft.mainText,
                  border: `1px solid ${draft.formBorder}`,
                }}
              >
                Secondary
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: draft.cardBg,
                  color: draft.accent,
                  border: `1px solid ${draft.formBorder}`,
                }}
              >
                Danger
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: draft.accent, color: '#fff', border: 'none' }}
              >
                Delete
              </button>
            </div>
          )}
          {group.id === 'form' && (
            <div className="theme-preview">
              <input
                className="theme-preview-input"
                defaultValue="Sample field"
                readOnly
                style={{
                  background: draft.formBg,
                  color: draft.formText,
                  border: `1px solid ${draft.formFocus}`,
                }}
              />
            </div>
          )}
          {group.id === 'status' && (
            <div className="theme-preview">
              <span className="theme-preview-chip" style={{ background: `${draft.success}22`, color: draft.success }}>
                Success
              </span>
              <span className="theme-preview-chip" style={{ background: `${draft.warning}22`, color: draft.warning }}>
                Warning
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ColorField({
  label,
  hint,
  hex,
  onChange,
}: {
  label: string;
  hint: string;
  hex: string;
  onChange: (value: string) => void;
}) {
  const valid = normalizeHex(hex);
  const pickerValue = (valid ?? '#000000').toLowerCase();
  const digits = hex.replace(/^#/, '').toUpperCase();

  function onDigits(raw: string) {
    const cleaned = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    onChange(cleaned ? `#${cleaned}` : '#');
  }

  return (
    <label className="theme-field">
      <span className="theme-field-text">
        <span className="theme-field-label">{label}</span>
        <span className="theme-field-hint">{hint}</span>
      </span>
      <span className={`theme-hex${valid ? '' : ' invalid'}`}>
        <span className="theme-hex-swatch" style={{ background: pickerValue }}>
          <input
            type="color"
            value={pickerValue}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label} picker`}
          />
        </span>
        <span className="theme-hex-hash" aria-hidden>
          #
        </span>
        <input
          type="text"
          className="theme-hex-input"
          value={digits}
          onChange={(e) => onDigits(e.target.value)}
          spellCheck={false}
          maxLength={6}
          placeholder="222222"
          aria-label={`${label} hex`}
        />
      </span>
    </label>
  );
}
