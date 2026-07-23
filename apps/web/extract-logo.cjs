const fs = require('fs');
const html = fs.readFileSync(
  'C:/Projects/Designs-CRM/Admin_Final_-V2.html',
  'utf8',
);
const m = html.match(/src="(data:image\/png;base64,[^"]+)"/);
if (!m) {
  console.error('logo not found');
  process.exit(1);
}
const b64 = m[1].replace(/^data:image\/png;base64,/, '');
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/lvd-logo.png', Buffer.from(b64, 'base64'));
console.log('wrote public/lvd-logo.png', fs.statSync('public/lvd-logo.png').size);
