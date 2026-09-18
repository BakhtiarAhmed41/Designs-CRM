import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { updateProfile } from '@/lib/auth';
import { getMyCustomer, updateMyCustomer } from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';
import { ErrorBanner, SuccessBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

type Prefs = {
  services: string[];
  hoops: string[];
  embFormats: string[];
  digFormats: string[];
  cncFormats: string[];
  placement?: string;
  embOther?: string;
};

const SERVICE_CHIPS = [
  { id: 'emb', label: 'Embroidery Digitizing', icon: 'ti-needle-thread' },
  { id: 'dig', label: 'Vector & Print Artwork', icon: 'ti-vector-bezier' },
  { id: 'cnc', label: 'Cutting & Engraving Files', icon: 'ti-router' },
];

const EMB_FORMATS = ['DST', 'PES', 'EXP', 'XXX', 'PDF', 'PNG', 'JEF', 'HUS', 'SEW', 'VP3', 'Others'];
const DIG_FORMATS = ['SVG', 'PNG', 'EPS', 'AI', 'PDF', 'JPG', 'CDR', 'PSD', 'Others'];
const CNC_FORMATS = ['DXF', 'SVG', 'PDF', 'EPS', 'AI', 'Preview image', 'Others'];
const HOOP_OPTIONS = ['4x4', '5x7', '6x10', '7x12', '8x8', '8x12', 'Cap frame 2.5x6'];

const DEFAULT_PREFS: Prefs = {
  services: ['emb'],
  hoops: ['4x4', '5x7'],
  embFormats: ['DST', 'PES'],
  digFormats: ['SVG', 'PNG'],
  cncFormats: ['DXF', 'SVG'],
};

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

export function PortalProfile() {
  const { user, refresh } = useAuth();
  const { data: meCustomer, refetch: refetchCustomer } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [placement, setPlacement] = useState('Left chest');
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [embOther, setEmbOther] = useState('');
  const [addingHoop, setAddingHoop] = useState(false);
  const [hoopCustom, setHoopCustom] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [prefMsg, setPrefMsg] = useState<string | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [prefBusy, setPrefBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountType = meCustomer?.customer?.accountType ?? 'PAY_PER_ORDER';
  const accountLabel =
    accountType === 'NET_MONTHLY'
      ? meCustomer?.customer?.netTerms === 'NET_30'
        ? 'Net-monthly (Net-30)'
        : 'Net-monthly (Net-15)'
      : 'Pay per order';

  useEffect(() => {
    if (!user) return;
    const apiPrefs = meCustomer?.customer?.preferences as Partial<Prefs> | null | undefined;
    if (apiPrefs && typeof apiPrefs === 'object') {
      const knownEmb = new Set(EMB_FORMATS);
      const rawEmb = apiPrefs.embFormats ?? DEFAULT_PREFS.embFormats;
      const customEmb = rawEmb.filter((f) => !knownEmb.has(f));
      const nextEmb = rawEmb.filter((f) => knownEmb.has(f));
      if (customEmb.length > 0 && !nextEmb.includes('Others')) nextEmb.push('Others');
      setPrefs({
        services: apiPrefs.services ?? DEFAULT_PREFS.services,
        hoops: apiPrefs.hoops ?? DEFAULT_PREFS.hoops,
        embFormats: nextEmb,
        digFormats: apiPrefs.digFormats ?? DEFAULT_PREFS.digFormats,
        cncFormats: apiPrefs.cncFormats ?? DEFAULT_PREFS.cncFormats,
      });
      setEmbOther(apiPrefs.embOther?.trim() || customEmb.join(', '));
      if (apiPrefs.placement) setPlacement(apiPrefs.placement);
    } else {
      setPrefs(DEFAULT_PREFS);
      setEmbOther('');
    }
    setName(
      meCustomer?.customer?.name ||
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        '',
    );
    setEmail(user.email ?? meCustomer?.customer?.email ?? '');
    setPhone(user.phone ?? meCustomer?.customer?.phone ?? '');
  }, [user, meCustomer]);

  async function onSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setBusy(true);
    try {
      const parts = name.trim().split(/\s+/);
      await updateProfile({
        firstName: parts[0] || null,
        lastName: parts.slice(1).join(' ') || null,
        phone: phone || null,
      });
      await updateMyCustomer({
        name: name.trim() || undefined,
        phone: phone || null,
      });
      setMsg('Contact details saved.');
      await refresh();
      await refetchCustomer();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePrefs() {
    setPrefMsg(null);
    setPrefError(null);
    setPrefBusy(true);
    const existing =
      meCustomer?.customer?.preferences && typeof meCustomer.customer.preferences === 'object'
        ? (meCustomer.customer.preferences as Record<string, unknown>)
        : {};
    const extras = prefs.embFormats.includes('Others')
      ? embOther
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter((s) => s && s.toLowerCase() !== 'others' && !prefs.embFormats.includes(s))
      : [];
    const payload = {
      ...existing,
      ...prefs,
      embFormats: [...prefs.embFormats, ...extras],
      embOther: prefs.embFormats.includes('Others') ? embOther.trim() : '',
      placement,
    };
    try {
      await updateMyCustomer({ preferences: payload });
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
      services: p.services.includes(id)
        ? p.services.filter((s) => s !== id)
        : [...p.services, id],
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

  function addHoop() {
    const next = hoopCustom.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!next) {
      setAddingHoop(false);
      return;
    }
    const exists = prefs.hoops.some((h) => h.toLowerCase() === next.toLowerCase());
    if (!exists) setPrefs((p) => ({ ...p, hoops: [...p.hoops, next] }));
    setHoopCustom('');
    setAddingHoop(false);
  }

  const customHoops = prefs.hoops.filter(
    (h) => !HOOP_OPTIONS.some((o) => o.toLowerCase() === h.toLowerCase()),
  );

  return (
    <div className="profile-elegant">
      <PageHeader
        title="Profile"
        subtitle="Your contact details and the files you usually need."
      />

      <div className="card card-pad">
        <div className="profile-card-head">
          <h2 className="profile-card-title">Contact details</h2>
          <p className="profile-card-sub">
            Used on quotes, orders, and invoices.
          </p>
        </div>
        {msg && <SuccessBanner>{msg}</SuccessBanner>}
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <form onSubmit={(e) => void onSaveProfile(e)}>
          <div className="pform">
            <div className="pf">
              <label>Name or business</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="pf">
              <label>Email</label>
              <div className="profile-lock-field">
                <i className="ti ti-lock" aria-hidden />
                <input type="email" value={email} disabled />
              </div>
            </div>
            <div className="pf">
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="pf">
              <label>Account type</label>
              <div className="profile-lock-field">
                <i className="ti ti-lock" aria-hidden />
                <input value={accountLabel} disabled />
              </div>
            </div>
          </div>
          <div className="note">
            <i className="ti ti-info-circle" />
            Email, account type, and payment terms are managed by our team. Message us if you need a
            change.
          </div>
          <div className="profile-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <i className="ti ti-check" /> {busy ? 'Saving…' : 'Save contact details'}
            </button>
          </div>
        </form>
      </div>

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
          <label className="pref-section-label">Hoop sizes</label>
          <div className="profile-checks" style={{ marginBottom: 14 }}>
            {HOOP_OPTIONS.map((h) => (
              <CheckPill
                key={h}
                label={h}
                on={prefs.hoops.some((x) => x.toLowerCase() === h.toLowerCase())}
                onToggle={() => toggleList('hoops', h)}
              />
            ))}
            {customHoops.map((h) => (
              <CheckPill
                key={h}
                label={h}
                on
                onToggle={() => toggleList('hoops', h)}
              />
            ))}
            {addingHoop ? (
              <div className="profile-other" style={{ marginTop: 0, maxWidth: 220 }}>
                <input
                  value={hoopCustom}
                  onChange={(e) => setHoopCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addHoop();
                    }
                    if (e.key === 'Escape') {
                      setAddingHoop(false);
                      setHoopCustom('');
                    }
                  }}
                  placeholder="e.g. 10x12"
                  aria-label="Custom hoop size"
                  maxLength={40}
                  autoFocus
                  onBlur={() => addHoop()}
                />
              </div>
            ) : (
              <CheckPill
                label="Add hoop size"
                on={false}
                add
                onToggle={() => setAddingHoop(true)}
              />
            )}
          </div>
          <label className="pref-section-label">Usual placement</label>
          <div className="profile-other" style={{ marginBottom: 14 }}>
            <select value={placement} onChange={(e) => setPlacement(e.target.value)}>
              <option>Left chest</option>
              <option>Cap front</option>
              <option>Full back</option>
            </select>
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
                placeholder="Need another format? e.g. EMB, TAP"
                aria-label="Other embroidery formats"
              />
              <p className="profile-hint">You can add more than one. Separate them with a comma.</p>
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
          {prefs.cncFormats.includes('Preview image') && (
            <p className="profile-hint">A PNG or JPG proof for easy viewing.</p>
          )}
        </div>

        <div className="profile-actions">
          <button type="button" className="btn btn-primary" disabled={prefBusy} onClick={() => void savePrefs()}>
            <i className="ti ti-check" /> {prefBusy ? 'Saving…' : 'Save file preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}
