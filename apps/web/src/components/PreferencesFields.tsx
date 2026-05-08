"use client";

import { useMemo } from "react";

export type Preferences = {
  style?: string | null;
  colors?: string[] | null;
  outputFormat?: string | null;
  notes?: string | null;
};

export function PreferencesFields({
  value,
  onChange,
  disabled,
}: {
  value: Preferences;
  onChange: (next: Preferences) => void;
  disabled?: boolean;
}) {
  const colorsText = useMemo(() => (value.colors?.length ? value.colors.join(", ") : ""), [value.colors]);

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-zinc-900">Preferences (optional)</div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div>
          <label className="crm-label" htmlFor="pref-style">
            Style
          </label>
          <select
            id="pref-style"
            className="crm-field"
            disabled={disabled}
            value={value.style ?? ""}
            onChange={(e) => onChange({ ...value, style: e.target.value || null })}
          >
            <option value="">No preference</option>
            <option value="minimal">Minimal</option>
            <option value="modern">Modern</option>
            <option value="bold">Bold</option>
            <option value="vintage">Vintage</option>
            <option value="luxury">Luxury</option>
          </select>
        </div>

        <div>
          <label className="crm-label" htmlFor="pref-output">
            Output format
          </label>
          <input
            id="pref-output"
            className="crm-field"
            disabled={disabled}
            value={value.outputFormat ?? ""}
            onChange={(e) => onChange({ ...value, outputFormat: e.target.value || null })}
            placeholder="e.g. SVG, PNG, PDF, DST"
          />
        </div>

        <div className="sm:col-span-1">
          <label className="crm-label" htmlFor="pref-colors">
            Colors
          </label>
          <input
            id="pref-colors"
            className="crm-field"
            disabled={disabled}
            value={colorsText}
            onChange={(e) => {
              const raw = e.target.value;
              const parts = raw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              onChange({ ...value, colors: parts.length ? parts : null });
            }}
            placeholder="Comma separated (e.g. #111827, #ef4444)"
          />
        </div>
      </div>

      <div>
        <label className="crm-label" htmlFor="pref-notes">
          Extra notes
        </label>
        <textarea
          id="pref-notes"
          className="crm-field min-h-24 resize-y"
          disabled={disabled}
          value={value.notes ?? ""}
          onChange={(e) => onChange({ ...value, notes: e.target.value || null })}
          placeholder="Anything else to keep in mind?"
        />
      </div>
    </div>
  );
}

