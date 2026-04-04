const { spawnSync } = require('child_process');

const checks = [
  { name: 'lint', command: 'pnpm', args: ['run', 'lint'] },
  { name: 'type-check', command: 'pnpm', args: ['run', 'type-check'] },
  { name: 'clean-and-cache-clean', command: 'pnpm', args: ['run', 'clean:all'] },
];

for (const check of checks) {
  console.log(`\n[validate] Running ${check.name}...`);
  const result = spawnSync(check.command, check.args, {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`\n[validate] FAILED: ${check.name}`);
    process.exit(result.status || 1);
  }

  console.log(`[validate] PASSED: ${check.name}`);
}

console.log('\n[validate] SUCCESS: All checks passed');
