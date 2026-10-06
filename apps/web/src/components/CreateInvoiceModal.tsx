import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LocalFilePreview } from '@/components/FilePreview';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { getErrorMessage } from '@/lib/api';
import { createInvoice } from '@/lib/billing';
import { listCustomers } from '@/lib/customers';
import { isImageFile } from '@/lib/format';
import { invalidateWorkCaches } from '@/lib/queryCache';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type LockedCustomer = {
  id: string;
  name: string;
  email?: string | null;
};

export function CreateInvoiceModal({
  onClose,
  onCreated,
  lockedCustomer,
}: {
  onClose: () => void;
  onCreated?: () => void;
  lockedCustomer?: LockedCustomer;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [customerId, setCustomerId] = useState(lockedCustomer?.id ?? '');
  const [customerSearch, setCustomerSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [cover, setCover] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const customersQ = useQuery({
    queryKey: ['admin-customers-billing'],
    queryFn: () => listCustomers({ pageSize: 500 }),
    enabled: !lockedCustomer,
  });

  const createMut = useMutation({
    mutationFn: () => {
      const dollars = parseFloat(amount);
      const id = lockedCustomer?.id || customerId;
      if (!id) throw new Error('Select a customer');
      if (!Number.isFinite(dollars) || dollars <= 0) throw new Error('Enter a valid amount');
      return createInvoice({
        customerId: id,
        amountCents: Math.round(dollars * 100),
        coversText: cover.trim() || null,
        image,
      });
    },
    onSuccess: () => {
      void invalidateWorkCaches(qc);
      onCreated?.();
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (!isImageFile(file.name, file.type)) {
      setError('Attach a PNG, JPG, WEBP, or GIF image');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image must be 8MB or smaller');
      return;
    }
    setError(null);
    setImage(file);
  }

  const lockedLabel = lockedCustomer
    ? `${lockedCustomer.name}${lockedCustomer.email ? ` · ${lockedCustomer.email}` : ''}`
    : '';

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Create invoice</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="ff">
            <label>Customer</label>
            {lockedCustomer ? (
              <input readOnly value={lockedLabel} />
            ) : (
              <>
                <input
                  placeholder="Search customers…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                />
                <SelectMenu
                  style={{ marginTop: 8 }}
                  value={customerId}
                  onChange={setCustomerId}
                  options={[
                    { value: '', label: 'Select customer…' },
                    ...(customersQ.data?.customers ?? [])
                      .filter((c) => {
                        const term = customerSearch.trim().toLowerCase();
                        if (!term) return true;
                        return (
                          c.name.toLowerCase().includes(term) ||
                          (c.email ?? '').toLowerCase().includes(term)
                        );
                      })
                      .slice(0, 80)
                      .map((c) => ({
                        value: c.id,
                        label: `${c.name}${c.email ? ` · ${c.email}` : ''}`,
                      })),
                  ]}
                />
              </>
            )}
          </div>
          <div className="ff">
            <label>Amount (USD)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="ff">
            <label>Covers / notes</label>
            <input
              value={cover}
              onChange={(e) => setCover(e.target.value)}
              placeholder="What this invoice is for"
            />
          </div>
          <div className="ff">
            <label>Image</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                pickImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => fileRef.current?.click()}
            >
              <i className="ti ti-photo" /> {image ? 'Change image' : 'Attach image'}
            </button>
            {image && (
              <div className="msg-attach-preview" style={{ marginTop: 8 }}>
                <LocalFilePreview file={image} onRemove={() => setImage(null)} />
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={createMut.isPending}
            onClick={() => createMut.mutate()}
          >
            {createMut.isPending ? 'Creating…' : 'Create invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
