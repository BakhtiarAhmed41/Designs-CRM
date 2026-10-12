import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTopbarLead } from "@/components/Shell";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { PaginationBar } from "@/components/lists/ListToolbar";
import { listMyFiles, type Design, type MyFile } from "@/lib/designs";
import { listMyEdits, type EditRequest } from "@/lib/edits";
import { freshOnOpen, whenVisible } from "@/lib/queryRefresh";
import {
  myDeliveryFilePreviewUrl,
  myDeliveryFileUrl,
  getMyOrder,
} from "@/lib/orders";
import {
  apiFetch,
  downloadSignedFile,
  getErrorMessage,
  resolveFileUrl,
} from "@/lib/api";
import {
  dateShort,
  isImageFile,
  mergeDeliveredVia,
  money,
  orderNumber,
} from "@/lib/format";
import { openLinkedChat } from "@/lib/messaging";
import { serviceWorkLabel } from "@/lib/serviceIcon";
import type { Order } from "@/lib/types";
import {
  buildSections,
  groupFileEntries,
  downloadableFiles,
  isPreviewFile,
  portalFiles,
  revisionsForScope,
  type FileEntry,
  type DesignSection,
} from "@/lib/fileGroups";
import "@/styles/my-files.css";

type FilesOrder = Order & { designs?: Design[] };

const EMPTY_FILES: MyFile[] = [];

function fileCount(files: MyFile[]) {
  const listed = downloadableFiles(files);
  if (listed.length) return listed.length;
  return files.filter((file) => file.emailNotice).length;
}

function countLabel(count: number) {
  return `${count} file${count === 1 ? "" : "s"}`;
}

function fileSizeLabel(bytes?: number | null) {
  if (bytes == null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isZipFile(file: MyFile) {
  if (file.isBundle) return true;
  const name = file.originalName.toLowerCase();
  return (
    name.endsWith(".zip") ||
    file.mimeType === "application/zip" ||
    file.mimeType === "application/x-zip-compressed"
  );
}

function splitBundle(files: MyFile[]) {
  const real = portalFiles(files);
  const preview = real.filter(isPreviewFile);
  const previewIds = new Set(preview.map((file) => file.fileId));
  const zip = real.filter(
    (file) =>
      isZipFile(file) &&
      file.kind !== "PREVIEW" &&
      !previewIds.has(file.fileId),
  );
  const zipIds = new Set(zip.map((file) => file.fileId));
  const other = real.filter(
    (file) => !previewIds.has(file.fileId) && !zipIds.has(file.fileId),
  );
  return { preview, zip, other };
}

function batchEmailed(files: MyFile[]) {
  return files.some(
    (file) =>
      file.emailNotice || file.batchVia === "EMAIL" || file.batchVia === "BOTH",
  );
}

function entryKey(
  orderId: string,
  designId: string | null,
  designName: string,
) {
  if (designId) return `${orderId}:d:${designId}`;
  const name = designName.trim().toLowerCase();
  if (name && name !== "files") return `${orderId}:n:${name}`;
  return `${orderId}:all`;
}

function pickThumb(files: MyFile[]) {
  const preview = files.find((file) => file.previewUrl && isPreviewFile(file));
  if (preview?.previewUrl) return preview.previewUrl;
  const any = files.find((file) => file.previewUrl);
  return any?.previewUrl ?? null;
}

function fileExt(name: string) {
  const part = name.split(".").pop()?.trim().toLowerCase() ?? "";
  return /^[a-z0-9]{1,8}$/.test(part) ? part : "";
}

function fileTypeMeta(file: MyFile) {
  const label = (file.formatLabel ?? fileExt(file.originalName)).toUpperCase();
  const ext = fileExt(file.originalName);
  if (isZipFile(file))
    return { label: label || "ZIP", icon: "ti-file-zip", tone: "zip" as const };
  if (ext === "pdf" || file.mimeType === "application/pdf") {
    return {
      label: label || "PDF",
      icon: "ti-file-type-pdf",
      tone: "pdf" as const,
    };
  }
  if (ext === "svg" || file.mimeType === "image/svg+xml") {
    return { label: label || "SVG", icon: "ti-vector", tone: "svg" as const };
  }
  if (isImageFile(file.originalName, file.mimeType)) {
    return { label: label || "IMG", icon: "ti-photo", tone: "img" as const };
  }
  return { label: label || "FILE", icon: "ti-file", tone: "file" as const };
}

function PreviewModal({
  files,
  index,
  label,
  busy,
  onClose,
  onDownload,
}: {
  files: MyFile[];
  index: number;
  label: string;
  busy: boolean;
  onClose: () => void;
  onDownload: (file: MyFile) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(index);
  const file = files[currentIndex];
  const [src, setSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let active = true;
    setZoom(1);
    setSrc(file?.previewUrl ? resolveFileUrl(file.previewUrl) : null);
    if (file)
      void apiFetch<{ url: string }>(
        myDeliveryFilePreviewUrl(file.orderId, file.fileId),
      )
        .then(({ url }) => {
          if (active) setSrc(resolveFileUrl(url));
        })
        .catch(() => {
          /* Keep the supplied preview URL when refreshing is unavailable. */
        });
    return () => {
      active = false;
    };
  }, [file?.fileId, file?.orderId, file?.previewUrl]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!file) return null;

  return createPortal(
    <div className="mf-ov" onClick={onClose} role="presentation">
      <div
        className="mf-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${currentIndex + 1} of ${files.length}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mf-mh">
          <h2>
            Preview {currentIndex + 1} of {files.length}
          </h2>
          <button
            type="button"
            className="mf-x"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="mf-zoom-controls" aria-label="Preview zoom controls">
          {files.length > 1 && (
            <button
              type="button"
              className="mf-dl-outline"
              aria-label="Previous preview"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((value) => value - 1)}
            >
              <i className="ti ti-chevron-left" aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="mf-dl-outline"
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
          >
            −
          </button>
          <span aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="mf-dl-outline"
            aria-label="Zoom in"
            disabled={zoom >= 4 || !src}
            onClick={() => setZoom((value) => Math.min(4, value + 0.5))}
          >
            +
          </button>
          <button
            type="button"
            className="mf-dl-outline"
            onClick={() => setZoom(1)}
          >
            Fit preview
          </button>
          {files.length > 1 && (
            <button
              type="button"
              className="mf-dl-outline"
              aria-label="Next preview"
              disabled={currentIndex === files.length - 1}
              onClick={() => setCurrentIndex((value) => value + 1)}
            >
              <i className="ti ti-chevron-right" aria-hidden />
            </button>
          )}
        </div>
        <div className="mf-zoom-stage">
          {src ? (
            <img
              src={src}
              alt={`Preview ${currentIndex + 1}`}
              style={{
                width: `${zoom * 100}%`,
                height: `calc(min(60vh, 560px) * ${zoom})`,
                objectPosition: "left top",
              }}
              onError={() => setSrc(null)}
            />
          ) : (
            <div className="mf-none">
              Preview unavailable. Download the preview file to inspect it.
            </div>
          )}
        </div>
        <div className="mf-modal-sub">{label}</div>
        <div className="mf-modal-foot">
          <button
            type="button"
            className="mf-dl"
            disabled={busy}
            onClick={() => onDownload(file)}
          >
            <i className="ti ti-download" aria-hidden /> Download preview
          </button>
          <button type="button" className="mf-dl-outline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RevisionFileRows({
  files,
  emailed,
  label,
  rowKey,
  empty,
  busyKey,
  onDownload,
  onPreview,
}: {
  files: MyFile[];
  emailed: boolean;
  label: string;
  rowKey: string;
  empty: string;
  busyKey: string | null;
  onDownload: (key: string, files: MyFile[]) => void;
  onPreview: (files: MyFile[], index: number, label: string) => void;
}) {
  const parts = splitBundle(files);
  const loose = parts.zip.some((file) => file.isBundle) ? [] : parts.other;
  if (
    parts.preview.length + parts.zip.length + loose.length === 0 &&
    !emailed
  ) {
    return <div className="mf-none mf-revision-empty">{empty}</div>;
  }

  const zipLabel =
    parts.zip.length === 1 ? fileSizeLabel(parts.zip[0].byteSize) : "";

  return (
    <>
      {parts.preview.length > 0 && (
        <div className="mf-fr">
          <span className="mf-ft preview">
            <i className="ti ti-photo" aria-hidden />
          </span>
          <div className="mf-fm">
            <b>Preview images</b>
            <span>{countLabel(parts.preview.length)}</span>
            <div className="mf-thumbs">
              {parts.preview.map((file, index) => {
                const src = file.previewUrl
                  ? resolveFileUrl(file.previewUrl)
                  : null;
                return (
                  <button
                    key={file.fileId}
                    type="button"
                    className="mf-thumb"
                    aria-label={`View preview ${index + 1}`}
                    onClick={() => onPreview(parts.preview, index, label)}
                  >
                    {src ? (
                      <img src={src} alt={`Preview ${index + 1}`} />
                    ) : (
                      <i className="ti ti-photo" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            className="mf-dl"
            disabled={busyKey != null}
            onClick={() => onDownload(`${rowKey}:preview`, parts.preview)}
          >
            <i className="ti ti-download" aria-hidden /> Download
          </button>
        </div>
      )}
      {parts.zip.length > 0 && (
        <div className="mf-fr">
          <span className="mf-ft zip">
            <i className="ti ti-package" aria-hidden />
          </span>
          <div className="mf-fm">
            <b>ZIP file</b>
            <span>
              {zipLabel
                ? `${countLabel(parts.zip.length)} · ${zipLabel}`
                : countLabel(parts.zip.length)}
            </span>
          </div>
          <button
            type="button"
            className="mf-dl"
            disabled={busyKey != null}
            onClick={() => onDownload(`${rowKey}:zip`, parts.zip)}
          >
            <i className="ti ti-download" aria-hidden /> Download ZIP
          </button>
        </div>
      )}
      {loose.map((file) => {
        const size = fileSizeLabel(file.byteSize);
        return (
          <div key={file.fileId} className="mf-fr">
            <span className="mf-ft file">
              <i className="ti ti-file" aria-hidden />
            </span>
            <div className="mf-fm">
              <b>{file.originalName}</b>
              <span>{size || file.formatLabel || "Design file"}</span>
            </div>
            <button
              type="button"
              className="mf-dl"
              disabled={busyKey != null}
              onClick={() => onDownload(`${rowKey}:${file.fileId}`, [file])}
            >
              <i className="ti ti-download" aria-hidden /> Download
            </button>
          </div>
        );
      })}
      {emailed && (
        <div className="mf-fr">
          <span className="mf-ft email">
            <i className="ti ti-send" aria-hidden />
          </span>
          <div className="mf-fm">
            <b>Sent by email</b>
            <span>Delivered to your email address</span>
          </div>
          <span className="mf-ok">✓ Sent</span>
        </div>
      )}
    </>
  );
}

function DesignDetailCards({
  section,
  busyKey,
  onDownload,
  onPreview,
}: {
  section: DesignSection;
  busyKey: string | null;
  onDownload: (key: string, files: MyFile[]) => void;
  onPreview: (files: MyFile[], index: number, label: string) => void;
}) {
  const files = [
    ...new Map(
      section.boxes
        .flatMap((box) => box.files)
        .map((file) => [file.fileId, file]),
    ).values(),
  ];
  const previews = files.filter(isPreviewFile);
  const downloads = downloadableFiles(files);
  const hero = previews.find((file) => file.previewUrl);
  const heroSrc = hero?.previewUrl ? resolveFileUrl(hero.previewUrl) : null;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [heroSrc]);
  return (
    <section className="mf-design-section">
      <header className="mf-design-section-head">
        <h2>{section.name}</h2>
        {downloads.length > 0 && (
          <button
            type="button"
            className="mf-download-design"
            disabled={busyKey != null}
            onClick={() => onDownload("design:" + section.name, downloads)}
          >
            <i className="ti ti-download" aria-hidden /> Download design
          </button>
        )}
      </header>
      <div className="mf-split">
        <section className="mf-panel mf-preview-panel">
          <h3>Design preview</h3>
          <button
            type="button"
            className="mf-preview-frame"
            disabled={!heroSrc || broken}
            aria-label={"Enlarge preview for " + section.name}
            onClick={() =>
              onPreview(
                previews,
                Math.max(
                  0,
                  previews.findIndex((file) => file.fileId === hero?.fileId),
                ),
                section.name,
              )
            }
          >
            {heroSrc && !broken ? (
              <img
                src={heroSrc}
                alt={section.name + " preview"}
                onError={() => setBroken(true)}
              />
            ) : (
              <div className="mf-preview-empty">
                <i className="ti ti-photo" aria-hidden />
                <span>No preview available</span>
              </div>
            )}
          </button>
          <div className="mf-preview-foot">
            {heroSrc && !broken ? (
              <button
                type="button"
                className="mf-enlarge"
                onClick={() =>
                  onPreview(
                    previews,
                    Math.max(
                      0,
                      previews.findIndex(
                        (file) => file.fileId === hero?.fileId,
                      ),
                    ),
                    section.name,
                  )
                }
              >
                <i className="ti ti-zoom-in" aria-hidden /> Enlarge preview
              </button>
            ) : (
              <span>Preview only</span>
            )}
            {hero && (
              <button
                type="button"
                className="mf-dl-outline"
                disabled={busyKey != null}
                onClick={() => onDownload("preview:" + hero.fileId, [hero])}
              >
                <i className="ti ti-download" aria-hidden /> Download preview
              </button>
            )}
          </div>
        </section>
        <section className="mf-panel mf-files-panel">
          <h3>Your files</h3>
          {section.boxes.map((box) => {
            const production = downloadableFiles(box.files);
            return (
              <section className="mf-size-group" key={box.key}>
                <h4>{box.spec || box.title}</h4>
                <div className="mf-file-list">
                  {production.map((file) => {
                    const meta = fileTypeMeta(file);
                    return (
                      <div className="mf-file-row" key={file.fileId}>
                        <span className={"mf-ftype " + meta.tone}>
                          <i className={"ti " + meta.icon} aria-hidden />
                        </span>
                        <div className="mf-file-meta">
                          <b>{file.originalName}</b>
                          <span>{meta.label}</span>
                        </div>
                        <button
                          type="button"
                          className="mf-dl-outline"
                          aria-label={"Download " + file.originalName}
                          disabled={busyKey != null}
                          onClick={() =>
                            onDownload("file:" + file.fileId, [file])
                          }
                        >
                          <i className="ti ti-download" aria-hidden /> Download
                        </button>
                      </div>
                    );
                  })}
                  {production.length === 0 && (
                    <p className="mf-none">
                      {box.emailed
                        ? "Files sent by email."
                        : "Production files have not been published for this size yet."}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </section>
      </div>
    </section>
  );
}

function OrderFileDetail({
  orderId,
  designId,
  entry,
  listLoading,
  onBack,
  onDownloaded,
  onError,
}: {
  orderId: string;
  designId: string | null;
  entry?: FileEntry;
  listLoading: boolean;
  onBack: () => void;
  onDownloaded: () => void;
  onError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"files" | "revs">("files");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const [light, setLight] = useState<{
    files: MyFile[];
    index: number;
    label: string;
  } | null>(null);

  const orderQ = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => getMyOrder(orderId),
    ...freshOnOpen,
  });
  const editsQ = useQuery({
    queryKey: ["my-order-edits", orderId],
    queryFn: () => listMyEdits(orderId),
    ...freshOnOpen,
  });

  const order = orderQ.data?.order as FilesOrder | undefined;
  const allFiles = entry?.files ?? EMPTY_FILES;
  const focusFiles = useMemo(() => {
    if (!designId) return allFiles;
    return allFiles.filter(
      (file) => file.designId === designId || !file.designId,
    );
  }, [allFiles, designId]);

  const number = orderNumber(
    order?.humanRef ?? entry?.humanRef,
    orderId.slice(0, 6),
  );
  const serviceLabel = serviceWorkLabel(
    order?.serviceType ?? entry?.serviceType,
  );
  const designName =
    (designId
      ? order?.designs?.find((item) => item.id === designId)?.name
      : order?.name
    )?.trim() ||
    entry?.designName?.trim() ||
    focusFiles.find((file) => file.designName?.trim())?.designName?.trim() ||
    order?.name?.trim() ||
    entry?.orderName?.trim() ||
    "Order";

  const lead = useMemo(
    () => (
      <nav className="mf-crumb" aria-label="Breadcrumb">
        <span>{serviceLabel}</span>
        <span aria-hidden>/</span>
        <Link to="/portal/files">My Files</Link>
        <span aria-hidden>/</span>
        <b>{number}</b>
      </nav>
    ),
    [serviceLabel, number],
  );
  useTopbarLead(lead);

  useEffect(() => {
    document.querySelector(".workspace-col .main")?.scrollTo({ top: 0 });
  }, [orderId, designId]);

  useEffect(() => {
    if (!toastOn) return;
    const timer = window.setTimeout(() => setToastOn(false), 2000);
    return () => window.clearTimeout(timer);
  }, [toastOn, toast]);

  const sections = useMemo(() => {
    if ((orderQ.isLoading && !order) || (listLoading && !entry)) return null;
    return buildSections(order, focusFiles, designId);
  }, [orderQ.isLoading, order, listLoading, entry, focusFiles, designId]);

  const edits = useMemo(
    () =>
      revisionsForScope(editsQ.data?.edits ?? [], orderId, designId).sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [editsQ.data?.edits, orderId, designId],
  );
  useEffect(() => {
    if (!editsQ.isLoading && edits.length === 0) setTab("files");
  }, [editsQ.isLoading, edits.length]);
  const displayedFiles =
    tab === "revs"
      ? focusFiles.filter((file) =>
          edits.some((edit) => edit.id === file.editId),
        )
      : focusFiles.filter((file) => !file.editId);
  const emailed = batchEmailed(displayedFiles);
  const pending = edits.some((edit) => edit.status !== "DONE");

  const helpMut = useMutation({
    mutationFn: () =>
      openLinkedChat({
        orderId,
        chatType: "ORDER",
        label: "HELP",
        subject: number ? `Order ${number} Chat` : "Order Chat",
      }),
    onSuccess: (convo) => navigate(`/portal/messages?c=${convo.id}`),
    onError: (err) => onError(getErrorMessage(err)),
  });

  async function downloadFiles(key: string, batch: MyFile[], preview = false) {
    if (!batch.length || busyKey) return;
    setBusyKey(key);
    setToast("Preparing download…");
    setToastOn(true);
    try {
      for (const file of batch) {
        const previewOnly =
          preview || isPreviewFile(file) || file.canDownload === false;
        await downloadSignedFile(
          previewOnly
            ? myDeliveryFilePreviewUrl(file.orderId, file.fileId)
            : myDeliveryFileUrl(file.orderId, file.fileId),
          file.originalName,
          { stayOnPage: true },
        );
      }
      setToast("Download started");
      setToastOn(true);
      onDownloaded();
    } catch (err) {
      setToastOn(false);
      onError(getErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  function revisionFiles(edit: EditRequest) {
    return focusFiles.filter((file) => file.editId === edit.id);
  }

  return (
    <div className="mf-od">
      <button type="button" className="mf-back" onClick={onBack}>
        <i className="ti ti-arrow-left" aria-hidden /> Back to My Files
      </button>

      <div className="mf-od-head">
        <div className="mf-od-title">
          <h1>{designName}</h1>
        </div>
        <button
          type="button"
          className="mf-help"
          disabled={helpMut.isPending}
          onClick={() => helpMut.mutate()}
        >
          <i className="ti ti-message" aria-hidden />
          {helpMut.isPending ? "Opening…" : "Need help?"}
        </button>
      </div>

      {orderQ.isError && (
        <div className="alert-error" style={{ marginTop: 16 }}>
          {entry
            ? "Order details could not be loaded. Delivered files are still listed below."
            : "This order could not be opened."}
        </div>
      )}

      {!editsQ.isLoading && edits.length > 0 && (
        <div className="mf-tabs" role="tablist" aria-label="Order files">
          <button
            type="button"
            className={`mf-tab${tab === "files" ? " on" : ""}`}
            role="tab"
            aria-selected={tab === "files"}
            onClick={() => setTab("files")}
          >
            Order files
          </button>
          <button
            type="button"
            className={`mf-tab${tab === "revs" ? " on" : ""}`}
            role="tab"
            aria-selected={tab === "revs"}
            onClick={() => setTab("revs")}
          >
            Revisions
            <em>{edits.length}</em>
            {pending && (
              <span className="mf-pend" title="Revision in progress" />
            )}
          </button>
        </div>
      )}

      {tab === "revs" && edits.length > 0 ? (
        <div className="mf-grid">
          {edits.map((edit, index) => {
            const charged = edit.kind === "PAID" && (edit.priceCents ?? 0) > 0;
            const paid = edit.invoiceStatus === "PAID";
            const batch = revisionFiles(edit);
            const label = `${designName} revision ${index + 1}`;
            return (
              <section key={edit.id} className="mf-box">
                <div className="mf-bh mf-rh">
                  <div>
                    <b>Revision {index + 1}</b>
                    {edit.note?.trim() && <span>{edit.note}</span>}
                  </div>
                  <div className="mf-act">
                    {charged ? (
                      <>
                        <b className="mf-price">
                          {money(edit.priceCents, edit.currency ?? "USD")}
                        </b>
                        <span
                          className={paid ? "mf-pill paid" : "mf-pill unpaid"}
                        >
                          {paid ? "Paid" : "Unpaid"}
                        </span>
                      </>
                    ) : (
                      <span className="mf-free">Free revision</span>
                    )}
                    <span
                      className={
                        edit.status === "DONE" ? "mf-st done" : "mf-st wait"
                      }
                    >
                      {edit.status === "DONE"
                        ? "✓ Delivered"
                        : "● Revision requested"}
                    </span>
                  </div>
                </div>
                <RevisionFileRows
                  files={batch}
                  emailed={batchEmailed(batch)}
                  label={label}
                  rowKey={edit.id}
                  empty="Files will appear here once this revision is published."
                  busyKey={busyKey}
                  onDownload={(key, batchFiles) =>
                    void downloadFiles(key, batchFiles)
                  }
                  onPreview={(previewFiles, previewIndex, previewLabel) =>
                    setLight({
                      files: previewFiles,
                      index: previewIndex,
                      label: previewLabel,
                    })
                  }
                />
              </section>
            );
          })}
        </div>
      ) : (
        <>
          {(listLoading || orderQ.isLoading) && !sections && (
            <div
              className="mf-split-skel"
              aria-busy="true"
              aria-label="Loading files"
            >
              <div className="mf-box-skel" />
              <div className="mf-box-skel" />
            </div>
          )}
          {sections && sections.length === 0 && !listLoading && (
            <div className="mf-split">
              <section className="mf-panel">
                <div className="mf-none">No order files yet.</div>
              </section>
            </div>
          )}
          {sections?.map((section) => (
            <DesignDetailCards
              key={section.name}
              section={section}
              busyKey={busyKey}
              onDownload={(key, batchFiles) =>
                void downloadFiles(key, batchFiles)
              }
              onPreview={(previewFiles, previewIndex, previewLabel) =>
                setLight({
                  files: previewFiles,
                  index: previewIndex,
                  label: previewLabel,
                })
              }
            />
          ))}
        </>
      )}

      <div className="mf-foot">
        {emailed && (
          <span className="mf-email-status">
            <i className="ti ti-mail-check" aria-hidden /> Files sent by email
          </span>
        )}
        <p>
          Questions about your design? Contact us through{" "}
          <button
            type="button"
            className="mf-inline-link"
            onClick={() => helpMut.mutate()}
          >
            Help Request
          </button>{" "}
          or <Link to="/portal/messages">Messages</Link>.
        </p>
      </div>

      {light && (
        <PreviewModal
          files={light.files}
          index={light.index}
          label={light.label}
          busy={busyKey != null}
          onClose={() => setLight(null)}
          onDownload={(file) => {
            if (file) void downloadFiles(`light:${file.fileId}`, [file], true);
          }}
        />
      )}
      <div className={`mf-toast${toastOn ? " show" : ""}`} role="status">
        {toast}
      </div>
    </div>
  );
}

function DesignThumb({
  src,
  name,
  count = 1,
}: {
  src: string | null;
  name: string;
  count?: number;
}) {
  const [broken, setBroken] = useState(false);
  const resolved = src ? resolveFileUrl(src) : null;
  return (
    <span className="mf-design-thumb-wrap">
      <span className="mf-design-thumb">
        {resolved && !broken ? (
          <img src={resolved} alt="" onError={() => setBroken(true)} />
        ) : (
          <i className="ti ti-photo" aria-hidden title={name} />
        )}
      </span>
      {count > 1 && <span className="mf-thumb-count">+{count - 1}</span>}
    </span>
  );
}

export function PortalFiles() {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusOrder = searchParams.get("order");
  const focusDesign = searchParams.get("design");
  const [q, setQ] = useState("");
  const [service, setService] = useState("all");
  const [sort, setSort] = useState<"latest" | "oldest">("latest");
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const [fileError, setFileError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-files"],
    queryFn: listMyFiles,
    ...freshOnOpen,
    refetchInterval: whenVisible(30_000),
  });

  const entries = useMemo(() => groupFileEntries(data?.files ?? []), [data]);

  const serviceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      const label = serviceWorkLabel(entry.serviceType);
      if (label && label !== "—") map.set(label, label);
    }
    return [
      { value: "all", label: "All services" },
      ...[...map.keys()].sort().map((label) => ({ value: label, label })),
    ];
  }, [entries]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase().replace(/^#/, "");
    let list = entries.filter((entry) => {
      if (service !== "all" && serviceWorkLabel(entry.serviceType) !== service)
        return false;
      if (!term) return true;
      const hay = [
        entry.designName,
        entry.orderName,
        entry.humanRef,
        entry.orderId,
        orderNumber(entry.humanRef, ""),
        serviceWorkLabel(entry.serviceType),
        ...entry.files.map((file) => file.originalName),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
    list = [...list].sort((a, b) => {
      const diff =
        new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime();
      return sort === "latest" ? diff : -diff;
    });
    return list;
  }, [entries, q, service, sort]);
  useEffect(() => setPage(1), [q, service, sort]);
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = visible.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const selected = focusOrder
    ? (entries.find((entry) => {
        if (entry.orderId !== focusOrder) return false;
        if (!focusDesign) return true;
        return (
          entry.designId === focusDesign ||
          entry.key === entryKey(focusOrder, focusDesign, entry.designName)
        );
      }) ?? entries.find((entry) => entry.orderId === focusOrder))
    : undefined;

  const selectedFiles = useMemo(() => {
    if (!focusOrder) return undefined;
    if (selected && focusDesign) return selected;
    const orderFiles = (data?.files ?? []).filter(
      (file) => file.orderId === focusOrder,
    );
    if (!orderFiles.length && !selected) return selected;
    const designName =
      selected?.designName ||
      orderFiles.find((file) => file.designName?.trim())?.designName?.trim() ||
      orderFiles[0]?.orderName?.trim() ||
      "Order";
    return {
      key: entryKey(focusOrder, focusDesign, designName),
      orderId: focusOrder,
      designId: focusDesign,
      designName,
      orderName: selected?.orderName ?? orderFiles[0]?.orderName ?? null,
      humanRef: selected?.humanRef ?? orderFiles[0]?.humanRef ?? null,
      serviceType: selected?.serviceType ?? orderFiles[0]?.serviceType ?? null,
      deliveredAt: selected?.deliveredAt ?? orderFiles[0]?.deliveredAt ?? "",
      deliveredVia: selected?.deliveredVia ?? null,
      files: focusDesign
        ? orderFiles.filter(
            (file) => file.designId === focusDesign || !file.designId,
          )
        : orderFiles,
      thumbUrl: selected?.thumbUrl ?? pickThumb(orderFiles),
    } satisfies FileEntry;
  }, [focusOrder, focusDesign, selected, data?.files]);

  function openEntry(entry: FileEntry) {
    setFileError(null);
    const next: Record<string, string> = { order: entry.orderId };
    setSearchParams(next);
  }

  return (
    <div className="portal-files-page mf">
      {fileError && (
        <div className="alert-error" style={{ marginBottom: 0 }}>
          {fileError}
        </div>
      )}
      {isError && !focusOrder && (
        <div className="alert-error" style={{ marginBottom: 0 }}>
          Could not load your files. Refresh the page to try again.
        </div>
      )}

      {focusOrder ? (
        <OrderFileDetail
          key={`${focusOrder}:${focusDesign ?? ""}`}
          orderId={focusOrder}
          designId={focusDesign}
          entry={selectedFiles}
          listLoading={isLoading}
          onBack={() => {
            setFileError(null);
            setSearchParams({});
          }}
          onDownloaded={() => {
            setFileError(null);
            void qc.invalidateQueries({ queryKey: ["my-files"] });
            void qc.invalidateQueries({ queryKey: ["my-activity"] });
            void qc.invalidateQueries({ queryKey: ["notifications"] });
          }}
          onError={setFileError}
        />
      ) : (
        <>
          <div className="mf-headbar">
            <div>
              <h1>My Files</h1>
              <p className="mf-sub">
                View your design previews and download your files.
              </p>
            </div>
            <label className="mf-search-wrap">
              <i className="ti ti-search" aria-hidden />
              <input
                className="mf-search"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search by design name or order number."
                aria-label="Search by design name or order number"
                type="search"
              />
            </label>
          </div>

          <div className="mf-filters">
            <SelectMenu
              size="compact"
              ariaLabel="Filter by service"
              value={service}
              onChange={setService}
              options={serviceOptions}
            />
            <SelectMenu
              size="compact"
              ariaLabel="Sort files"
              value={sort}
              onChange={(value) => setSort(value as "latest" | "oldest")}
              options={[
                { value: "latest", label: "Latest first" },
                { value: "oldest", label: "Oldest first" },
              ]}
            />
          </div>

          <div className="mf-card">
            {isLoading && (
              <div aria-busy="true" aria-label="Loading files">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="mf-skel-row" />
                ))}
              </div>
            )}
            {!isLoading && (
              <div className="mf-scroll">
                <div className="mf-table">
                  <div className="mf-thead">
                    <span>Design</span>
                    <span>Order no.</span>
                    <span>Service</span>
                    <span>Files</span>
                    <span>Delivered</span>
                    <span>Actions</span>
                  </div>
                  {visible.length === 0 && (
                    <div className="mf-empty">
                      {q.trim() || service !== "all"
                        ? "No files found."
                        : "No delivered files yet. Files appear here once an order is completed."}
                    </div>
                  )}
                  {paged.map((entry) => {
                    const number = orderNumber(
                      entry.humanRef,
                      entry.orderId.slice(0, 6),
                    );
                    const count = fileCount(entry.files);
                    return (
                      <div key={entry.key} className="mf-row">
                        <div className="mf-design-cell">
                          <DesignThumb
                            src={entry.thumbUrl}
                            name={entry.designName}
                            count={entry.designNames?.length}
                          />
                          <b className="mf-pn">{entry.designName}</b>
                        </div>
                        <span className="mf-onum">{number}</span>
                        <span className="mf-service">
                          <span className="mf-service-pill">
                            {serviceWorkLabel(entry.serviceType)}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="mf-files-link"
                          onClick={() => openEntry(entry)}
                        >
                          {countLabel(count)}
                        </button>
                        <span className="mf-mute">
                          {dateShort(entry.deliveredAt)}
                        </span>
                        <div className="mf-actions">
                          <button
                            type="button"
                            className="mf-view"
                            onClick={() => openEntry(entry)}
                          >
                            <i className="ti ti-eye" aria-hidden /> View files
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {!isLoading && (
            <p className="mf-count">
              Showing {visible.length ? (currentPage - 1) * pageSize + 1 : 0}–
              {Math.min(currentPage * pageSize, visible.length)} of{" "}
              {visible.length} delivered order{visible.length === 1 ? "" : "s"}.
            </p>
          )}
          {!isLoading && totalPages > 1 && (
            <PaginationBar
              page={currentPage}
              totalPages={totalPages}
              total={visible.length}
              onPage={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
