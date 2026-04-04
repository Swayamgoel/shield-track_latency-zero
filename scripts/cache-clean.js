const fs = require('fs');
const path = require('path');

const targets = ['.turbo'];

for (const target of targets) {
  const fullPath = path.resolve(__dirname, '..', target);
  fs.rmSync(fullPath, { recursive: true, force: true });
  console.log(`[cache-clean] removed ${target}`);
}

console.log('[cache-clean] done');
