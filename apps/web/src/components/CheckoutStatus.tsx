import { Link } from 'react-router-dom';
import '@/styles/checkout.css';

export function CheckoutStatus({
  title,
  message,
  backHref,
  backLabel = 'Back',
}: {
  title: string;
  message: string;
  backHref?: string | null;
  backLabel?: string;
}) {
  return (
    <div className="cko-status">
      <div className="cko-status-card">
        <img src="/lvd-logo-full.png" alt="Las Vegas Designs USA" />
        <h1>{title}</h1>
        <p>{message}</p>
        {backHref && <Link to={backHref}>{backLabel}</Link>}
      </div>
    </div>
  );
}
