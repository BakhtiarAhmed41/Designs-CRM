const fs = require('fs');

const admin = fs.readFileSync(
  'C:/Projects/Designs-CRM/Admin_Final_-V2.html',
  'utf8',
);
const pages = [
  'dash',
  'messages',
  'orders',
  'quotes',
  'quotedetail',
  'edits',
  'customers',
  'billing',
  'mywork',
  'orderdetail',
  'convo',
  'team',
];
for (const p of pages) {
  const re = new RegExp(
    '<section class="page[^"]*" id="p-' +
      p +
      '"([\\s\\S]*?)(?=<section class="page|<!-- MODALS|</main>)',
    'i',
  );
  const m = admin.match(re);
  if (m) {
    fs.writeFileSync('src/_ref_admin_' + p + '.html', m[0].slice(0, 30000));
    console.log('admin', p, m[0].length);
  } else console.log('admin', p, 'MISSING');
}

const cust = fs.readFileSync(
  'C:/Projects/Designs-CRM/Customer_Portal_Final_-V2 (1).html',
  'utf8',
);
const cpages = [
  'dash',
  'quotes',
  'orders',
  'files',
  'invoices',
  'messages',
  'profile',
];
for (const p of cpages) {
  const re = new RegExp(
    '<section class="page[^"]*" id="p-' +
      p +
      '"([\\s\\S]*?)(?=<section class="page|<!-- MODAL|</main>)',
    'i',
  );
  const m = cust.match(re);
  if (m) {
    fs.writeFileSync('src/_ref_cust_' + p + '.html', m[0].slice(0, 30000));
    console.log('cust', p, m[0].length);
  } else console.log('cust', p, 'MISSING');
}

// rolebar + side from admin
const rb = admin.match(/<div class="rolebar">[\s\S]*?<\/div>\s*<div class="app">/);
if (rb) fs.writeFileSync('src/_ref_admin_shell.html', rb[0].slice(0, 8000));
const side = admin.match(/<aside class="side">[\s\S]*?<\/aside>/);
if (side) fs.writeFileSync('src/_ref_admin_side.html', side[0]);
const cside = cust.match(/<aside class="side">[\s\S]*?<\/aside>/);
if (cside) fs.writeFileSync('src/_ref_cust_side.html', cside[0]);
console.log('shell snippets written');
