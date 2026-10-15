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
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: id => id in mocks ? mocks[id] : id.startsWith('@/') || id.startsWith('./') ? {} : require(id) });
  return module.exports;
}
const theme = load('src/lib/theme.ts');
const appearance = load('src/lib/customers.ts', { './theme': theme });
assert.equal(appearance.portalLookFromPrefs(JSON.stringify({ portalLook: { headingColor: '#abc', backgroundColor: '#292929' } })).headingColor, '#AABBCC');
assert.equal(appearance.portalLookFromPrefs({ portalLook: { backgroundColor: 'invalid' } }).backgroundColor, undefined);
assert.equal(appearance.portalLookStyle({ headingColor: '#222222', backgroundColor: '#292929' })['--portal-page-heading'], '#FFFFFF');
assert.equal(appearance.portalLookStyle({ headingColor: '#9A1E22', backgroundColor: '#FFFFFF' })['--portal-heading'], '#9A1E22');

let states = [], refs = [], effects = [], pending = [], index = 0, refIndex = 0, effectIndex = 0;
let savedPrefs = { embFormats: ['DST'], customPreference: 'keep me', portalLook: { headingColor: '#123456', backgroundColor: '#F8F6F1' } };
let queryData = { customer: { preferences: savedPrefs } }, cached, failed = false;
const previews = [];
const preview = look => previews.push(look);
const react = {
  useState(initial) { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], next => states[i] = typeof next === 'function' ? next(states[i]) : next]; },
  useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; },
  useEffect(fn, deps) {
    const i = effectIndex++, previous = effects[i];
    if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) pending.push(() => { previous?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; });
  },
};
const { PortalSettings } = load('src/pages/portal/Settings.tsx', {
  react,
  '@tanstack/react-query': {
    useQuery: () => ({ data: queryData, isSuccess: true, isError: false, refetch: async () => ({ data: queryData }) }),
    useQueryClient: () => ({ setQueryData(key, data) { cached = { key, data }; queryData = data; } }),
  },
  '@/context/AuthContext': { useAuth: () => ({ user: { firstName: 'Customer' } }) },
  '@/context/ThemeContext': { useTheme: () => ({ colors: { mainText: '#222222', pageBg: '#FFFFFF' } }) },
  '@/context/PortalAppearanceContext': { usePortalAppearancePreview: () => preview },
  '@/lib/theme': theme,
  '@/lib/customerPrefs': load('src/lib/customerPrefs.ts'),
  '@/lib/api': { getErrorMessage: err => err.message },
  '@/lib/customers': {
    ...appearance, getMyCustomer: async () => ({ customer: { preferences: savedPrefs } }),
    updateMyCustomer: async ({ preferences }) => { if (failed) throw Error('Save failed'); savedPrefs = preferences; return { customer: { preferences } }; },
  },
});
function render() {
  index = refIndex = effectIndex = 0;
  const tree = PortalSettings();
  const run = pending; pending = []; run.forEach(fn => fn());
  return tree;
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const match = find(child, predicate); if (match) return match; }
  return null;
}
async function run() {
  render(); render();
  assert.equal(previews.at(-1).backgroundColor, '#F8F6F1');
  let tree = render();
  find(tree, n => n.props?.['aria-label'] === 'Background color hex').props.onChange({ target: { value: '#292929' } });
  tree = render();
  find(tree, n => n.props?.['aria-label'] === 'Heading color hex').props.onChange({ target: { value: '#9A1E22' } });
  tree = render();
  assert.equal(previews.at(-1).backgroundColor, '#292929');
  assert.equal(previews.at(-1).headingColor, '#9A1E22');
  tree.props.onSubmit({ preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(savedPrefs.portalLook.backgroundColor, '#292929');
  assert.equal(savedPrefs.portalLook.headingColor, '#9A1E22');
  assert.equal(savedPrefs.customPreference, 'keep me');
  assert.equal(cached.key.join(','), 'portal-customer-me');
  assert.equal(appearance.portalLookFromPrefs(cached.data.customer.preferences).backgroundColor, '#292929');
  console.log('PASS: appearance previews immediately, saves to customer preferences, updates the portal cache, and preserves unrelated settings');
  tree = render();
  find(tree, n => n.type === 'button' && n.props.children === 'Reset to default').props.onClick();
  render();
  assert.equal(previews.at(-1).backgroundColor, '#FFFFFF');
  assert.equal(previews.at(-1).headingColor, '#222222');
  effects.forEach(effect => effect.cleanup?.());
  assert.equal(previews.at(-1), null);
  assert.equal(savedPrefs.portalLook.backgroundColor, '#292929');
  console.log('PASS: reset previews defaults; leaving Settings clears only the unsaved preview; saved colors survive reload');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
