import { spawnSync } from 'node:child_process';

const isRender = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_HOSTNAME);
if (!isRender) {
  process.exit(0);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
console.log('[render-postinstall] building React client...');

const result = spawnSync(npmCmd, ['run', 'build:client'], {
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error('[render-postinstall] failed to start npm run build:client', result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`[render-postinstall] client build exited with code ${result.status}`);
  process.exit(result.status ?? 1);
}

console.log('[render-postinstall] React client build finished successfully.');

