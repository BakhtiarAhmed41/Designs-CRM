import { BillingService, buildInvoicePrintHtml } from './billing.service';
import { DEFAULT_THEME_COLORS } from '../settings/theme';

const invoice = {
  id: 'be619430-abcd', customer_name: 'Qasim 2', customer_email: 'qasim@example.com', customer_phone: null,
  order_ref: 'LVD-1840291', order_name: 'Bahmas', amount_cents: 3500, amount_paid_cents: 3500,
  currency: 'USD', status: 'PAID', kind: 'PER_ORDER', issued_at: new Date('2026-10-11'), paid_at: new Date('2026-10-11'),
} as any;
const groups = [{ orderRef: 'LVD-1840291', orderName: 'Bahmas', serviceLabel: 'Embroidery Digitizing', amountCents: null,
  items: [{ name: 'Bahmas', size: '3.5 inch', placement: 'Polo', detail: null, amountCents: 1000 },
    { name: 'Bahmas', size: '10 inch', placement: 'Jacket/Fleece', detail: null, amountCents: 1500 },
    { name: 'Line creek', size: '4 inch', placement: 'Cap', detail: null, amountCents: 1000 }] }];

describe('invoice layout and billing data', () => {
  it('shows itemized sizes, placements, payment history and a zero balance for a paid invoice', () => {
    const html = buildInvoicePrintHtml(invoice, [{ type: 'CHARGE', status: 'PAID', amount_cents: 3500, method: 'CARD', paid_at: invoice.paid_at }] as any, 'data:image/png;base64,logo', [], '', groups);
    expect(html).toContain('<th>Design</th>');
    expect(html).toContain('<th>Size</th>');
    expect(html).toContain('<th>Placement</th>');
    expect(html).toContain('3.5 inch');
    expect(html).toContain('Jacket/Fleece');
    expect(html.match(/class="item-name">Bahmas/g)).toHaveLength(1);
    expect(html).toContain('<td>Balance due</td><td class="num">$0.00</td>');
    expect(html).toContain('Payment record');
    expect(html).toContain('data:image/png;base64,logo');
  });

  it('keeps partial payments separate from the invoice total and escapes customer artwork names', () => {
    const html = buildInvoicePrintHtml({ ...invoice, status: 'PARTIAL', amount_paid_cents: 1000 }, [], '', [], '', [{ ...groups[0], items: [{ ...groups[0].items[0], name: '<script>bad</script>' }] }]);
    expect(html).toContain('<td>Total</td><td class="num">$35.00</td>');
    expect(html).toContain('<td>Amount paid</td><td class="num">$10.00</td>');
    expect(html).toContain('<td>Balance due</td><td class="num">$25.00</td>');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html).not.toContain('<script>bad</script>');
  });

  it('uses the configured theme and the application font family', () => {
    const html = buildInvoicePrintHtml(invoice, [], '', [], '', groups, { ...DEFAULT_THEME_COLORS, buttonBg: '#654321', mainText: '#123456' });
    expect(html).toContain('--accent: #654321');
    expect(html).toContain('--ink: #123456');
    expect(html).toContain("font-family: 'Inter', system-ui, -apple-system, sans-serif");
    expect(html).not.toContain('Palatino');
  });

  it('resolves priced size rows to their design and placement without changing line prices', async () => {
    const db = {
      queryOne: jest.fn().mockResolvedValue({ preferences: { designs: [{ name: 'Bahmas', sizes: [{ detail: '3.5 inch', placement: 'Polo' }, { detail: '10 inch', placement: 'Jacket/Fleece' }] }] } }),
      query: jest.fn().mockResolvedValue([{ id: 'one', name: '3.5 inch', note: 'design:Bahmas', price_cents: 1000 }, { id: 'two', name: '10 inch', note: 'design:Bahmas', price_cents: 1500 }]),
    };
    const service = new BillingService(db as any, {} as any, {} as any, {} as any, {} as any);
    const items = await (service as any).checkoutItemsForOrder('order');
    expect(items.map((item: any) => [item.name, item.size, item.placement, item.amountCents])).toEqual([
      ['Bahmas', '3.5 inch', 'Polo', 1000], ['Bahmas', '10 inch', 'Jacket/Fleece', 1500],
    ]);
  });
});
