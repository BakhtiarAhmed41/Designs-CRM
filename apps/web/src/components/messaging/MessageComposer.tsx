import { useEffect, useRef, useState } from 'react';
import { useDialog } from '@/components/ui/AppDialog';
import { LocalFilePreview } from '@/components/FilePreview';

type Props = {
  disabled?: boolean;
  placeholder?: string;
  onSend: (body: string, files: File[]) => Promise<void> | void;
  onTyping?: (typing: boolean) => void;
  templates?: Array<{ id: string; title: string; body: string }>;
  onCreateTemplate?: (title: string, body: string) => Promise<void> | void;
  onDeleteTemplate?: (id: string) => Promise<void> | void;
};

export function MessageComposer({
  disabled,
  placeholder = 'Type a message…',
  onSend,
  onTyping,
  templates,
  onCreateTemplate,
  onDeleteTemplate,
}: Props) {
  const dialog = useDialog();
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingOn = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;

  function setTyping(next: boolean) {
    if (!onTypingRef.current) return;
    if (typingOn.current === next) return;
    typingOn.current = next;
    onTypingRef.current(next);
  }

  function bumpTyping(hasText: boolean) {
    if (!onTypingRef.current) return;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (!hasText) {
      setTyping(false);
      return;
    }
    setTyping(true);
    stopTimer.current = setTimeout(() => setTyping(false), 1600);
  }

  useEffect(() => {
    return () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (typingOn.current) onTypingRef.current?.(false);
    };
  }, []);

  async function submit() {
    if (disabled || sending) return;
    if (!draft.trim() && files.length === 0) return;
    setSending(true);
    setTyping(false);
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
            <LocalFilePreview
              key={`${f.name}-${f.size}`}
              file={f}
              onRemove={() => setFiles((prev) => prev.filter((x) => x !== f))}
            />
          ))}
        </div>
      )}
      {(templates?.length || onCreateTemplate) && (
        <div className="msg-templates">
          {(templates ?? []).slice(0, 8).map((t) => (
            <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                className="ghost"
                onClick={() => setDraft((d) => (d ? `${d}\n${t.body}` : t.body))}
              >
                {t.title}
              </button>
              {onDeleteTemplate && (
                <button
                  type="button"
                  className="ghost"
                  title="Delete template"
                  onClick={() => void onDeleteTemplate(t.id)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {onCreateTemplate && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void (async () => {
                  const title = await dialog.prompt({
                    title: 'Template title',
                    message: 'Give this saved reply a short name.',
                    confirmLabel: 'Next',
                  });
                  if (!title) return;
                  const body =
                    draft.trim() ||
                    (await dialog.prompt({
                      title: 'Template body',
                      message: 'Write the message to insert later.',
                      confirmLabel: 'Save',
                    })) ||
                    '';
                  if (!body.trim()) return;
                  await onCreateTemplate(title.trim(), body.trim());
                })();
              }}
            >
              Save as template
            </button>
          )}
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
              void dialog.alert({
                title: 'Some files were skipped',
                message: 'Each file can be 25MB at most.',
              });
            }
            if (ok.length) setFiles((prev) => [...prev, ...ok].slice(0, 8));
          }}
        />
        <textarea
          value={draft}
          disabled={disabled || sending}
          placeholder={placeholder}
          rows={2}
          onChange={(e) => {
            setDraft(e.target.value);
            bumpTyping(e.target.value.trim().length > 0);
          }}
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
