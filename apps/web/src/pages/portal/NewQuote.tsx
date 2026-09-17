import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRequestQuote } from '@/context/RequestQuoteContext';

export function PortalNewQuote() {
  const { openRequestQuote } = useRequestQuote();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const service = params.get('service');

  useEffect(() => {
    openRequestQuote(service);
    navigate('/portal/quotes', { replace: true });
  }, [navigate, openRequestQuote, service]);

  return null;
}
