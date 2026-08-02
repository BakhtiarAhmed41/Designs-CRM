import { useRef, useState } from 'react';

type Props = {
  disabled?: boolean;
  placeholder?: string;
  onSend: (body: string, files: File[]) => Promise<void> | void;
  templates?: Array<{ id: string; title: string; body: string }>;
};

export function MessageComposer({
  disabled,
  placeholder = 'Type a message…',
  onSend,
  templates,
}: Props) {
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (disabled || sending) return;
    if (!draft.trim() && files.length === 0) return;
    setSending(true);
    try {
      await onSend(draft, files);
      setDraft('');
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="msg-composer">
      {files.length > 0 && (
        <div className="msg-attach-preview">
          {files.map((f) => (
            <span key={`${f.name}-${f.size}`} className="msg-chip">
              <i className="ti ti-paperclip" /> {f.name}
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {templates && templates.length > 0 && (
        <div className="msg-templates">
          {templates.slice(0, 6).map((t) => (
            <button
              key={t.id}
              type="button"
              className="ghost"
              onClick={() => setDraft((d) => (d ? `${d}\n${t.body}` : t.body))}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}
      <div className="msg-composer-row">
        <button
          type="button"
          className="ghost icon"
          title="Attach files"
          disabled={disabled || sending}
          onClick={() => fileRef.current?.click()}
        >
          <i className="ti ti-paperclip" />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            const max = 25 * 1024 * 1024;
            const ok = list.filter((f) => f.size <= max);
            if (ok.length < list.length) {
              window.alert('Some files were skipped (max 25MB each).');
            }
            if (ok.length) setFiles((prev) => [...prev, ...ok].slice(0, 8));
          }}
        />
        <textarea
          value={draft}
          disabled={disabled || sending}
          placeholder={placeholder}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="button"
          className="primary"
          disabled={disabled || sending || (!draft.trim() && files.length === 0)}
          onClick={() => void submit()}
        >
          <i className="ti ti-send" />
        </button>
      </div>
    </div>
  );
}
