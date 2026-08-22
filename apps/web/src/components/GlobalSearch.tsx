import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { globalSearch } from '@/lib/messaging';

/**
 * Admin global search matching prototype `.searchbar` chrome.
 */
export function GlobalSearch({
  placeholder = 'search here',
}: {
  placeholder?: string;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => globalSearch(debounced),
    enabled: debounced.length >= 2,
  });

  const results = data ?? { orders: [], customers: [], conversations: [] };
  const hasResults =
    results.orders.length + results.customers.length + results.conversations.length > 0;

  function go(path: string) {
    setOpen(false);
    setQ('');
    navigate(path);
  }

  return (
    <div className="searchbar" ref={wrapRef} style={{ maxWidth: '100%' }}>
      <i className="ti ti-search si" />
      <input
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          if (q.trim().length >= 2) setDebounced(q.trim());
        }}
      />
      {open && debounced.length >= 2 && (
        <div className="search-drop open">
          {isFetching && !hasResults && (
            <div className="sd-empty">Searching…</div>
          )}
          {!isFetching && !hasResults && (
            <div className="sd-empty">No matches.</div>
          )}

          {results.orders.length > 0 && (
            <div className="sd-group">
              <div className="sd-label">Orders</div>
              {results.orders.map((o) => (
                <div
                  key={o.id}
                  className="sd-item"
                  onClick={() => go(`/admin/orders/${o.id}`)}
                >
                  <div>
                    <div className="sd-t">{o.name || o.ref || 'Order'}</div>
                    <div className="sd-s">
                      #{o.ref ?? o.id.slice(0, 6)} · {o.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.customers.length > 0 && (
            <div className="sd-group">
              <div className="sd-label">Customers</div>
              {results.customers.map((c) => (
                <div
                  key={c.id}
                  className="sd-item"
                  onClick={() => go(`/admin/customers?open=${c.id}`)}
                >
                  <div>
                    <div className="sd-t">{c.name || 'Customer'}</div>
                    <div className="sd-s">{c.email ?? ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.conversations.length > 0 && (
            <div className="sd-group">
              <div className="sd-label">Messages</div>
              {results.conversations.map((c) => (
                <div
                  key={c.id}
                  className="sd-item"
                  onClick={() => go(`/admin/messages/customers/${c.id}`)}
                >
                  <div className="sd-t">{c.subject || 'Conversation'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
