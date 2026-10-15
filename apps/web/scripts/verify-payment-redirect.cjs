const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/import\.meta\.env/g, '({})');
  vm.runInNewContext(code, {
    module, exports: module.exports, URL, window: { location: { origin: 'https://portal.example' } },
    require: id => id in mocks ? mocks[id] : id.startsWith('@/') || id.startsWith('./') ? {} : require(id),
  });
  return module.exports;
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}
const billing = load('src/lib/billing.ts');
const destination = '/portal/orders/order-1?paid=1';
let session = { summary: { orderId: 'order-1' } };
const { CheckoutPage } = load('src/pages/portal/Checkout.tsx', {
  'react-router-dom': { Navigate: 'Navigate', useParams: () => ({ invoiceId: 'invoice-1' }), useSearchParams: () => [new URLSearchParams('return=/portal/invoices')] },
  '@tanstack/react-query': { useQuery: () => ({ data: session }) },
  '@/components/CheckoutScreen': { CheckoutScreen: 'CheckoutScreen' },
  '@/lib/billing': billing,
});
assert.equal(CheckoutPage().props.successHref, destination);
assert.equal(CheckoutPage().props.backHref, '/portal/invoices');
session = { alreadyPaid: true, orderId: 'order-1' };
assert.equal(CheckoutPage().props.to, destination);

let confirmed = { status: 'PAID', orderId: 'order-1' }, user = { role: 'CLIENT' };
const { PayLink } = load('src/pages/PayLink.tsx', {
  react: { lazy: () => 'CheckoutScreen', useState: () => [null, () => {}], useEffect: () => {} },
  'react-router-dom': { Navigate: 'Navigate', useParams: () => ({ token: 'token' }), useSearchParams: () => [new URLSearchParams('status=return')] },
  '@tanstack/react-query': { useQuery: () => ({}), useMutation: () => ({ data: confirmed, isSuccess: true }) },
  '@/context/AuthContext': { useAuth: () => ({ user }) },
  '@/lib/billing': billing,
});
assert.equal(PayLink().props.to, destination);
user = null;
assert.equal(PayLink().props.title, 'Paid');
user = { role: 'CLIENT' };
confirmed = { status: 'PARTIAL', orderId: 'order-1' };
assert.notEqual(PayLink().type, 'Navigate');

const calls = [];
let credit = 1000, payAction;
const navigations = [];
const { PortalInvoices } = load('src/pages/portal/Invoices.tsx', {
  react: { useState: initial => [initial, () => {}], useMemo: fn => fn(), useRef: () => ({ current: false }), useEffect: () => {} },
  'react-router-dom': { useNavigate: () => (...args) => navigations.push(args), useSearchParams: () => [new URLSearchParams()] },
  '@tanstack/react-query': {
    useQuery: options => ({ data: options.queryKey[0] === 'my-invoices' ? { invoices: [], storeCreditCents: credit } : {} }),
    useQueryClient: () => ({}), useMutation: options => { payAction = options.mutationFn; return {}; },
  },
  '@/components/ui/AppDialog': { useDialog: () => ({ confirm: async () => true }) },
  '@/lib/format': { money: cents => String(cents) },
  '@/lib/billing': { ...billing, payMyInvoice: async () => ({ invoice: { status: 'PAID', orderId: 'order-1' } }) },
});
const { CheckoutScreen } = load('src/components/CheckoutScreen.tsx', {
  react: { useState: initial => [initial, () => {}], useMemo: fn => fn() },
  '@stripe/stripe-js': { loadStripe: () => Promise.resolve({}) },
  '@stripe/react-stripe-js/checkout': {
    CheckoutElementsProvider: 'Provider', ExpressCheckoutElement: 'Express',
    useCheckoutElements: () => ({ type: 'success', checkout: {
      total: { total: { amount: '$10.00' } },
      confirm: async options => { calls.push(options); return { type: 'success' }; },
    } }),
  },
});
async function run() {
  PortalInvoices();
  await payAction({ id: 'invoice-1', amountCents: 1000, amountPaidCents: 0, currency: 'USD' });
  assert.equal(navigations[0][0], destination);
  credit = 500;
  PortalInvoices();
  await payAction({ id: 'invoice-1', amountCents: 1000, amountPaidCents: 0, currency: 'USD' });
  assert.equal(navigations.length, 1, 'Partial store credit must not redirect');
  const screen = CheckoutScreen({ summary: { groups: [] }, clientSecret: 'secret', publishableKey: 'key', emailOnFile: true, successHref: destination });
  const payment = find(screen, node => typeof node.type === 'function' && node.type.name === 'PaymentColumn');
  const form = payment.type(payment.props);
  find(form, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await find(form, node => node.type === 'Express').props.onConfirm({ paymentType: 'apple_pay' });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.returnUrl, 'https://portal.example' + destination);
    assert.equal(call.redirect, 'always');
  }
  console.log('Payment redirect checks passed: invoice checkout, already paid, signed-in links, partial payments, card and wallet confirmation.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
