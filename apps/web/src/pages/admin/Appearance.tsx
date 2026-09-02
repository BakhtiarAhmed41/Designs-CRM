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
    preview(saved);
    // Only sync when the server theme finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    return () => {
      preview(savedRef.current);
    };
    // Revert unsaved preview when leaving the page.
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

  function onReset() {
    setDraft(DEFAULT_THEME_COLORS);
    setHexDraft(DEFAULT_THEME_COLORS);
    preview(DEFAULT_THEME_COLORS);
    setMsg(null);
    setError(null);
  }

  const appFields = THEME_FIELDS.filter((f) => f.group === 'app');
  const sidebarFields = THEME_FIELDS.filter((f) => f.group === 'sidebar');

  return (
    <div>
      <PageHeader
        title="Colors"
        subtitle="Change how the whole app looks. Updates show right away. Click Save to keep them."
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={onReset} disabled={busy}>
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
          <button type="button" className="btn btn-primary btn-sm">
            Primary
          </button>
          <button type="button" className="btn btn-ghost btn-sm">
            Secondary
          </button>
          <button type="button" className="btn btn-danger btn-sm">
            Danger
          </button>
          <button type="button" className="btn btn-danger-solid btn-sm">
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
  const pickerValue = (normalizeHex(hex) ?? '#000000').toLowerCase();
  return (
    <label className="theme-field">
      <span className="theme-field-text">
        <span className="theme-field-label">{label}</span>
        <span className="theme-field-hint">{hint}</span>
      </span>
      <span className="theme-field-controls">
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          type="text"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          maxLength={7}
          aria-label={`${label} hex`}
        />
      </span>
    </label>
  );
}
