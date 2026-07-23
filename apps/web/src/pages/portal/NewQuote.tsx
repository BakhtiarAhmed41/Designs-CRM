import { useNavigate } from 'react-router-dom';
import { QuoteBuilderModal } from '@/components/QuoteBuilderModal';

export function PortalNewQuote() {
  const navigate = useNavigate();

  return (
    <QuoteBuilderModal
      open
      onClose={() => navigate(-1)}
      onSubmitted={() => navigate('/portal/quotes')}
    />
  );
}
