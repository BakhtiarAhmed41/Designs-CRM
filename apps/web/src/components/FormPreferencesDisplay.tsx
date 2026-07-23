type FormDesign = {
  name?: string;
  placement?: string;
  fabric?: string;
  size?: string;
  colors?: string;
  notes?: string;
  sizes?: Array<{ label?: string; w?: string; h?: string }>;
};

type QuoteFormPreferences = {
  mode?: string;
  turnaround?: string | null;
  formats?: string[];
  designs?: FormDesign[];
  fields?: Array<{ label: string; value: string }>;
  advanced?: Record<string, boolean>;
  service?: string;
};

function asPrefs(preferences: unknown): QuoteFormPreferences | null {
  if (!preferences || typeof preferences !== 'object') return null;
  return preferences as QuoteFormPreferences;
}

export function FormPreferencesDisplay({ preferences }: { preferences: unknown }) {
  const p = asPrefs(preferences);
  if (!p) return null;

  const hasFields = (p.fields?.length ?? 0) > 0;
  const hasDesigns = (p.designs?.length ?? 0) > 0;
  const hasFormats = (p.formats?.length ?? 0) > 0;
  const hasAdvanced = p.advanced && Object.keys(p.advanced).length > 0;

  if (!hasFields && !hasDesigns && !hasFormats && !p.turnaround && !p.mode && !hasAdvanced) {
    return null;
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ct">
          <i className="ti ti-forms" /> Form submission details
        </span>
      </div>

      {(p.mode || p.turnaround || hasFormats) && (
        <div style={{ padding: '0 16px 12px' }}>
          {p.mode && (
            <div className="od-line">
              <span className="l">Form mode</span>
              <span className="v">{p.mode === 'd' ? 'Detailed request' : 'Quick request'}</span>
            </div>
          )}
          {p.turnaround && (
            <div className="od-line">
              <span className="l">Turnaround</span>
              <span className="v">{p.turnaround === 'urgent' ? 'Urgent' : 'Standard'}</span>
            </div>
          )}
          {hasFormats && (
            <div className="od-line">
              <span className="l">Formats requested</span>
              <span className="v">
                {p.formats!.map((f) => (
                  <span key={f} className="fmtchip">
                    {f}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

      {hasFields && (
        <div style={{ padding: '0 16px 12px' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--faint)',
              textTransform: 'uppercase',
              letterSpacing: '.4px',
              marginBottom: 8,
            }}
          >
            Form fields
          </div>
          {p.fields!.map((f, i) => (
            <div key={`${f.label}-${i}`} className="od-line">
              <span className="l">{f.label || 'Field'}</span>
              <span className="v" style={{ fontWeight: 400 }}>
                {f.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {hasDesigns && (
        <div style={{ padding: '0 16px 16px' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--faint)',
              textTransform: 'uppercase',
              letterSpacing: '.4px',
              marginBottom: 8,
            }}
          >
            Designs ({p.designs!.length})
          </div>
          {p.designs!.map((d, i) => (
            <div
              key={i}
              style={{
                background: 'var(--bg)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 8,
                fontSize: 12.5,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {d.name?.trim() || `Design ${i + 1}`}
              </div>
              {d.placement && (
                <div>
                  <b>Placement:</b> {d.placement}
                </div>
              )}
              {d.fabric && (
                <div>
                  <b>Fabric:</b> {d.fabric}
                </div>
              )}
              {d.size && (
                <div>
                  <b>Size:</b> {d.size}
                </div>
              )}
              {d.colors && (
                <div>
                  <b>Colors:</b> {d.colors}
                </div>
              )}
              {d.notes && (
                <div>
                  <b>Notes:</b> {d.notes}
                </div>
              )}
              {(d.sizes?.length ?? 0) > 0 && (
                <div style={{ marginTop: 6 }}>
                  <b>Extra sizes:</b>{' '}
                  {d.sizes!
                    .map((s) =>
                      [s.label, s.w && s.h ? `${s.w}×${s.h}"` : s.w || s.h]
                        .filter(Boolean)
                        .join(' '),
                    )
                    .join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
