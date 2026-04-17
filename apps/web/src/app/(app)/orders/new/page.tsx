"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError } from "../../../../lib/api";
import { createOrder, uploadOrderAttachments } from "../../../../lib/orders";

export default function NewOrderPage() {
  const router = useRouter();

  const [serviceType, setServiceType] = useState("");
  const [instructions, setInstructions] = useState("");
  const [size, setSize] = useState("");
  const [preferencesText, setPreferencesText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preferences = useMemo(() => {
    if (!preferencesText.trim()) return undefined;
    try {
      return JSON.parse(preferencesText);
    } catch {
      return "__invalid_json__";
    }
  }, [preferencesText]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New order</h1>
        <p className="text-sm text-zinc-600">Provide instructions and upload reference files.</p>
      </div>

      <div className="rounded-lg border bg-white p-5 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-1">
            <label className="text-sm font-medium">Service type</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              placeholder="e.g. Logo design"
            />
          </div>
          <div className="space-y-1 sm:col-span-1">
            <label className="text-sm font-medium">Size / format (optional)</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 1080x1080, A4, SVG"
            />
          </div>
          <div className="space-y-1 sm:col-span-1">
            <label className="text-sm font-medium">Attachments</label>
            <input
              className="w-full text-sm"
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <div className="text-xs text-zinc-500">{files.length ? `${files.length} file(s) selected` : "No files selected"}</div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Instructions (optional)</label>
          <textarea
            className="w-full rounded-md border px-3 py-2 text-sm min-h-28"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Describe what you need and any constraints."
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Preferences JSON (optional)</label>
          <textarea
            className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-24"
            value={preferencesText}
            onChange={(e) => setPreferencesText(e.target.value)}
            placeholder='{"colors":["#111827"],"style":"minimal"}'
          />
          {preferences === "__invalid_json__" ? <div className="text-xs text-red-600">Invalid JSON.</div> : null}
        </div>

        {error ? <div className="text-sm text-red-600">{error}</div> : null}

        <div className="flex items-center gap-3">
          <button
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            disabled={saving || !serviceType.trim() || preferences === "__invalid_json__"}
            onClick={async () => {
              setError(null);
              setSaving(true);
              try {
                const created = await createOrder({
                  serviceType: serviceType.trim(),
                  instructions: instructions.trim() ? instructions.trim() : null,
                  size: size.trim() ? size.trim() : null,
                  preferences: preferences === "__invalid_json__" ? undefined : preferences,
                });
                if (files.length) {
                  await uploadOrderAttachments(created.order.id, files);
                }
                router.replace(`/orders/${created.order.id}`);
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Failed to create order");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Creating…" : "Create order"}
          </button>
          <button
            className="rounded-md border px-3 py-2 text-sm hover:bg-zinc-50"
            disabled={saving}
            onClick={() => router.back()}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

