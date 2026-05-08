"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CategorySelect, type MainCategory } from "../../../../components/CategorySelect";
import { PreferencesFields, type Preferences } from "../../../../components/PreferencesFields";
import { ApiError } from "../../../../lib/api";
import { createOrder, uploadOrderAttachments } from "../../../../lib/orders";

export default function NewQuotationRequestPage() {
  const router = useRouter();

  const [mainCategory, setMainCategory] = useState<MainCategory | "">("");
  const [subCategory, setSubCategory] = useState("");
  const [instructions, setInstructions] = useState("");
  const [size, setSize] = useState("");
  const [preferences, setPreferences] = useState<Preferences>({});
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preferencesPayload = useMemo(() => {
    const out: Record<string, unknown> = {};
    if (preferences.style) out.style = preferences.style;
    if (preferences.outputFormat) out.outputFormat = preferences.outputFormat;
    if (preferences.colors?.length) out.colors = preferences.colors;
    if (preferences.notes) out.notes = preferences.notes;
    return Object.keys(out).length ? out : undefined;
  }, [preferences]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="crm-page-title">Request quotation</h1>
        <p className="crm-page-desc">Choose a category, then provide details and attachments.</p>
      </div>

      <div className="crm-surface space-y-6 p-6 sm:p-7">
        <CategorySelect
          mainCategory={mainCategory}
          subCategory={subCategory}
          disabled={saving}
          onChange={(next) => {
            setMainCategory(next.mainCategory);
            setSubCategory(next.subCategory);
          }}
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label className="crm-label" htmlFor="size">
              Size / format (optional)
            </label>
            <input
              id="size"
              className="crm-field"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 1080×1080, A4, SVG"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="crm-label" htmlFor="files">
              Attachments
            </label>
            <input
              id="files"
              className="crm-field cursor-pointer py-2 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-200"
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <div className="mt-1.5 text-xs text-zinc-500">
              {files.length ? `${files.length} file(s) selected` : "No files selected"}
            </div>
          </div>
        </div>

        <div>
          <label className="crm-label" htmlFor="instructions">
            Instructions (optional)
          </label>
          <textarea
            id="instructions"
            className="crm-field min-h-28 resize-y"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Describe what you need and any constraints."
          />
        </div>

        <PreferencesFields value={preferences} onChange={setPreferences} disabled={saving} />

        {error ? <div className="crm-alert-error">{error}</div> : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="crm-btn-primary"
            disabled={saving || !mainCategory || !subCategory}
            onClick={async () => {
              setError(null);
              setSaving(true);
              try {
                const serviceType = subCategory || `${mainCategory}`.trim();
                const created = await createOrder({
                  type: "QUOTATION_REQUEST",
                  mainCategory: mainCategory || null,
                  subCategory: subCategory || null,
                  serviceType: serviceType.trim(),
                  instructions: instructions.trim() ? instructions.trim() : null,
                  size: size.trim() ? size.trim() : null,
                  preferences: preferencesPayload,
                });
                if (files.length) {
                  await uploadOrderAttachments(created.order.id, files);
                }
                router.replace(`/orders/${created.order.id}`);
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Failed to request quotation");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Submitting…" : "Request quotation"}
          </button>
          <button type="button" className="crm-btn-secondary" disabled={saving} onClick={() => router.back()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

