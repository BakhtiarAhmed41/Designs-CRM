const fs = require('fs');

function extractStyles(path, out) {
  const html = fs.readFileSync(path, 'utf8');
  const styles = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html))) styles.push(m[1]);
  fs.writeFileSync(
    out,
    styles.join('\n\n/* ==== next style block ==== */\n\n'),
  );
  console.log(
    path.split(/[/\\]/).pop(),
    'styles',
    styles.length,
    'chars',
    styles.reduce((a, b) => a + b.length, 0),
  );
}

extractStyles(
  'C:/Projects/Designs-CRM/Admin_Final_-V2.html',
  'C:/Projects/Designs-CRM/apps/web/src/_proto_admin.css',
);
extractStyles(
  'C:/Projects/Designs-CRM/Customer_Portal_Final_-V2 (1).html',
  'C:/Projects/Designs-CRM/apps/web/src/_proto_cust.css',
);
