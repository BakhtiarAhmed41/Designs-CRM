import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { orderSlug } from './format';

/** Replace a UUID in the address bar with the public order number. */
export function useCanonicalOrderUrl(
  scope: 'portal' | 'admin',
  section: 'quotes' | 'orders',
  id: string,
  humanRef?: string | null,
) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const slug = orderSlug(humanRef, id);
    if (!slug || slug === id || id === 'new') return;
    navigate(`${scope === 'portal' ? '/portal' : '/admin'}/${section}/${slug}${location.search}${location.hash}`, {
      replace: true,
    });
  }, [scope, section, id, humanRef, navigate, location.search, location.hash]);
}
