import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getMyCustomer,
  portalLookFromPrefs,
  updateMyCustomer,
} from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';
import { ErrorBanner, SuccessBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

export function PortalSettings() {
  const { data, refetch } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });
  const [headingColor, setHeadingColor] = useState('#222222');
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const look = portalLookFromPrefs(data?.customer?.preferences);
    if (look.headingColor) setHeadingColor(look.headingColor);
    if (look.backgroundColor) setBackgroundColor(look.backgroundColor);
  }, [data]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setBusy(true);
    const existing =
      data?.customer?.preferences && typeof data.customer.preferences === 'object'
        ? (data.customer.preferences as Record<string, unknown>)
        : {};
    try {
      await updateMyCustomer({
        preferences: {
          ...existing,
          portalLook: { headingColor, backgroundColor },
        },
      });
      await refetch();
      setMsg('Look saved. Headings and background now use your colors.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Change heading text color and page background for your portal."
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {msg && <SuccessBanner>{msg}</SuccessBanner>}
      <form className="card card-pad" onSubmit={(e) => void onSave(e)} style={{ maxWidth: 480 }}>
        <div className="ff">
          <label htmlFor="headingColor">Heading text color</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save look'}
        </button>
      </form>
    </div>
  );
}
