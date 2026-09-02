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

  const appFields = THEME_FIELDS.filter((f) => f.group === 'app');
  const sidebarFields = THEME_FIELDS.filter((f) => f.group === 'sidebar');

  return (
    <div>
      <PageHeader
        title="Colors"
        subtitle="Try colors on this page. Click Save to keep them. Reset puts the default look back right away."
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

      <div className="card card-pad theme-card">
        <div className="theme-card-title">App</div>
        <div className="theme-fields">
          {appFields.map((field) => (
            <ColorField
              key={field.key}
              label={field.label}
              hint={field.hint}
              hex={hexDraft[field.key]}
              onChange={(value) => setColor(field.key, value)}
            />
          ))}
        </div>
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
              background: draft.pageBg,
              color: draft.mainText,
              border: `1px solid ${draft.mainText}1a`,
            }}
          >
            Secondary
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{
              background: draft.pageBg,
              color: draft.accent,
              border: `1px solid ${draft.mainText}1a`,
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
      </div>

      <div className="card card-pad theme-card">
        <div className="theme-card-title">Sidebar &amp; top bar</div>
        <div className="theme-fields">
          {sidebarFields.map((field) => (
            <ColorField
              key={field.key}
              label={field.label}
              hint={field.hint}
              hex={hexDraft[field.key]}
              onChange={(value) => setColor(field.key, value)}
            />
          ))}
        </div>
      </div>
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
