const fs = require('fs');
const admin = fs.readFileSync('src/_proto_admin.css', 'utf8');
const cust = fs.readFileSync('src/_proto_cust.css', 'utf8');

// Prefer admin CSS (includes R18 clean look). Append customer-only helpers
// that admin doesn't define, skipping duplicate :root/body resets.
const custExtra = cust
  .replace(/:root\{[\s\S]*?\}/, '')
  .replace(/\*\{box-sizing[\s\S]*?\}/, '')
  .replace(/body\{[\s\S]*?\}/, '');

const out = `/* Auto-ported from Admin_Final_-V2.html + Customer_Portal_Final_-V2 */
@import url('https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.26.0/tabler-icons.min.css');

${admin}

/* ===== Customer portal extras ===== */
${custExtra}

/* ===== React SPA adapters ===== */
html, body, #root { height: 100%; }
.page { display: block; } /* React routes replace .page.on switching */
.lvd-app { min-height: 100%; }
.lvd-app.with-rolebar .side { top: 39px; height: calc(100vh - 39px); }
.center-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); }
.spinner { width: 20px; height: 20px; border: 2px solid var(--line); border-top-color: var(--navy); border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.alert-error { background: var(--tint-m); color: var(--maroon); border-radius: 9px; padding: 10px 12px; font-size: 13px; }
a { color: inherit; }
button { font-family: inherit; }
`;

fs.writeFileSync('src/index.css', out);
console.log('wrote index.css', out.length);
