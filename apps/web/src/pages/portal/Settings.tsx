import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getMyCustomer,
  portalLookFromPrefs,
  updateMyCustomer,
} from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';
import { ErrorBanner, SuccessBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

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

const SERVICE_CHIPS = [
  { id: 'emb', label: 'Embroidery Digitizing', icon: 'ti-needle-thread' },
  { id: 'dig', label: 'Vector & Print Artwork', icon: 'ti-vector-bezier' },
  { id: 'cnc', label: 'Cutting & Engraving Files', icon: 'ti-router' },
];

/** Same choices as the embroidery / vector / cutting quote forms. */
const EMB_FORMATS = ['DST', 'PES', 'EXP', 'HUS', 'SEW', 'JEF', 'VP3', 'XXX', 'Others'];
const DIG_FORMATS = ['AI', 'EPS', 'SVG', 'PDF', 'CDR', 'PNG', 'JPEG', 'Others'];
const CNC_FORMATS = ['AI', 'SVG', 'DXF', 'CDR', 'EPS', 'PDF', 'PNG', 'Others'];
const PLACEMENTS = ['Hat', 'Cap', 'Visor', 'Jacket/Fleece', 'Polo', 'Bag', 'Other'];

const DEFAULT_PREFS: Prefs = {
  services: ['emb'],
  embFormats: ['DST', 'PES'],
  digFormats: ['AI', 'SVG'],
  cncFormats: ['AI', 'SVG'],
};

function aliasFormat(value: string) {
  const key = value.trim().toUpperCase();
  if (key === 'JPG') return 'JPEG';
  if (key === 'PREVIEW IMAGE' || key === 'PREVIEW') return 'Proof Preview';
  return value.trim();
}

function splitKnownFormats(raw: string[] | undefined, known: string[], fallback: string[]) {
  const source = (raw ?? fallback).map(aliasFormat);
  const knownSet = new Set(known);
  const extras = source.filter((f) => f && !knownSet.has(f) && f.toLowerCase() !== 'others');
  const next = source.filter((f) => knownSet.has(f));
  if (extras.length > 0 && !next.includes('Others')) next.push('Others');
  return { next, extras };
}

function CheckPill({
  label,
  on,
  onToggle,
  add,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  add?: boolean;
}) {
  return (
    <button
      type="button"
      className={`profile-check${on ? ' on' : ''}${add ? ' add' : ''}`}
      aria-pressed={on}
      onClick={onToggle}
    >
      <span className="box" aria-hidden />
      {add && <i className="ti ti-plus" aria-hidden />}
      {label}
    </button>
  );
}

export function PortalSettings() {
  const { data, refetch, isSuccess, isError } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });
  const hydrated = useRef(false);
  const [ready, setReady] = useState(false);
  const [headingColor, setHeadingColor] = useState('#222222');
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [placement, setPlacement] = useState('');
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [embOther, setEmbOther] = useState('');
  const [digOther, setDigOther] = useState('');
  const [cncOther, setCncOther] = useState('');
  const [lookMsg, setLookMsg] = useState<string | null>(null);
  const [lookError, setLookError] = useState<string | null>(null);
  const [lookBusy, setLookBusy] = useState(false);
  const [prefMsg, setPrefMsg] = useState<string | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [prefBusy, setPrefBusy] = useState(false);

  useEffect(() => {
    if (hydrated.current || (!isSuccess && !isError)) return;
    hydrated.current = true;
    setReady(true);
    if (!data) return;
    const look = portalLookFromPrefs(data.customer?.preferences);
    if (look.headingColor) setHeadingColor(look.headingColor);
    if (look.backgroundColor) setBackgroundColor(look.backgroundColor);

    const apiPrefs = data.customer?.preferences as Partial<Prefs> | null | undefined;
    if (apiPrefs && typeof apiPrefs === 'object') {
      const emb = splitKnownFormats(apiPrefs.embFormats, EMB_FORMATS, DEFAULT_PREFS.embFormats);
      const dig = splitKnownFormats(apiPrefs.digFormats, DIG_FORMATS, DEFAULT_PREFS.digFormats);
      const cnc = splitKnownFormats(apiPrefs.cncFormats, CNC_FORMATS, DEFAULT_PREFS.cncFormats);
      setPrefs({
        services: apiPrefs.services ?? DEFAULT_PREFS.services,
        embFormats: emb.next,
        digFormats: dig.next,
        cncFormats: cnc.next,
      });
      setEmbOther(apiPrefs.embOther?.trim() || emb.extras.join(', '));
      setDigOther(apiPrefs.digOther?.trim() || dig.extras.join(', '));
      setCncOther(apiPrefs.cncOther?.trim() || cnc.extras.join(', '));
      if (apiPrefs.placement && PLACEMENTS.includes(apiPrefs.placement)) {
        setPlacement(apiPrefs.placement);
      }
    }
  }, [data, isSuccess, isError]);

  function serverPrefs() {
    return data?.customer?.preferences && typeof data.customer.preferences === 'object'
      ? (data.customer.preferences as Record<string, unknown>)
      : {};
  }

  function extraFormats(selected: string[], raw: string) {
    if (!selected.includes('Others')) return [];
    return raw
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== 'others' && !selected.includes(s));
  }

  function filePrefsPayload() {
    return {
      services: prefs.services,
      embFormats: [...prefs.embFormats, ...extraFormats(prefs.embFormats, embOther)],
      digFormats: [...prefs.digFormats, ...extraFormats(prefs.digFormats, digOther)],
      cncFormats: [...prefs.cncFormats, ...extraFormats(prefs.cncFormats, cncOther)],
      embOther: prefs.embFormats.includes('Others') ? embOther.trim() : '',
      digOther: prefs.digFormats.includes('Others') ? digOther.trim() : '',
      cncOther: prefs.cncFormats.includes('Others') ? cncOther.trim() : '',
      placement,
    };
  }

  async function onSaveLook(e: React.FormEvent) {
    e.preventDefault();
    setLookMsg(null);
    setLookError(null);
    setLookBusy(true);
    try {
      await updateMyCustomer({
        preferences: {
          ...serverPrefs(),
          portalLook: { headingColor, backgroundColor },
        },
      });
      await refetch();
      setLookMsg('Look saved. Headings and background now use your colors.');
    } catch (err) {
      setLookError(getErrorMessage(err));
    } finally {
      setLookBusy(false);
    }
  }

  async function savePrefs() {
    setPrefMsg(null);
    setPrefError(null);
    setPrefBusy(true);
    try {
      await updateMyCustomer({
        preferences: {
          ...serverPrefs(),
          ...filePrefsPayload(),
          portalLook: { headingColor, backgroundColor },
        },
      });
      await refetch();
      setPrefMsg('Preferences saved. We’ll use these on new quotes and file deliveries.');
    } catch (err) {
      setPrefError(getErrorMessage(err));
    } finally {
      setPrefBusy(false);
    }
  }

  function toggleSvc(id: string) {
    setPrefs((p) => ({
      ...p,
      services: p.services.includes(id) ? p.services.filter((s) => s !== id) : [...p.services, id],
    }));
  }

  function toggleList(key: keyof Prefs, value: string) {
    setPrefs((p) => {
      const list = p[key] as string[];
      return {
        ...p,
        [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value],
      };
    });
  }

  return (
    <div className="profile-elegant">
      <PageHeader
        title="Settings"
        subtitle="The services and file formats you usually need, and your portal colors."
      />

      <div className="card card-pad">
        <div className="profile-card-head">
          <h2 className="profile-card-title">Services &amp; file preferences</h2>
          <p className="profile-card-sub">
            Saved once, then used on new quotes and when we prepare your files.
          </p>
        </div>

        {prefMsg && <SuccessBanner>{prefMsg}</SuccessBanner>}
        {prefError && <ErrorBanner>{prefError}</ErrorBanner>}

        <label className="pref-section-label">Services I order</label>
        <div className="profile-svc">
          {SERVICE_CHIPS.map((s) => {
            const on = prefs.services.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`profile-svc-btn${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleSvc(s.id)}
              >
                <span className="box" aria-hidden />
                <i className={`ti ${s.icon} svc-ic`} aria-hidden />
                {s.label}
              </button>
            );
          })}
        </div>

        <div className="profile-block">
          <h3 className="profile-block-title">Embroidery preferences</h3>
          <label className="pref-section-label">Usual placement</label>
          <div className="profile-checks" style={{ marginBottom: 14 }}>
            {PLACEMENTS.map((opt) => (
              <CheckPill
                key={opt}
                label={opt}
                on={placement === opt}
                onToggle={() => setPlacement(placement === opt ? '' : opt)}
              />
            ))}
          </div>
          <label className="pref-section-label">Embroidery file formats</label>
          <div className="profile-checks">
            {EMB_FORMATS.map((f) => (
              <CheckPill
                key={f}
                label={f}
                on={prefs.embFormats.includes(f)}
                onToggle={() => toggleList('embFormats', f)}
              />
            ))}
          </div>
          {prefs.embFormats.includes('Others') && (
            <div className="profile-other">
              <input
                value={embOther}
                onChange={(e) => setEmbOther(e.target.value)}
                placeholder="Other format e.g. EMB, TAP"
                aria-label="Other embroidery formats"
              />
              <p className="profile-hint">You can add more than one. Separate them with a comma. PDF and PNG previews are always included.</p>
            </div>
          )}
        </div>

        <div className="profile-block">
          <h3 className="profile-block-title">Vector &amp; print formats</h3>
          <div className="profile-checks">
            {DIG_FORMATS.map((f) => (
              <CheckPill
                key={f}
                label={f}
                on={prefs.digFormats.includes(f)}
                onToggle={() => toggleList('digFormats', f)}
              />
            ))}
          </div>
          {prefs.digFormats.includes('Others') && (
            <div className="profile-other">
              <input
                value={digOther}
                onChange={(e) => setDigOther(e.target.value)}
                placeholder="Other format"
                aria-label="Other vector formats"
              />
              <p className="profile-hint">You can add more than one. Separate them with a comma.</p>
            </div>
          )}
        </div>

        <div className="profile-block">
          <h3 className="profile-block-title">Cutting &amp; engraving formats</h3>
          <div className="profile-checks">
            {CNC_FORMATS.map((f) => (
              <CheckPill
                key={f}
                label={f}
                on={prefs.cncFormats.includes(f)}
                onToggle={() => toggleList('cncFormats', f)}
              />
            ))}
          </div>
          {prefs.cncFormats.includes('Others') && (
            <div className="profile-other">
              <input
                value={cncOther}
                onChange={(e) => setCncOther(e.target.value)}
                placeholder="Other format"
                aria-label="Other cutting formats"
              />
              <p className="profile-hint">You can add more than one. Separate them with a comma.</p>
            </div>
          )}
        </div>

        <div className="profile-actions">
          <button type="button" className="btn btn-primary" disabled={prefBusy || !ready} onClick={() => void savePrefs()}>
            <i className="ti ti-check" /> {prefBusy ? 'Saving…' : 'Save file preferences'}
          </button>
        </div>
      </div>

      <form
        id="portal-colors"
        className="card card-pad settings-form"
        onSubmit={(e) => void onSaveLook(e)}
        style={{ maxWidth: 480 }}
      >
        <div className="profile-card-head">
          <h2 className="profile-card-title">Portal colors</h2>
          <p className="profile-card-sub">Heading text and page background for your portal.</p>
        </div>
        {lookError && <ErrorBanner>{lookError}</ErrorBanner>}
        {lookMsg && <SuccessBanner>{lookMsg}</SuccessBanner>}
        <div className="ff">
          <label htmlFor="headingColor">Heading text color</label>
          <div className="color-field">
            <input
              id="headingColor"
              type="color"
              value={headingColor}
              onChange={(e) => setHeadingColor(e.target.value)}
            />
            <input
              value={headingColor}
              onChange={(e) => setHeadingColor(e.target.value)}
              aria-label="Heading color hex"
            />
          </div>
        </div>
        <div className="ff">
          <label htmlFor="backgroundColor">Page background</label>
          <div className="color-field">
            <input
              id="backgroundColor"
              type="color"
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
            />
            <input
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              aria-label="Background color hex"
            />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={lookBusy || !ready}>
          {lookBusy ? 'Saving…' : 'Save look'}
        </button>
      </form>
    </div>
  );
}
