import { BillingService } from './billing.service';

describe('customer checkout destination', () => {
  const invoice = { id: 'invoice-1', customer_id: 'customer-1', order_id: 'order-1', status: 'AWAITING' };

  function setup(row: any = invoice) {
    const db = { queryOne: jest.fn() };
    const service = new BillingService(db as any, {} as any, {} as any, {} as any, {} as any);
    const internal = service as any;
    internal.resolveMyCustomer = jest.fn().mockResolvedValue({ id: 'customer-1' });
    internal.getInvoiceRow = jest.fn().mockResolvedValue(row);
    internal.ensurePendingPayLink = jest.fn().mockResolvedValue({ id: 'payment-1' });
    internal.resolveWebBase = jest.fn().mockReturnValue('https://portal.example');
    return { service, internal, db };
  }

  it('returns an order-linked invoice payment to its order, even when opened from Invoices', async () => {
    const { service, internal } = setup();
    internal.startStripeCheckout = jest.fn().mockResolvedValue({ clientSecret: 'secret' });
    await service.startCheckoutForMyInvoice(undefined, invoice.id, { returnPath: '/portal/invoices' });
    expect(internal.startStripeCheckout).toHaveBeenCalledWith(invoice, { id: 'payment-1' }, {
      web: 'https://portal.example', successPath: '/portal/orders/order-1?paid=1',
    });
  });

  it('keeps standalone invoices on their safe return page', async () => {
    const { service, internal } = setup({ ...invoice, order_id: null });
    internal.startStripeCheckout = jest.fn();
    await service.startCheckoutForMyInvoice(undefined, invoice.id, { returnPath: 'https://outside.example' });
    expect(internal.startStripeCheckout.mock.calls[0][2].successPath).toBe('/portal/invoices?paid=1');
  });

  it('does not expose another customer invoice', async () => {
    const { service, internal } = setup({ ...invoice, customer_id: 'someone-else' });
    await expect(service.startCheckoutForMyInvoice(undefined, invoice.id)).rejects.toThrow('Invoice not found');
    expect(internal.ensurePendingPayLink).not.toHaveBeenCalled();
  });

  it('includes the destination when the invoice is already paid', async () => {
    const { internal } = setup();
    await expect(internal.startStripeCheckout({ ...invoice, status: 'PAID' }, {}, {}))
      .resolves.toEqual({ alreadyPaid: true, orderId: 'order-1' });
  });

  it('includes the destination when an already-paid order is opened directly', async () => {
    const { service, db } = setup();
    db.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...invoice, status: 'PAID' });
    await expect(service.startCheckoutForMyOrder(undefined, 'order-1'))
      .resolves.toEqual({ alreadyPaid: true, orderId: 'order-1' });
  });
});
