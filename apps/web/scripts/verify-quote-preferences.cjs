const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, suffix = '') {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + suffix, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (id) => id in mocks ? mocks[id] : id.startsWith('@/') ? {} : require(id),
    URLSearchParams,
  });
  return module.exports;
}

const { SERVICES } = load('src/pages/portal/Settings.tsx', {}, '\nexport { SERVICES };');
const serviceKeys = { emb: 'embroidery', dig: 'vector', cnc: 'laser' };
const bridge = fs.readFileSync(path.join(root, 'public/portal-forms/bridge.js'), 'utf8');
function form(service) { return fs.readFileSync(path.join(root, `public/portal-forms/${service}.html`), 'utf8'); }
function formatValues(html) { return [...html.matchAll(/name="format" value="([^"]+)"/g)].map((m) => m[1]); }

for (const service of SERVICES) {
  assert.deepEqual(formatValues(form(serviceKeys[service.id])), Array.from(service.formats), `${service.id}: settings and quote format options must match`);
}
assert(!form('vector').includes('3D STL / 3MF Files'));
assert(form('laser').includes('"3D Printing Files"'));
console.log('PASS: settings and quote formats match for all services; 3D Printing Files is on CNC only');

// Execute the real iframe bridge against format controls from each actual form.
function bridgeFor(service) {
  const boxes = formatValues(form(service)).map((value) => ({ value, checked: false }));
  const other = { value: '' }, otherCheck = { checked: false }, otherField = { style: {} };
  const elements = { otherFormatCheck: otherCheck, otherFormatField: otherField };
  const document = {
    createElement: () => ({}), head: { appendChild() {} }, addEventListener() {},
    getElementById: (id) => elements[id] || null,
    querySelector: (selector) => selector.startsWith('#otherFormatField input') ? other : null,
    querySelectorAll: (selector) => selector === 'input[name="format"]' ? boxes : selector === 'input[name="format"]:checked' ? boxes.filter((b) => b.checked) : [],
  };
  const window = { addEventListener() {} };
  vm.runInNewContext(bridge, { document, window, requestAnimationFrame() {}, location: { pathname: `/portal-forms/${service}.html` } });
  return { window, boxes, other, otherCheck };
}
const embroidery = bridgeFor('embroidery');
embroidery.window.LVD_APPLY_PREFS({ embFormats: ['DST', 'PES'] });
assert.deepEqual(embroidery.boxes.filter((b) => b.checked).map((b) => b.value), ['DST', 'PES']);
embroidery.boxes.find((b) => b.value === 'PES').checked = false;
assert.equal(embroidery.boxes.find((b) => b.value === 'PES').checked, false);
const cnc = bridgeFor('laser');
cnc.window.LVD_APPLY_PREFS({ cncFormats: ['STL', '3MF'] });
assert.deepEqual(cnc.boxes.filter((b) => b.checked).map((b) => b.value), ['STL', '3MF']);
assert.equal(cnc.otherCheck.checked, false);
const vector = bridgeFor('vector');
vector.window.LVD_APPLY_PREFS({ digFormats: ['JPG', 'SVG'], digOther: 'TIFF' });
assert.deepEqual(vector.boxes.filter((b) => b.checked).map((b) => b.value), ['SVG', 'JPEG']);
assert.equal(vector.other.value, 'TIFF');
assert.equal(vector.otherCheck.checked, true);
console.log('PASS: saved formats tick the real bridge controls, including STL/3MF, JPG aliases, and custom formats');

function renderDrafts(drafts, failed = false, loading = false) {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PortalQuotes } = load('src/pages/portal/Quotes.tsx', {
    react: React,
    'react-router-dom': { useNavigate: () => () => {}, useLocation: () => ({}), Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
    '@tanstack/react-query': { useQuery: ({ queryKey }) => queryKey[0] === 'my-quote-drafts'
      ? { data: { drafts }, isError: failed, isLoading: loading }
      : { data: { orders: [], total: 0 }, isLoading: false, isFetching: false } },
    '@/lib/format': load('src/lib/format.ts'),
    '@/components/ui/PageHeader': { PageHeader: ({ title, actions }) => React.createElement('header', null, title, actions) },
    '@/components/RequestQuoteMenu': { RequestQuoteMenu: ({ children }) => React.createElement('button', null, children) },
    '@/components/lists/ListToolbar': { ListToolbar: () => null, PaginationBar: () => null },
    '@/components/ui/EmptyState': { EmptyState: () => null, ErrorBanner: () => null },
    '@/components/ui/Skeleton': { SkeletonRows: () => React.createElement('p', null, 'Loading drafts') },
  });
  return renderToStaticMarkup(React.createElement(PortalQuotes));
}
const draftMarkup = renderDrafts([{ serviceKey: 'embroidery', payload: { designName: 'Saved logo' }, updatedAt: '2026-10-15T12:00:00Z' }, { serviceKey: 'svg', payload: { designName: 'CNC design' }, updatedAt: '2026-10-15T12:00:00Z' }]);
assert.match(draftMarkup, /id="saved-drafts"/);
assert.match(draftMarkup, /Saved logo/);
assert.match(draftMarkup, /Resume draft/);
assert.match(draftMarkup, /service=embroidery&amp;draft=1/);
assert.match(draftMarkup, /service=laser&amp;draft=1/);
assert.match(renderDrafts([]), /No saved drafts yet/);
assert.match(renderDrafts([], true), /Try again/);
assert.match(renderDrafts([], false, true), /Loading drafts/);
console.log('PASS: Quotes shows discoverable drafts with project names, correct resume links, loading, empty and error states');

async function frameLoad(resumeDraft) {
  let stateIndex = 0, refIndex = 0;
  const messages = [];
  const requests = [];
  const prefs = { embFormats: ['DST', 'PES'] };
  const win = { postMessage: (message) => messages.push(message) };
  const react = {
    useState: (initial) => [stateIndex++ === 1 ? prefs : initial, () => {}],
    useEffect() {}, useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useRef: (initial) => ({ current: refIndex++ === 0 ? { contentWindow: win } : initial }),
  };
  const { QuoteFormPage } = load('src/pages/portal/QuoteFormPage.tsx', {
    react,
    'react-router-dom': { useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams(`service=embroidery${resumeDraft ? '&draft=1' : ''}`)] },
    '@tanstack/react-query': { useQueryClient: () => ({}) },
    '@/components/ui/AppDialog': { useDialog: () => ({}) },
    '@/components/Shell': { useTopbarLead() {} },
    '@/context/ThemeContext': { useTheme: () => ({ colors: {} }) },
    '@/lib/theme': { postThemeToWindow() {} },
    '@/lib/orders': { getQuoteDraft: async (service) => {
      requests.push(service);
      return { draft: { payload: { designName: 'Saved logo', formats: ['PES'] } } };
    } },
  });
  function iframe(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'iframe') return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = iframe(child); if (found) return found; }
    return null;
  }
  const frame = iframe(QuoteFormPage());
  frame.props.onLoad();
  frame.props.onLoad();
  await Promise.resolve();
  return { messages, requests };
}
(async () => {
  assert.equal((await frameLoad(false)).messages.find((m) => m.type === 'lvd-apply-prefs').prefs.embFormats.join(','), 'DST,PES');
  const resumed = await frameLoad(true);
  assert(!resumed.messages.some((m) => m.type === 'lvd-apply-prefs'));
  assert.equal(resumed.requests.join(','), 'embroidery');
  assert.equal(resumed.messages.find((m) => m.type === 'lvd-restore-draft').draft.designName, 'Saved logo');
  console.log('PASS: iframe load applies saved preferences or restores a draft once, even if the ready event was missed');
})().catch((err) => { console.error(err); process.exitCode = 1; });
