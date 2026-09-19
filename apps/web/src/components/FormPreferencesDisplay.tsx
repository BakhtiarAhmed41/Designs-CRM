import type { CSSProperties } from 'react';
import { AttachmentPreview } from '@/components/FilePreview';
import { friendlyFileName, isImageFile, sameFileName } from '@/lib/format';

export type PrefAttachment = {
  name: string;
  mimeType?: string | null;
  previewUrl?: string | null;
  signedUrlPath: string;
};

type FileKind = 'artwork' | 'reference' | 'other';

type LabeledFile = PrefAttachment & { kind: FileKind };

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
  sizes?: Array<{ label?: string; w?: string; h?: string; detail?: string; placement?: string; unit?: string }>;
  fileNames?: string[];
  artworkFileNames?: string[];
  referenceFileNames?: string[];
};

function takeAttachment(leftover: PrefAttachment[], name?: string): PrefAttachment | null {
  if (name) {
    const matchIdx = leftover.findIndex((a) => sameFileName(a.name, name));
    if (matchIdx >= 0) return leftover.splice(matchIdx, 1)[0]!;
  }
  if (name) return { name, signedUrlPath: '', previewUrl: null };
  return leftover.shift() ?? null;
}

function takeNamed(leftover: PrefAttachment[], names: string[]): PrefAttachment[] {
  return names
    .map((name) => takeAttachment(leftover, name))
    .filter((file): file is PrefAttachment => Boolean(file));
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectDesignFiles(d: FormDesign, leftover: PrefAttachment[]): LabeledFile[] {
  const artNames = uniqueNames(d.artworkFileNames ?? []);
  const refNames = uniqueNames(d.referenceFileNames ?? []);
  const artwork = takeNamed(leftover, artNames).map((file) => ({ ...file, kind: 'artwork' as const }));
  const reference = takeNamed(leftover, refNames).map((file) => ({ ...file, kind: 'reference' as const }));
  const claimed = [...artNames, ...refNames];
  const restNames = uniqueNames(d.fileNames ?? []).filter(
    (name) => !claimed.some((claimedName) => sameFileName(claimedName, name)),
  );
  const rest = takeNamed(leftover, restNames).map((file) => ({ ...file, kind: 'other' as const }));
  return [...artwork, ...reference, ...rest];
}

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

function FileTile({
  file,
  kind,
  safe,
}: {
  file: PrefAttachment;
  kind: FileKind;
  safe?: boolean;
}) {
  const label = kind === 'artwork' ? 'Artwork' : kind === 'reference' ? 'Reference' : 'File';
  const canPreview = Boolean(file.signedUrlPath || file.previewUrl || isImageFile(file.name, file.mimeType));
  return (
    <div className={`pref-shot pref-shot-${kind}`}>
      <span className="pref-shot-tag">{label}</span>
      {canPreview ? (
        <AttachmentPreview
          name={file.name}
          mimeType={file.mimeType}
          signedUrlPath={file.signedUrlPath}
          previewUrl={file.previewUrl}
          compact
          safe={safe}
        />
      ) : (
        <span className="pref-file">{friendlyFileName(file.name)}</span>
      )}
      <span className="pref-shot-name" title={file.name}>
        {friendlyFileName(file.name)}
      </span>
    </div>
  );
}

function MediaColumn({
  kind,
  files,
  safe,
  empty,
}: {
  kind: FileKind;
  files: LabeledFile[];
  safe?: boolean;
  empty: string;
}) {
  const title = kind === 'artwork' ? 'Artwork' : kind === 'reference' ? 'Reference' : 'Other files';
  const hint =
    kind === 'artwork'
      ? 'The design to work from'
      : kind === 'reference'
        ? 'Style or result example'
        : 'Uploaded with this request';
  const icon = kind === 'artwork' ? 'ti-palette' : kind === 'reference' ? 'ti-photo' : 'ti-paperclip';
  return (
    <div className={`pref-media-col pref-media-${kind}`}>
      <div className="pref-media-h">
        <i className={`ti ${icon}`} aria-hidden />
        <div>
          <strong>{title}</strong>
          <span>{hint}</span>
        </div>
      </div>
      {files.length > 0 ? (
        <div className="pref-shots">
          {files.map((file, i) => (
            <FileTile key={`${file.name}-${i}`} file={file} kind={kind} safe={safe} />
          ))}
        </div>
      ) : (
        <p className="pref-media-empty">{empty}</p>
      )}
    </div>
  );
}

function FileGallery({
  files,
  leftover,
  safe,
}: {
  files: LabeledFile[];
  leftover?: PrefAttachment[];
  safe?: boolean;
}) {
  const artwork = files.filter((f) => f.kind === 'artwork');
  const reference = files.filter((f) => f.kind === 'reference');
  const other = [
    ...files.filter((f) => f.kind === 'other'),
    ...(leftover ?? []).map((file) => ({ ...file, kind: 'other' as const })),
  ];
  const hasSplit = artwork.length > 0 || reference.length > 0;
  if (!hasSplit && other.length === 0) return null;

  return (
    <div className="pref-media">
      {hasSplit ? (
        <>
          <MediaColumn
            kind="artwork"
            files={artwork}
            safe={safe}
            empty="No artwork uploaded"
          />
          <MediaColumn
            kind="reference"
            files={reference}
            safe={safe}
            empty="No reference uploaded"
          />
        </>
      ) : (
        <MediaColumn kind="other" files={other} safe={safe} empty="No files uploaded" />
      )}
      {hasSplit && other.length > 0 && (
        <MediaColumn kind="other" files={other} safe={safe} empty="" />
      )}
    </div>
  );
}

export function FormPreferencesDisplay({
  preferences,
  title = 'What you sent',
  style,
  wide = false,
  attachments,
  safe,
}: {
  preferences: unknown;
  title?: string;
  style?: CSSProperties;
  wide?: boolean;
  attachments?: PrefAttachment[];
  safe?: boolean;
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
  const designs = (p.designs ?? []).map((d) => ({
    design: d,
    files: collectDesignFiles(d, leftoverAttachments),
  }));

  return (
    <div className={`card pref-card pref-card-v2${wide ? ' pref-wide' : ''}`} style={{ marginTop: 14, ...style }}>
      <div className="pref-head">
        <span className="pref-head-icon" aria-hidden>
          <i className="ti ti-notes" />
        </span>
        <div>
          <h3>{title}</h3>
          <p>Artwork is the file to work from. Reference is an example of the look you want.</p>
        </div>
      </div>

      {hasDesigns && (
        <div className="pref-block pref-designs">
          {designs.map(({ design: d, files }, i) => {
            const extras =
              d.sizes
                ?.map((s) =>
                  [
                    s.label,
                    s.detail,
                    s.placement,
                    s.w || s.h ? `${s.w || ''} × ${s.h || ''}${s.unit ? ` ${s.unit}` : ''}`.trim() : '',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                )
                .filter((v) => v && v !== d.size) ?? [];
            const rows = [
              d.service && { label: 'Service', value: d.service },
              d.placement && { label: 'Placement', value: d.placement },
              d.fabric && { label: 'Fabric', value: d.fabric },
              d.size && { label: 'Size', value: d.size },
              extras.length > 0 && { label: extras.length > 1 ? 'Sizes' : 'Size details', value: extras.join(' · ') },
              d.colors && { label: 'Color mode', value: d.colors },
              d.background && { label: 'Background', value: d.background },
              d.keepProportional && { label: 'Keep proportional', value: 'Yes' },
              d.dpi300 && { label: '300 DPI', value: 'Yes' },
              d.notes && { label: 'Notes', value: d.notes },
            ].filter(Boolean) as Array<{ label: string; value: string }>;
            return (
              <div key={i} className="pref-design">
                <div className="pref-design-h">
                  <span className="pref-design-n">{i + 1}</span>
                  <strong>{d.name?.trim() || `Design ${i + 1}`}</strong>
                </div>
                <FileGallery files={files} safe={safe} />
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
          {leftoverAttachments.length > 0 && (
            <div className="pref-design">
              <div className="pref-design-h">
                <strong>More files</strong>
              </div>
              <FileGallery files={[]} leftover={leftoverAttachments} safe={safe} />
            </div>
          )}
        </div>
      )}

      {!hasDesigns && leftoverAttachments.length > 0 && (
        <div className="pref-block pref-designs">
          <div className="pref-design">
            <FileGallery files={[]} leftover={leftoverAttachments} safe={safe} />
          </div>
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
