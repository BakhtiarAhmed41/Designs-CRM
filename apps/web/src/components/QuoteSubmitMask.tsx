export function QuoteSubmitMask({
  title,
  subtitle = 'Please wait while we process your request.',
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="quote-submit-mask" role="status" aria-live="polite" aria-busy="true">
      <div className="quote-submit-card">
        <div className="quote-submit-spinner" aria-hidden="true" />
        <div className="quote-submit-copy">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <span className="quote-submit-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
