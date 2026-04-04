const fs = require('fs');
const path = require('path');

const targets = ['.turbo', 'apps/api/dist', 'apps/shield-admin/dist'];

for (const target of targets) {
  const fullPath = path.resolve(__dirname, '..', target);
  fs.rmSync(fullPath, { recursive: true, force: true });
  console.log(`[clean] removed ${target}`);
}

console.log('[clean] done');
