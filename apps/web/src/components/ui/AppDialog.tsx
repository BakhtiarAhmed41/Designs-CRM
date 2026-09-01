import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export type AlertOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
};

export type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type DialogApi = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: AlertOptions) => Promise<void>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
};

type DialogState =
  | ({ kind: 'confirm' } & ConfirmOptions)
  | ({ kind: 'alert' } & AlertOptions)
  | ({ kind: 'prompt' } & PromptOptions);

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const resolveRef = useRef<((value: unknown) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descId = useId();

  const close = useCallback((value: unknown) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setDialog(null);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current?.(false);
      resolveRef.current = (v) => resolve(Boolean(v));
      setDialog({ kind: 'confirm', ...opts });
    });
  }, []);

  const alert = useCallback((opts: AlertOptions) => {
    return new Promise<void>((resolve) => {
      resolveRef.current?.(false);
      resolveRef.current = () => resolve();
      setDialog({ kind: 'alert', ...opts });
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolveRef.current?.(null);
      resolveRef.current = (v) => resolve(typeof v === 'string' ? v : null);
      setPromptValue(opts.defaultValue ?? '');
      setDialog({ kind: 'prompt', ...opts });
    });
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(dialog.kind === 'alert' ? true : dialog.kind === 'prompt' ? null : false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [dialog, close]);

  useEffect(() => {
    if (dialog?.kind === 'prompt') inputRef.current?.focus();
  }, [dialog]);

  const api = { confirm, alert, prompt };
  const danger = dialog?.kind === 'confirm' && dialog.danger;
  const icon = dialog?.kind === 'alert' ? 'ti-info-circle' : danger ? 'ti-trash' : 'ti-help';

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && (
        <div
          className="app-dialog-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && dialog.kind !== 'alert') {
              close(dialog.kind === 'prompt' ? null : false);
            }
          }}
        >
          <div
            className={`app-dialog${danger ? ' danger' : ''}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={dialog.message ? descId : undefined}
          >
            <div className={`app-dialog-icon${danger ? ' danger' : ''}`}>
              <i className={`ti ${icon}`} />
            </div>
            <div className="app-dialog-copy">
              <h2 id={titleId} className="app-dialog-title">
                {dialog.title}
              </h2>
              {dialog.message && (
                <p id={descId} className="app-dialog-message">
                  {dialog.message}
                </p>
              )}
            </div>
            {dialog.kind === 'prompt' && (
              <input
                ref={inputRef}
                className="app-dialog-input"
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = promptValue.trim();
                    close(v || null);
                  }
                }}
              />
            )}
            <div className="app-dialog-actions">
              {dialog.kind !== 'alert' && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  autoFocus={dialog.kind === 'confirm' && danger}
                  onClick={() => close(dialog.kind === 'prompt' ? null : false)}
                >
                  {dialog.cancelLabel ?? 'Cancel'}
                </button>
              )}
              <button
                type="button"
                className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`}
                autoFocus={dialog.kind === 'alert' || (dialog.kind === 'confirm' && !danger)}
                onClick={() => {
                  if (dialog.kind === 'prompt') {
                    const v = promptValue.trim();
                    close(v || null);
                    return;
                  }
                  close(true);
                }}
              >
                {dialog.confirmLabel ?? 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
