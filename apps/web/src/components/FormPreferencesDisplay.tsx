import type { CSSProperties } from 'react';
import { AttachmentPreview } from '@/components/FilePreview';
import { friendlyFileName } from '@/lib/format';

export type PrefAttachment = {
  name: string;
  mimeType?: string | null;
  previewUrl?: string | null;
  signedUrlPath: string;
};

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

function tidyLabel(label?: string) {
  return (label ?? '')
    .replace(/sizing\s*/i, '')
    .replace(/\s*\(recommended\)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tidyValue(value?: string) {
  return (value ?? '')
    .replace(/^no\s*:\s*/i, '')
    .replace(/^yes\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  wide = false,
  attachments,
}: {
  preferences: unknown;
  title?: string;
  style?: CSSProperties;
  wide?: boolean;
  attachments?: PrefAttachment[];
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

  const skipField =
    /^(how many designs|measurement unit|form mode|turnaround|keep proportional|sizing)\??$/i;
  const extraRows = (p.fields ?? [])
    .map((f) => ({
      label: tidyLabel(f.label),
      value: tidyValue(f.value),
    }))
    .filter((f) => f.value && !skipField.test(f.label));
  const optionRows = [
    p.mode && p.mode !== 'd'
      ? { label: 'Form mode', value: p.mode === 'd' ? 'Detailed request' : 'Quick request' }
      : null,
    p.turnaround
      ? { label: 'Turnaround', value: p.turnaround === 'urgent' ? 'Rush' : 'Standard' }
      : null,
    ...extraRows,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const leftoverAttachments = [...(attachments ?? [])];

  return (
    <div className={`card pref-card${wide ? ' pref-wide' : ''}`} style={{ marginTop: 14, ...style }}>
      {wide ? (
        <div className="pref-head">
          <span className="pref-head-icon" aria-hidden>
            <i className="ti ti-notes" />
          </span>
          <div>
            <h3>{title}</h3>
            <p>Add specific details for each design option, including size, format, and any notes.</p>
          </div>
        </div>
      ) : (
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-notes" /> {title}
          </span>
        </div>
      )}

      {hasDesigns && (
        <div className="pref-block pref-designs">
          {(() => {
            const leftoverAttachments = [...(attachments ?? [])];
            return p.designs!.map((d, i) => {
            const extras =
              d.sizes
                ?.map((s) =>
                  [s.label, s.w && s.h ? `${s.w} × ${s.h}` : s.w || s.h].filter(Boolean).join(' '),
                )
                .filter(Boolean) ?? [];
            const rows = [
              d.service && { label: 'Service', value: d.service },
              d.placement && { label: 'Item', value: d.placement },
              d.fabric && { label: 'Fabric', value: d.fabric },
              d.size && { label: 'Size', value: d.size },
              extras.length > 0 && { label: 'Extra sizes', value: extras.join(' · ') },
              d.colors && { label: 'Color', value: d.colors },
              d.background && { label: 'Background', value: d.background },
              d.notes && { label: 'Notes', value: d.notes },
            ].filter(Boolean) as Array<{ label: string; value: string }>;
            const files = (d.fileNames ?? []).map((name) => {
              const match = leftoverAttachments.find(
                (a) => a.name.toLowerCase() === name.toLowerCase(),
              );
              if (match) {
                leftoverAttachments.splice(leftoverAttachments.indexOf(match), 1);
                return match;
              }
              return { name, signedUrlPath: '' };
            });
            if (!files.some((f) => f.signedUrlPath) && leftoverAttachments.length) {
              files.splice(0, files.length, leftoverAttachments.shift()!);
            }
            return (
              <div key={i} className="pref-design">
                <div className="pref-design-h">
                  <span className="pref-design-n">{i + 1}</span>
                  <strong>{d.name?.trim() || `Design ${i + 1}`}</strong>
                  {wide && <span className="pref-tag">Design option</span>}
                  {!wide && files.length > 0 && (
                    <div className="pref-files">
                      {files.map((file, fi) => (
                        <span key={`${file.name}-${fi}`} className="pref-file">
                          {friendlyFileName(file.name)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {wide && files.length > 0 && (
                  <div className="pref-ref">
                    {files.map((file, fi) =>
                      file.signedUrlPath ? (
                        <AttachmentPreview
                          key={`${file.name}-${fi}`}
                          name={file.name}
                          mimeType={file.mimeType}
                          signedUrlPath={file.signedUrlPath}
                          previewUrl={file.previewUrl}
                          compact
                        />
                      ) : (
                        <span key={`${file.name}-${fi}`} className="pref-file">
                          {friendlyFileName(file.name)}
                        </span>
                      ),
                    )}
                  </div>
                )}
                {rows.length > 0 && (
                  <div className="pref-specs">
                    {rows.map((row) => (
                      <div key={row.label} className="pref-spec">
                        <span>{row.label}</span>
                        <b>{row.value}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(optionRows.length > 0 || hasFormats) && (
        <div className="pref-block">
          <div className="pref-options">
            {optionRows.map((row) => (
              <div key={row.label} className="pref-opt">
                <span>{row.label}</span>
                <b className="pref-chip">{row.value}</b>
              </div>
            ))}
            {hasFormats && (
              <div className="pref-opt">
                <span>Formats</span>
                <div className="pref-chips">
                  {p.formats!.map((f) => (
                    <span key={f} className="pref-chip">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
