import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDialog } from '@/components/ui/AppDialog';
import { getErrorMessage } from '@/lib/api';
import { setOrderPricing } from '@/lib/designs';
import {
  customerDesignTitle,
  designNote,
  designOptionLabel,
  embroideryDesigns,
  parseDesignNote,
} from '@/lib/embroideryQuote';
import { money } from '@/lib/format';
import { applyOrderChange } from '@/lib/queryCache';
import { needsOrderPricing, studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import type { Order } from '@/lib/types';
import '@/styles/embroidery-quote.css';

type PriceRow = { key: string; description: string; price: string };
type DesignBlock = { key: string; designKey: string; rows: PriceRow[] };

function newKey() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyRow(): PriceRow {
  return { key: newKey(), description: '', price: '' };
}

function blocksFromQuote(quote: QuoteWithLines | undefined, options: string[]): DesignBlock[] {
  const lines = quote?.lines ?? [];
  if (lines.length === 0) {
    const keys = options.length ? options : [''];
    return keys.map((designKey) => ({ key: newKey(), designKey, rows: [emptyRow()] }));
  }
  const blocks: DesignBlock[] = [];
  for (const line of lines) {
    const stored = parseDesignNote(line.note);
    const designKey = stored ? customerDesignTitle(stored) : (options[0] ?? '');
    let block = blocks.find((b) => b.designKey === designKey);
    if (!block) {
      block = { key: newKey(), designKey, rows: [] };
      blocks.push(block);
    }
    block.rows.push({
      key: line.id,
      description: line.name,
      price: line.priceCents != null ? (line.priceCents / 100).toFixed(2) : '',
    });
  }
  return blocks;
}

/**
 * Price entry for an order the studio created for the customer. There is no
 * accept step: saving records the prices as approved and asks for payment.
 */
export function AdminOrderPricing({ order }: { order: Order }) {
  const qc = useQueryClient();
  const dialog = useDialog();
  const firstTime = needsOrderPricing(order);
  const designs = embroideryDesigns(order.preferences, order.name);
  const options = useMemo(
    () => designs.map((d, i) => designOptionLabel(i, d.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order.id, order.preferences, order.name],
  );
  const quotations = (order.quotations ?? []) as QuoteWithLines[];
  const studio = studioQuotation(quotations);

  const [blocks, setBlocks] = useState<DesignBlock[]>(() => blocksFromQuote(studio, options));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBlocks(blocksFromQuote(studio, options));
    // Refill when a saved price set comes back on this order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio?.id]);

  const totalCents = useMemo(() => {
    let total = 0;
    for (const block of blocks) {
      for (const row of block.rows) {
        const n = parseFloat(row.price);
        if (!Number.isNaN(n)) total += Math.round(n * 100);
      }
    }
    return total;
  }, [blocks]);

  const save = useMutation({
    mutationFn: async () => {
      if (blocks.some((block) => !block.designKey)) {
        throw new Error('Select a design for each price group.');
      }
      const lines = blocks.flatMap((block) =>
        block.rows
          .filter((row) => row.description.trim() || row.price.trim())
          .map((row) => {
            const amount = row.price.trim() ? Number(row.price) : 0;
            if (!Number.isFinite(amount) || amount < 0) {
              throw new Error('Enter a valid price for each item.');
            }
            return {
              name: row.description.trim(),
              note: designNote(block.designKey),
              priceCents: Math.round(amount * 100),
            };
          }),
      );
      if (lines.some((line) => !line.name)) {
        throw new Error('Add a description for each priced item.');
      }
      if (lines.length === 0 || lines.every((line) => !line.priceCents)) {
        throw new Error('Add a description and price before saving.');
      }
      return setOrderPricing(order.id, { lines });
    },
    onSuccess: (res) => {
      setError(null);
      void applyOrderChange(qc, res.order);
      void dialog.alert({
        title: firstTime ? 'Order sent for payment' : 'Prices updated',
        message:
          res.order.status === 'PENDING_PAYMENT'
            ? 'The customer can now see this order and pay for it. Work starts once they pay.'
            : 'This order is on monthly billing, so it went straight into progress.',
        confirmLabel: 'Done',
        tone: 'success',
      });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <section className="ead-card" style={firstTime ? { borderColor: 'var(--navy)' } : undefined}>
      <div className="ead-card-h">
        <span className="ead-ic">
          <i className="ti ti-currency-dollar" />
        </span>
        <h2>{firstTime ? 'Enter order prices' : 'Update order prices'}</h2>
      </div>
      <div className="ead-b">
        {error && (
          <div className="alert-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        <p className="ead-he-sub" style={{ marginTop: 0 }}>
          {firstTime
            ? 'The customer sees this order once you save. They pay before work starts.'
            : 'Changing prices updates the invoice the customer has not paid yet.'}
        </p>
        <div className="ead-kicker">Order Designs</div>
        {blocks.map((block) => (
          <div key={block.key} className="ead-ql">
            <div className="ead-ql-top">
              <span className="ead-ql-t">Select Design</span>
              <button
                type="button"
                className="ead-linkish"
                style={{ visibility: blocks.length > 1 ? 'visible' : 'hidden' }}
                onClick={() => setBlocks((prev) => prev.filter((b) => b.key !== block.key))}
              >
                Remove
              </button>
            </div>
            <select
              className="ead-select"
              aria-label="Select Design"
              value={block.designKey}
              onChange={(e) =>
                setBlocks((prev) =>
                  prev.map((b) => (b.key === block.key ? { ...b, designKey: e.target.value } : b)),
                )
              }
            >
              <option value="">Select Design</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {block.rows.map((row) => (
              <div key={row.key} className="ead-art">
                <div className="ead-ql-top">
                  <span className="ead-ql-t">Artworks</span>
                  <button
                    type="button"
                    className="ead-linkish"
                    style={{ visibility: block.rows.length > 1 ? 'visible' : 'hidden' }}
                    onClick={() =>
                      setBlocks((prev) =>
                        prev.map((b) =>
                          b.key === block.key
                            ? { ...b, rows: b.rows.filter((r) => r.key !== row.key) }
                            : b,
                        ),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
                <input
                  className="ead-field"
                  placeholder="Describe this item"
                  aria-label="Item description"
                  value={row.description}
                  onChange={(e) =>
                    setBlocks((prev) =>
                      prev.map((b) =>
                        b.key === block.key
                          ? {
                              ...b,
                              rows: b.rows.map((r) =>
                                r.key === row.key ? { ...r, description: e.target.value } : r,
                              ),
                            }
                          : b,
                      ),
                    )
                  }
                />
                <input
                  className="ead-field"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Price"
                  aria-label="Price"
                  value={row.price}
                  onChange={(e) =>
                    setBlocks((prev) =>
                      prev.map((b) =>
                        b.key === block.key
                          ? {
                              ...b,
                              rows: b.rows.map((r) =>
                                r.key === row.key ? { ...r, price: e.target.value } : r,
                              ),
                            }
                          : b,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <button
              type="button"
              className="ead-add line"
              onClick={() =>
                setBlocks((prev) =>
                  prev.map((b) =>
                    b.key === block.key ? { ...b, rows: [...b.rows, emptyRow()] } : b,
                  ),
                )
              }
            >
              <i className="ti ti-plus" /> Add Price
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ead-add"
          onClick={() =>
            setBlocks((prev) => [
              ...prev,
              {
                key: newKey(),
                designKey: options[Math.min(prev.length, Math.max(options.length - 1, 0))] ?? '',
                rows: [emptyRow()],
              },
            ])
          }
        >
          <i className="ti ti-plus" /> Add Another Design
        </button>
        <div className="ead-total">
          <span>Total</span>
          <b>{money(totalCents, order.currency)}</b>
        </div>
        <div className="ead-stack">
          <button
            type="button"
            className="ead-btn pri blk"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            <i className="ti ti-credit-card" />
            {save.isPending
              ? 'Saving…'
              : firstTime
                ? 'Save prices & request payment'
                : 'Update prices'}
          </button>
        </div>
      </div>
    </section>
  );
}
