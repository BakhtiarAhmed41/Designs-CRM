import type { CSSProperties } from 'react';
import { friendlyFileName } from '@/lib/format';

type FormDesign = {
  name?: string;
  service?: string;
  placement?: string;
  fabric?: string;
  size?: string;
  colors?: string;
  notes?: string;
  background?: string;
  keepProportional?: boolean;
  dpi300?: boolean;
  sizes?: Array<{ label?: string; w?: string; h?: string }>;
  fileNames?: string[];
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

export function hasFormPreferences(preferences: unknown): boolean {
  const p = asPrefs(preferences);
  if (!p) return false;
  return (
    (p.fields?.length ?? 0) > 0 ||
    (p.designs?.length ?? 0) > 0 ||
    (p.formats?.length ?? 0) > 0 ||
    Boolean(p.turnaround) ||
    Boolean(p.mode) ||
    Boolean(p.advanced && Object.keys(p.advanced).length > 0)
  );
}

export function FormPreferencesDisplay({
  preferences,
  title = 'Form submission details',
  style,
}: {
  preferences: unknown;
  title?: string;
  style?: CSSProperties;
}) {
  const p = asPrefs(preferences);
  if (!p) return null;

  const hasFields = (p.fields?.length ?? 0) > 0;
  const hasDesigns = (p.designs?.length ?? 0) > 0;
  const hasFormats = (p.formats?.length ?? 0) > 0;
  const hasAdvanced = p.advanced && Object.keys(p.advanced).length > 0;

  if (!hasFields && !hasDesigns && !hasFormats && !p.turnaround && !p.mode && !hasAdvanced) {
    return null;
  }

  const skipField = /^(how many designs|measurement unit|form mode|turnaround)$/i;
  const visibleFields = (p.fields ?? []).filter(
    (f) => f.value?.trim() && !skipField.test((f.label ?? '').trim()),
  );

  return (
    <div className="card" style={{ marginTop: 14, ...style }}>
      <div className="card-h">
        <span className="ct">
          <i className="ti ti-forms" /> {title}
        </span>
      </div>

      {(p.mode || p.turnaround || hasFormats) && (
        <div style={{ padding: '0 16px 12px' }}>
          {p.mode && p.mode !== 'd' && (
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

      {visibleFields.length > 0 && (
        <div className="pref-block">
          {visibleFields.map((f, i) => (
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
        <div className="pref-block">
          {p.designs!.map((d, i) => {
            const extras =
              d.sizes
                ?.map((s) =>
                  [s.label, s.w && s.h ? `${s.w} × ${s.h}` : s.w || s.h].filter(Boolean).join(' '),
                )
                .filter(Boolean) ?? [];
            const rows = [
              d.service && { label: 'Service', value: d.service },
              d.placement && { label: 'Item', value: d.placement },
              d.size && { label: 'Size', value: d.size },
              extras.length > 0 && { label: 'Extra sizes', value: extras.join(' · ') },
              d.colors && { label: 'Color', value: d.colors },
              d.background && { label: 'Background', value: d.background },
              d.notes && { label: 'Notes', value: d.notes },
            ].filter(Boolean) as Array<{ label: string; value: string }>;
            const files = (d.fileNames ?? []).map((name) => friendlyFileName(name));
            return (
              <div key={i} className="pref-design">
                <div className="pref-design-h">
                  <span className="pref-design-n">{i + 1}</span>
                  <strong>{d.name?.trim() || `Design ${i + 1}`}</strong>
                </div>
                {files.length > 0 && (
                  <div className="pref-files">
                    {files.map((name, fi) => (
                      <span key={`${name}-${fi}`} className="pref-file">
                        <i className="ti ti-photo" /> {name}
                      </span>
                    ))}
                  </div>
                )}
                {rows.map((row) => (
                  <div key={row.label} className="pref-row">
                    <span>{row.label}</span>
                    <b>{row.value}</b>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
