import { buildInvoicePrintHtml, BillingService } from './billing.service';
import { DEFAULT_THEME_COLORS } from '../settings/theme';

const invoice = {
  id: 'be619430-example',
  customer_name: 'Qasim 2',
  customer_email: 'qasim@example.com',
  customer_phone: null,
  order_ref: 'LVD-1840291',
  order_name: 'Bahmas',
  currency: 'USD',
  kind: 'PER_ORDER',
  status: 'PAID',
  amount_cents: 3500,
  amount_paid_cents: 3500,
  issued_at: '2026-10-11',
  paid_at: '2026-10-11',
  due_at: null,
} as any;
const groups = [
  {
    orderRef: 'LVD-1840291',
    orderName: 'Bahmas',
    serviceLabel: 'Embroidery Digitizing',
    amountCents: null,
    items: [
      {
        name: 'Bahmas',
        size: '3.5 inch',
        placement: 'Polo',
        detail: null,
        amountCents: 1000,
      },
      {
        name: 'Bahmas',
        size: '10 inch',
        placement: 'Jacket/Fleece',
        detail: null,
        amountCents: 1500,
      },
      {
        name: 'Line creek',
        size: '4 inch',
        placement: 'Cap',
        detail: null,
        amountCents: 1000,
      },
    ],
  },
];

describe('invoice presentation', () => {
  it('prints paid design rows with dimensions and a zero balance', () => {
    const html = buildInvoicePrintHtml(
      invoice,
      [],
      'data:image/png;base64,logo',
      [],
      '',
      groups,
    );
    expect(html).toContain('<th>Design</th>');
    expect(html).toContain('<th>Size</th>');
    expect(html).toContain('<th>Placement</th>');
    expect(html).toContain('3.5 inch');
    expect(html).toContain('Jacket/Fleece');
    expect(html).toContain('<td>Amount paid</td><td class="num">$35.00');
    expect(html).toContain('<td>Balance due</td><td class="num">$0.00');
    expect(html.match(/class="item-name">Bahmas/g)).toHaveLength(1);
  });
  it('shows the billed total and remaining balance separately for partial payments', () => {
    const html = buildInvoicePrintHtml(
      { ...invoice, status: 'PARTIAL', amount_paid_cents: 1000, paid_at: null },
      [],
      '',
      [],
      '',
      groups,
    );
    expect(html).toContain('<td>Total</td><td class="num">$35.00');
    expect(html).toContain('<td>Amount paid</td><td class="num">$10.00');
    expect(html).toContain('<td>Balance due</td><td class="num">$25.00');
  });
  it('uses configured theme colors and escapes customer and design content', () => {
    const html = buildInvoicePrintHtml(
      { ...invoice, customer_name: '<script>alert(1)</script>' },
      [],
      '',
      [],
      '',
      [
        {
          ...groups[0],
          items: [{ ...groups[0].items[0], name: '<img onerror="bad">' }],
        },
      ],
      { ...DEFAULT_THEME_COLORS, buttonBg: '#123456' },
    );
    expect(html).toContain('--accent: #123456');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img onerror=&quot;bad&quot;&gt;');
    expect(html).not.toContain('Palatino');
  });
  it('preserves refund records and does not show a balance on cancelled invoices', () => {
    const html = buildInvoicePrintHtml(
      { ...invoice, status: 'CANCELLED', amount_paid_cents: 0 },
      [
        {
          type: 'REFUND',
          amount_cents: 3500,
          created_at: '2026-10-12',
          method: 'CARD',
          refund_to: 'CARD',
        },
      ] as any,
      '',
      [],
      '',
      groups,
    );
    expect(html).toContain('Refund to Card');
    expect(html).toContain('Payment record');
    expect(html).toContain('<td>Balance due</td><td class="num">$0.00');
  });
  it('resolves design names and placements from approved size lines', async () => {
    const db = {
      queryOne: jest.fn().mockResolvedValue({
        name: 'Order',
        preferences: {
          designs: [
            {
              name: 'Bahmas',
              sizes: [
                { detail: '3.5 inch', placement: 'Polo' },
                { detail: '10 inch', placement: 'Jacket/Fleece' },
              ],
            },
          ],
        },
      }),
      query: jest.fn().mockResolvedValue([
        { id: 'a', name: '3.5 inch', note: 'design:Bahmas', price_cents: 1000 },
        { id: 'b', name: '10 inch', note: 'design:Bahmas', price_cents: 1500 },
      ]),
    };
    const service = new BillingService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const items = await (service as any).checkoutItemsForOrder('order');
    expect(
      items.map((item: any) => [
        item.name,
        item.size,
        item.placement,
        item.amountCents,
      ]),
    ).toEqual([
      ['Bahmas', '3.5 inch', 'Polo', 1000],
      ['Bahmas', '10 inch', 'Jacket/Fleece', 1500],
    ]);
  });
});
