import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePortalAppearancePreview } from '@/context/PortalAppearanceContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import {
  getMyCustomer,
  portalLookFromPrefs,
  updateMyCustomer,
} from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';
import { ErrorBanner, SuccessBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { normalizeHex } from '@/lib/theme';
import '@/styles/portal-account.css';

type Prefs = {
  services: string[];
  embFormats: string[];
  digFormats: string[];
  cncFormats: string[];
  placement?: string;
  embOther?: string;
  digOther?: string;
  cncOther?: string;
};
type FormatKey = 'embFormats' | 'digFormats' | 'cncFormats';
const SERVICES = [
  {
    id: 'emb',
    label: 'Embroidery Digitizing',
    key: 'embFormats' as FormatKey,
    other: 'embOther' as const,
    heading: 'Machine file formats',
    hint: 'Choose the formats your embroidery machine uses.',
    formats: ['DST', 'PES', 'EXP', 'HUS', 'VIP', 'SEW', 'JEF', 'VP3', 'XXX'],
  },
  {
    id: 'dig',
    label: 'Vector & Print Files',
    key: 'digFormats' as FormatKey,
    other: 'digOther' as const,
    heading: 'Artwork file formats',
    hint: 'Choose the formats you use for artwork and print.',
    formats: ['AI', 'EPS', 'SVG', 'PDF', 'CDR', 'PNG', 'JPEG'],
  },
  {
    id: 'cnc',
    label: 'CNC, Laser & 3D Files',
    key: 'cncFormats' as FormatKey,
    other: 'cncOther' as const,
    heading: 'CNC, laser & 3D formats',
    hint: 'Choose the formats your cutting or 3D software uses.',
    formats: ['AI', 'SVG', 'DXF', 'CDR', 'EPS', 'PDF', 'PNG', 'STL', '3MF'],
  },
];
const DEFAULT: Prefs = {
  services: ['emb'],
  embFormats: ['DST', 'PES'],
  digFormats: ['AI', 'SVG'],
  cncFormats: ['AI', 'SVG'],
  placement: '',
  embOther: '',
  digOther: '',
  cncOther: '',
};
const BACKGROUNDS = [
  { name: 'White', value: '#FFFFFF' },
  { name: 'Cream', value: '#F8F6F1' },
  { name: 'Sand', value: '#F3EDE4' },
  { name: 'Stone', value: '#ECEDEF' },
  { name: 'Sage', value: '#EAF4EF' },
  { name: 'Blush', value: '#FAEEF2' },
  { name: 'Peach', value: '#FFF3E8' },
  { name: 'Charcoal', value: '#292929' },
];
function readPrefs(raw: unknown): Prefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT };
  const p = raw as Partial<Prefs>;
  const next: Prefs = {
    ...DEFAULT,
    services: Array.isArray(p.services)
      ? p.services.filter((id) => typeof id === 'string')
      : DEFAULT.services,
    placement: typeof p.placement === 'string' ? p.placement : '',
  };
  for (const service of SERVICES) {
    const values = (
      Array.isArray(p[service.key]) ? p[service.key]! : DEFAULT[service.key]
    )
      .filter((value) => typeof value === 'string')
      .map((value) => (value.trim().toUpperCase() === 'JPG' ? 'JPEG' : value.trim().toUpperCase()));
    next[service.key] = values.filter((value) =>
      service.formats.includes(value),
    );
    next[service.other] =
      p[service.other]?.trim() ||
      values
        .filter(
          (value) =>
            !service.formats.includes(value) &&
            value.toLowerCase() !== 'others',
        )
        .join(', ');
  }
  return next;
}
export function PortalSettings() {
  const qc = useQueryClient();
  const previewAppearance = usePortalAppearancePreview();
  const { user } = useAuth();
  const { colors } = useTheme();
  const { data, refetch, isSuccess, isError } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });
  const hydrated = useRef(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  const [headingColor, setHeadingColor] = useState(colors.mainText);
  const [backgroundColor, setBackgroundColor] = useState(colors.pageBg);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (hydrated.current || !isSuccess) return;
    hydrated.current = true;
    setPrefs(readPrefs(data.customer?.preferences));
    const look = portalLookFromPrefs(data.customer?.preferences);
    setHeadingColor(look.headingColor || colors.mainText);
    setBackgroundColor(look.backgroundColor || colors.pageBg);
  }, [data, isSuccess, colors]);
  const ready = isSuccess && Boolean(data.customer);
  useEffect(() => {
    if (!ready) return;
    previewAppearance({
      headingColor: normalizeHex(headingColor) || colors.mainText,
      backgroundColor: normalizeHex(backgroundColor) || colors.pageBg,
    });
  }, [ready, headingColor, backgroundColor, colors.mainText, colors.pageBg, previewAppearance]);
  useEffect(() => () => previewAppearance(null), [previewAppearance]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const heading = normalizeHex(headingColor),
      background = normalizeHex(backgroundColor);
    if (!heading || !background) {
      setError('Enter valid colors for the heading and background.');
      return;
    }
    setBusy(true);
    try {
      const latest = (await getMyCustomer()).customer?.preferences;
      const payload = { ...prefs };
      for (const service of SERVICES) {
        const extra = (prefs[service.other] || '')
          .split(/[,;]+/)
          .map((value) => value.trim())
          .filter(Boolean);
        payload[service.key] = [...new Set([...prefs[service.key], ...extra])];
      }
      const saved = await updateMyCustomer({
        preferences: {
          ...(latest && typeof latest === 'object' ? latest : {}),
          ...payload,
          portalLook: { headingColor: heading, backgroundColor: background },
        },
      });
      qc.setQueryData(['portal-customer-me'], saved);
      await refetch();
      setMessage(
        'Settings saved. Your appearance and preferred file formats are updated.',
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setPrefs({ ...DEFAULT });
    setHeadingColor(colors.mainText);
    setBackgroundColor(colors.pageBg);
    setMessage(null);
    setError(null);
  }
  return (
    <form
      className="profile-elegant portal-account account-settings"
      onSubmit={(event) => void save(event)}
    >
      <PageHeader
        title="Settings"
        subtitle="Choose your usual file formats and personalize your portal."
        crumbs={[{ label: 'Account' }, { label: 'Settings' }]}
      />
      {message && <SuccessBanner>{message}</SuccessBanner>}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {isError && (
        <ErrorBanner>
          We could not load your settings. Refresh and try again.
        </ErrorBanner>
      )}
      <fieldset className="account-fields" disabled={busy || !ready}>
        <section className="card card-pad">
          <div className="profile-card-head">
            <h2 className="profile-card-title">
              Services &amp; file preferences
            </h2>
            <p className="profile-card-sub">
              Select the services you use, then choose your preferred formats.
            </p>
          </div>
          <div className="settings-services">
            {SERVICES.map((service) => (
              <section key={service.id} className="settings-service">
                <div className="settings-service-heading">
                  <label>
                    <input
                      type="checkbox"
                      checked={prefs.services.includes(service.id)}
                      onChange={() =>
                        setPrefs((prev) => ({
                          ...prev,
                          services: prev.services.includes(service.id)
                            ? prev.services.filter((id) => id !== service.id)
                            : [...prev.services, service.id],
                        }))
                      }
                    />
                    <span>{service.label}</span>
                  </label>
                  <span
                    className="settings-help"
                    tabIndex={0}
                    aria-label={service.hint}
                    title={service.hint}
                  >
                    <i className="ti ti-help-circle" aria-hidden />
                  </span>
                </div>
                <p className="pref-section-label">{service.heading}</p>
                <div className="settings-formats">
                  {service.formats.map((format) => (
                    <label key={format} className="settings-format">
                      <input
                        type="checkbox"
                        checked={prefs[service.key].includes(format)}
                        onChange={() =>
                          setPrefs((prev) => ({
                            ...prev,
                            [service.key]: prev[service.key].includes(format)
                              ? prev[service.key].filter(
                                  (value) => value !== format,
                                )
                              : [...prev[service.key], format],
                          }))
                        }
                      />
                      <span>{format}</span>
                    </label>
                  ))}
                </div>
                <div className="pf settings-other">
                  <label htmlFor={'other-' + service.id}>Other format</label>
                  <input
                    id={'other-' + service.id}
                    value={prefs[service.other] || ''}
                    onChange={(event) =>
                      setPrefs((prev) => ({
                        ...prev,
                        [service.other]: event.target.value,
                      }))
                    }
                    placeholder="Enter a format"
                  />
                </div>
              </section>
            ))}
          </div>
          <details className="settings-placement">
            <summary>Usual embroidery placement (optional)</summary>
            <div className="pf">
              <label htmlFor="settings-placement">Placement</label>
              <select
                id="settings-placement"
                value={prefs.placement || ''}
                onChange={(event) =>
                  setPrefs((prev) => ({
                    ...prev,
                    placement: event.target.value,
                  }))
                }
              >
                <option value="">No preference</option>
                {[
                  'Hat',
                  'Cap',
                  'Visor',
                  'Jacket/Fleece',
                  'Polo',
                  'Bag',
                  'Other',
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </div>
          </details>
          <p className="settings-explainer">
            <b>
              Your saved formats are selected automatically when you request a
              quote.
            </b>
            <span className="profile-hint">
              You can still change them for each request. Separate other formats
              with commas.
            </span>
          </p>
        </section>
        <section className="card card-pad settings-appearance">
          <div className="settings-look">
            <div className="profile-card-head">
              <h2 className="profile-card-title">Appearance</h2>
              <p className="profile-card-sub">
                Choose a background that’s comfortable for your eyes.
              </p>
            </div>
            <p className="pref-section-label">Background</p>
            <div className="settings-swatches">
              {BACKGROUNDS.map((color) => (
                <button
                  key={color.name}
                  type="button"
                  className={
                    'settings-swatch' +
                    (backgroundColor.toUpperCase() === color.value
                      ? ' selected'
                      : '')
                  }
                  aria-pressed={backgroundColor.toUpperCase() === color.value}
                  onClick={() => setBackgroundColor(color.value)}
                >
                  <span style={{ backgroundColor: color.value }}>
                    {backgroundColor.toUpperCase() === color.value && (
                      <i className="ti ti-circle-check-filled" aria-hidden />
                    )}
                  </span>
                  {color.name}
                </button>
              ))}
            </div>
            <details className="settings-custom">
              <summary>Custom colors</summary>
              <div className="pf">
                <label htmlFor="settings-heading">Heading text</label>
                <div className="color-field">
                  <input
                    type="color"
                    id="settings-heading"
                    value={normalizeHex(headingColor) || colors.mainText}
                    onChange={(event) => setHeadingColor(event.target.value)}
                  />
                  <input
                    aria-label="Heading color hex"
                    value={headingColor}
                    onChange={(event) => setHeadingColor(event.target.value)}
                  />
                </div>
              </div>
              <div className="pf">
                <label htmlFor="settings-background">Background</label>
                <div className="color-field">
                  <input
                    type="color"
                    id="settings-background"
                    value={normalizeHex(backgroundColor) || colors.pageBg}
                    onChange={(event) => setBackgroundColor(event.target.value)}
                  />
                  <input
                    aria-label="Background color hex"
                    value={backgroundColor}
                    onChange={(event) => setBackgroundColor(event.target.value)}
                  />
                </div>
              </div>
            </details>
            <p className="profile-hint">
              Buttons and status colors stay the same so everything stays easy
              to read.
            </p>
          </div>
          <div className="settings-live">
            <h3 className="profile-block-title">Live preview</h3>
            <div
              className="settings-preview"
              aria-label="Preview of your selected portal appearance"
            >
              <div className="preview-browser" aria-hidden>
                ● ● ●
              </div>
              <div className="preview-portal">
                <aside>
                  <img src="/lvd-logo-mark.png" alt="" />
                  <small>Customer portal</small>
                  {['Dashboard', 'Quotes', 'Orders', 'My Files'].map(
                    (label, index) => (
                      <div key={label} className={index === 0 ? 'active' : ''}>
                        {label}
                      </div>
                    ),
                  )}
                </aside>
                <div
                  className="preview-content"
                  style={{
                    backgroundColor:
                      normalizeHex(backgroundColor) || colors.pageBg,
                  }}
                >
                  <div className="preview-topbar">
                    <i className="ti ti-bell" aria-hidden />
                    <span>{user?.firstName || 'Your account'}</span>
                  </div>
                  <div className="preview-activity">
                    <h4
                      style={{
                        color: normalizeHex(headingColor) || colors.mainText,
                      }}
                    >
                      Recent Activity
                    </h4>
                    {[
                      ['Quote ready', 'Review quote'],
                      ['Files ready', 'Download files'],
                      ['Order started', 'View order'],
                    ].map(([label, action]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <span className="preview-action">{action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <div className="settings-footer">
          <button type="button" className="settings-reset" onClick={reset}>
            Reset to default
          </button>
          <button type="submit" className="btn btn-primary">
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
