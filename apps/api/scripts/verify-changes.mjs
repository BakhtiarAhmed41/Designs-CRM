/**
 * End-to-end verification scenarios for spreadsheet changes.
 * Run against a live API: node scripts/verify-changes.mjs [baseUrl]
 */
import { randomBytes } from 'crypto';

const BASE = (process.argv[2] || 'http://localhost:3001/api').replace(/\/+$/, '');
const stamp = Date.now().toString(36);
const results = [];

function cookieJar() {
  const jar = new Map();
  return {
    store(res) {
      const raw = res.headers.getSetCookie?.() || [];
      for (const c of raw) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    clear() {
      jar.clear();
    },
  };
}

async function req(jar, method, path, body, expectStatus) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(jar.header() ? { cookie: jar.header() } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  jar.store(res);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  const allowed = expectStatus == null
    ? null
    : Array.isArray(expectStatus)
      ? expectStatus
      : [expectStatus];
  if (allowed && !allowed.includes(res.status)) {
    const msg = data?.message || data?.error || text.slice(0, 200);
    throw new Error(`${method} ${path} => ${res.status} (expected ${allowed.join('|')}): ${msg}`);
  }
  return { status: res.status, data };
}

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, err) {
  results.push({ name, ok: false, detail: String(err?.message || err) });
  console.error(`FAIL  ${name} — ${err?.message || err}`);
}

async function scenario(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (e) {
    fail(name, e);
  }
}

const adminJar = cookieJar();
const clientJar = cookieJar();
const pendingJar = cookieJar();

const pendingEmail = `pending.${stamp}@verify.test`;
const activeEmail = `active.${stamp}@verify.test`;
const staffEmail = `staff.${stamp}@verify.test`;
const roleName = `Verifier ${stamp}`;
const password = 'Verify123!';

let roleId;
let customerId;
let orderId;
let quoteId;
let staffUserId;
let pendingUserId;
let resetToken;

console.log(`\nVerifying against ${BASE}\n`);

await scenario('API health /auth/login reachable', async () => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nope@x.com', password: 'bad' }),
  });
  if (res.status !== 401 && res.status !== 400) {
    throw new Error(`Unexpected status ${res.status}`);
  }
});

await scenario('Admin login', async () => {
  const { data } = await req(adminJar, 'POST', '/auth/login', {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!',
  }, [200, 201]);
  if (!data?.user?.role) throw new Error('No user in login response');
  if (!['ADMIN', 'SUPER_ADMIN'].includes(data.user.role)) {
    throw new Error(`Unexpected role ${data.user.role}`);
  }
});

await scenario('Create custom role with permissions', async () => {
  const { data } = await req(adminJar, 'POST', '/admin/roles', {
    name: roleName,
    description: 'Verification role',
    baseRole: 'SUPPORT',
    permissions: {
      dashboard: true,
      messages: true,
      orders: true,
      quotes: true,
      edits: true,
      customers: true,
      billing: false,
      team: false,
      roles: false,
    },
  }, [200, 201]);
  roleId = data.role?.id;
  if (!roleId) throw new Error('No role id');
});

await scenario('List roles includes new role', async () => {
  const { data } = await req(adminJar, 'GET', '/admin/roles', undefined, 200);
  if (!data.roles?.some((r) => r.id === roleId)) throw new Error('Role missing from list');
});

await scenario('Create staff user with custom role', async () => {
  const { data } = await req(adminJar, 'POST', '/admin/users', {
    email: staffEmail,
    password,
    firstName: 'Verify',
    lastName: 'Staff',
    customRoleId: roleId,
    loginStatus: 'ACTIVE',
  }, [200, 201]);
  staffUserId = data.user?.id;
  if (!staffUserId) throw new Error('No staff user id');
  if (data.user.role !== 'SUPPORT') throw new Error(`Expected SUPPORT base role, got ${data.user.role}`);
});

await scenario('Staff user can login', async () => {
  const jar = cookieJar();
  const { data } = await req(jar, 'POST', '/auth/login', {
    email: staffEmail,
    password,
  }, [200, 201]);
  if (data.user.email !== staffEmail) throw new Error('Wrong user');
});

await scenario('Create customer with login credentials', async () => {
  const { data } = await req(adminJar, 'POST', '/admin/customers', {
    name: `Verify Customer ${stamp}`,
    email: activeEmail,
    phone: '555-0100',
    password,
    accountType: 'PAY_PER_ORDER',
    source: 'PORTAL',
    active: true,
  }, [200, 201]);
  customerId = data.customer?.id;
  if (!customerId) throw new Error('No customer id');
  if (!data.customer.userId) throw new Error('Customer has no linked user');
});

await scenario('Duplicate customer email rejected', async () => {
  const res = await req(adminJar, 'POST', '/admin/customers', {
    name: 'Dup',
    email: activeEmail,
    password,
    accountType: 'PAY_PER_ORDER',
    source: 'PORTAL',
  });
  if (res.status !== 409 && res.status !== 400) {
    throw new Error(`Expected conflict, got ${res.status}`);
  }
});

await scenario('Customer list search + pagination', async () => {
  const { data } = await req(
    adminJar,
    'GET',
    `/admin/customers?q=${encodeURIComponent(stamp)}&page=1&pageSize=10`,
    undefined,
    200,
  );
  if (!data.customers?.some((c) => c.id === customerId)) throw new Error('Customer not found in search');
  if (typeof data.total !== 'number') throw new Error('Missing total');
});

await scenario('Admin generate order for existing customer', async () => {
  const { data } = await req(adminJar, 'POST', '/admin/orders/create', {
    type: 'ORDER',
    customerId,
    serviceType: 'EMBROIDERY',
    name: `Verify Order ${stamp}`,
    designCount: 1,
    priceCents: 2500,
  }, [200, 201]);
  orderId = data.order?.id;
  if (!orderId) throw new Error('No order id');
});

await scenario('Orders search / filters', async () => {
  const { data } = await req(
    adminJar,
    'GET',
    `/admin/orders?type=ORDER&q=${encodeURIComponent(stamp)}&page=1&pageSize=20`,
    undefined,
    200,
  );
  if (!data.orders?.some((o) => o.id === orderId)) throw new Error('Order not in filtered list');
});

await scenario('Admin generate quote', async () => {
  const { data } = await req(adminJar, 'POST', '/admin/orders/create', {
    type: 'QUOTE_REQUEST',
    customerId,
    serviceType: 'SVG',
    name: `Verify Quote ${stamp}`,
  }, [200, 201]);
  quoteId = data.order?.id;
  if (!quoteId) throw new Error('No quote id');
});

await scenario('Billing invoices list (authorized)', async () => {
  const { data } = await req(adminJar, 'GET', '/admin/invoices', undefined, 200);
  if (!Array.isArray(data.invoices)) throw new Error('Missing invoices array');
});

await scenario('Create invoice for order', async () => {
  const { data } = await req(adminJar, 'POST', '/admin/invoices', {
    customerId,
    orderId,
    amountCents: 2500,
    coversText: `Verify invoice ${stamp}`,
  }, [200, 201]);
  if (!data.invoice?.id) throw new Error('No invoice');
});

await scenario('Invoice search', async () => {
  const { data } = await req(
    adminJar,
    'GET',
    `/admin/invoices?q=${encodeURIComponent(stamp)}`,
    undefined,
    200,
  );
  if (!data.invoices?.length) throw new Error('Invoice search returned empty');
});

await scenario('Edits list with search', async () => {
  await req(adminJar, 'GET', `/admin/edits?q=${encodeURIComponent(stamp)}`, undefined, 200);
});

await scenario('Login requests list', async () => {
  await req(adminJar, 'GET', '/admin/login-requests', undefined, 200);
});

await scenario('Self-register creates PENDING account', async () => {
  const { data } = await req(pendingJar, 'POST', '/auth/register', {
    email: pendingEmail,
    password,
    name: `Pending User ${stamp}`,
    phone: '555-0199',
  }, [200, 201]);
  if (data.pending !== true && data.user?.loginStatus !== 'PENDING') {
    throw new Error(`Expected pending registration, got ${JSON.stringify(data)}`);
  }
  pendingUserId = data.user?.id;
  if (!pendingUserId) throw new Error('No pending user id');
});

await scenario('Pending user cannot login', async () => {
  const jar = cookieJar();
  const res = await req(jar, 'POST', '/auth/login', {
    email: pendingEmail,
    password,
  });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  const msg = String(res.data?.message || '');
  if (!/verification|progress|pending|wait/i.test(msg)) {
    throw new Error(`Unexpected message: ${msg}`);
  }
});

await scenario('Pending appears in login requests', async () => {
  const { data } = await req(adminJar, 'GET', '/admin/login-requests', undefined, 200);
  const hit = data.requests?.find((r) => r.id === pendingUserId || r.email === pendingEmail);
  if (!hit) throw new Error('Pending request not listed');
});

await scenario('Approve pending login', async () => {
  await req(adminJar, 'PATCH', `/admin/login-requests/${pendingUserId}`, {
    status: 'ACTIVE',
  }, 200);
});

await scenario('Approved user can login', async () => {
  const { data } = await req(clientJar, 'POST', '/auth/login', {
    email: pendingEmail,
    password,
  }, [200, 201]);
  if (data.user.role !== 'CLIENT') throw new Error('Expected CLIENT');
});

await scenario('Client can create quote request (no 500)', async () => {
  const { data } = await req(clientJar, 'POST', '/orders', {
    type: 'QUOTE_REQUEST',
    serviceType: 'VECTOR',
    name: `Client Quote ${stamp}`,
    instructions: 'verify submit',
  }, [200, 201]);
  if (!data.order?.id) throw new Error('No client order');
  if (data.order.status !== 'WAITING_FOR_QUOTATION' && data.order.type !== 'QUOTE_REQUEST') {
    throw new Error(`Unexpected order shape ${data.order.status}/${data.order.type}`);
  }
});

await scenario('Client quote list includes drafts/requests', async () => {
  const { data } = await req(clientJar, 'GET', '/orders', undefined, 200);
  const quotes = (data.orders || []).filter(
    (o) =>
      o.type === 'QUOTE_REQUEST' ||
      ['CREATED', 'WAITING_FOR_QUOTATION', 'QUOTATION_PROVIDED'].includes(o.status),
  );
  if (!quotes.length) throw new Error('No quotes for client');
});

await scenario('Notifications endpoint works for admin', async () => {
  const { data } = await req(adminJar, 'GET', '/notifications', undefined, 200);
  if (!Array.isArray(data.notifications)) throw new Error('Missing notifications');
});

await scenario('Team list + group chat', async () => {
  await req(adminJar, 'GET', '/admin/team', undefined, 200);
  const listed = await req(adminJar, 'GET', '/admin/team-group-chat', undefined, 200);
  if (!Array.isArray(listed.data.messages)) throw new Error('Missing group messages');
  await req(adminJar, 'POST', '/admin/team-group-chat', {
    body: `Verify group message ${stamp}`,
  }, [200, 201]);
});

await scenario('Forgot password issues token (dev)', async () => {
  const jar = cookieJar();
  const { data } = await req(jar, 'POST', '/auth/forgot-password', {
    email: activeEmail,
  }, [200, 201]);
  if (!data.ok) throw new Error('forgot-password not ok');
  resetToken = data.resetToken;
  if (!resetToken) {
    console.log('  note: resetToken null (expected in production mode)');
  }
});

let activePassword = password;
if (resetToken) {
  await scenario('Reset password with token', async () => {
    const jar = cookieJar();
    const nextPass = 'Verify456!';
    await req(jar, 'POST', '/auth/reset-password', {
      token: resetToken,
      password: nextPass,
    }, [200, 201]);
    await req(jar, 'POST', '/auth/login', {
      email: activeEmail,
      password: nextPass,
    }, [200, 201]);
    activePassword = nextPass;
  });
}

await scenario('Disable customer login', async () => {
  await req(adminJar, 'PATCH', `/admin/customers/${customerId}`, {
    active: false,
  }, 200);
  const jar = cookieJar();
  const res = await req(jar, 'POST', '/auth/login', {
    email: activeEmail,
    password: activePassword,
  });
  if (res.status === 200 || res.status === 201) {
    throw new Error('Disabled customer was still able to login');
  }
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

await scenario('Cleanup: delete custom role', async () => {
  if (roleId) {
    await req(adminJar, 'DELETE', `/admin/roles/${roleId}`, undefined, 200);
  }
});

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n======== SUMMARY ========`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${results.length}`);
if (failed) {
  console.log('\nFailures:');
  for (const r of results.filter((x) => !x.ok)) {
    console.log(` - ${r.name}: ${r.detail}`);
  }
  process.exit(1);
}
console.log('\nAll verification scenarios passed.');
process.exit(0);
