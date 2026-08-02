import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { updateProfile } from '@/lib/auth';
import { getMyCustomer, updateMyCustomer } from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';

type Prefs = {
  services: string[];
  hoops: string[];
  embFormats: string[];
  digFormats: string[];
  cncFormats: string[];
  placement?: string;
};

const SERVICE_CHIPS = [
  { id: 'emb', label: 'Embroidery' },
  { id: 'dig', label: 'SVG / Vector / Print' },
  { id: 'cnc', label: 'CNC / Laser' },
];

const EMB_FORMATS = ['DST', 'PES', 'EXP', 'XXX', 'PDF', 'PNG', 'JEF'];
const DIG_FORMATS = ['SVG', 'PNG', 'EPS', 'AI', 'PDF', 'JPG'];
const CNC_FORMATS = ['DXF', 'SVG', 'PDF', 'AI'];
const HOOP_OPTIONS = ['4x4', '5x7', '6x10', '7x12', '8x8', '8x12', 'Cap frame 2.5x6'];

const DEFAULT_PREFS: Prefs = {
  services: ['emb'],
  hoops: ['4x4', '5x7'],
  embFormats: ['DST', 'PES'],
  digFormats: ['SVG', 'PNG'],
  cncFormats: ['DXF', 'SVG'],
};

function ChipToggle({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={on ? 'chip c-prog' : 'chip'}
      style={{
        cursor: 'pointer',
        background: on ? undefined : '#f2f4f6',
        color: on ? undefined : 'var(--muted)',
        border: 'none',
      }}
      onClick={onToggle}
    >
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
  const [hoopPick, setHoopPick] = useState(HOOP_OPTIONS[0]);
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
      setPrefs({
        services: apiPrefs.services ?? DEFAULT_PREFS.services,
        hoops: apiPrefs.hoops ?? DEFAULT_PREFS.hoops,
        embFormats: apiPrefs.embFormats ?? DEFAULT_PREFS.embFormats,
        digFormats: apiPrefs.digFormats ?? DEFAULT_PREFS.digFormats,
        cncFormats: apiPrefs.cncFormats ?? DEFAULT_PREFS.cncFormats,
      });
      if (apiPrefs.placement) setPlacement(apiPrefs.placement);
    } else {
      setPrefs(DEFAULT_PREFS);
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
      await refresh();
      await refetchCustomer();
      setMsg('Profile saved.');
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
    const payload: Prefs = { ...prefs, placement };
    try {
      await updateMyCustomer({ preferences: payload });
      setPrefMsg('Preferences saved — applied to new quote requests.');
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
    if (!hoopPick || prefs.hoops.includes(hoopPick)) return;
    setPrefs((p) => ({ ...p, hoops: [...p.hoops, hoopPick] }));
  }

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Profile</h1>
          <div className="sub">
            Your contact details and default settings. Set defaults once and your reorders come
            pre-filled.
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20, padding: 20 }}>
        {msg && (
          <div className="note" style={{ marginBottom: 12 }}>
            <i className="ti ti-check" /> {msg}
          </div>
        )}
        {error && (
          <div className="alert-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        <form onSubmit={(e) => void onSaveProfile(e)}>
          <div className="pform">
            <div className="pf">
              <label>Name / business</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="pf">
              <label>Email</label>
              <input value={email} disabled style={{ color: 'var(--faint)' }} />
            </div>
            <div className="pf">
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="pf">
              <label>Account type</label>
              <input value={accountLabel} disabled style={{ color: 'var(--faint)' }} />
            </div>
            <div className="pf">
              <label>Default placement</label>
              <select value={placement} onChange={(e) => setPlacement(e.target.value)}>
                <option>Left chest</option>
                <option>Cap front</option>
                <option>Full back</option>
              </select>
            </div>
          </div>
          <div className="note">
            <i className="ti ti-lock" />
            Account type and payment terms are set by our team based on your account. Message us if
            you&apos;d like to discuss monthly billing.
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <i className="ti ti-check" /> {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
          <i className="ti ti-settings" style={{ color: 'var(--navy)' }} /> My setup &amp; file
          preferences
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
          Tell us once what you work with — every order and delivery uses this automatically, so you
          never have to repeat it.
        </div>

        {prefMsg && (
          <div className="note" style={{ marginBottom: 12 }}>
            <i className="ti ti-check" /> {prefMsg}
          </div>
        )}

        {prefError && (
          <div className="alert-error" style={{ marginBottom: 12 }}>
            {prefError}
          </div>
        )}

        <label
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--faint)',
            textTransform: 'uppercase',
            letterSpacing: '.4px',
          }}
        >
          What do you order from us?
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 18px' }}>
          {SERVICE_CHIPS.map((s) => (
            <ChipToggle
              key={s.id}
              label={s.label}
              on={prefs.services.includes(s.id)}
              onToggle={() => toggleSvc(s.id)}
            />
          ))}
        </div>

        {prefs.services.includes('emb') && (
          <>
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--faint)',
                textTransform: 'uppercase',
                letterSpacing: '.4px',
              }}
            >
              My hoop sizes
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 10px' }}>
              {prefs.hoops.map((h) => (
                <ChipToggle
                  key={h}
                  label={h}
                  on
                  onToggle={() => toggleList('hoops', h)}
                />
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginBottom: 20,
                flexWrap: 'wrap',
              }}
            >
              <select
                value={hoopPick}
                onChange={(e) => setHoopPick(e.target.value)}
                style={{
                  border: '0.5px solid var(--line)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12.5,
                  fontFamily: 'inherit',
                }}
              >
                {HOOP_OPTIONS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost" style={{ padding: '8px 14px' }} onClick={addHoop}>
                <i className="ti ti-plus" /> Add hoop
              </button>
            </div>

            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--faint)',
                textTransform: 'uppercase',
                letterSpacing: '.4px',
              }}
            >
              Embroidery formats I always need
            </label>
            <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
              Tap to select — every embroidery delivery includes all of these.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {EMB_FORMATS.map((f) => (
                <ChipToggle
                  key={f}
                  label={f}
                  on={prefs.embFormats.includes(f)}
                  onToggle={() => toggleList('embFormats', f)}
                />
              ))}
            </div>
          </>
        )}

        {prefs.services.includes('dig') && (
          <>
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--faint)',
                textTransform: 'uppercase',
                letterSpacing: '.4px',
              }}
            >
              Vector / SVG / print formats I always need
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {DIG_FORMATS.map((f) => (
                <ChipToggle
                  key={f}
                  label={f}
                  on={prefs.digFormats.includes(f)}
                  onToggle={() => toggleList('digFormats', f)}
                />
              ))}
            </div>
          </>
        )}

        {prefs.services.includes('cnc') && (
          <>
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--faint)',
                textTransform: 'uppercase',
                letterSpacing: '.4px',
              }}
            >
              CNC / laser formats I always need
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {CNC_FORMATS.map((f) => (
                <ChipToggle
                  key={f}
                  label={f}
                  on={prefs.cncFormats.includes(f)}
                  onToggle={() => toggleList('cncFormats', f)}
                />
              ))}
            </div>
          </>
        )}

        <button type="button" className="btn btn-primary" disabled={prefBusy} onClick={() => void savePrefs()}>
          <i className="ti ti-check" /> {prefBusy ? 'Saving…' : 'Save my preferences'}
        </button>
      </div>
    </div>
  );
}
