import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { resolveAstroCli } from '../admin-api/astro-cli.mjs';
import { createParentBoundNodeArgs } from '../admin-api/launcher.mjs';
import { createAdminRepoIdentity } from '../admin-api/runtime-identity.mjs';

const root = process.cwd();
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const option = (name, fallback = '') => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const basePath = option('--base', process.env.BASE_PATH || '/');
const output = option('--output', '.admin-runtime/h6-qa/route-passport.json');

if (hasFlag('--help') || hasFlag('-h')) {
  process.stdout.write([
    'H6 production/editor route-passport orchestrator',
    '',
    'Starts an explicit loopback-only Astro editor renderer on a random port,',
    'then opens every production route in public and editor modes.',
    '',
    'Options: --base=/SMU1, --output=<json>, --headful, --json.',
    'Developer smoke only: --route=/exact/url/ --allow-stale-dist.',
    ''
  ].join('\n'));
  process.exit(0);
}

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForHttp = async (url, child, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Astro editor renderer exited before health check (${child.exitCode}).`);
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status >= 200 && response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Astro editor renderer did not become ready within ${timeoutMs} ms.`);
};

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
    windowsHide: true,
    shell: false
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0
    ? resolve()
    : reject(new Error(`${path.basename(command)} exited with ${code ?? signal}.`)));
});

const stop = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
};

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const astroCli = await resolveAstroCli(root);
const repoIdentity = createAdminRepoIdentity(root);
const { CODEX_CI: _codexCi, ...foregroundEnvironment } = process.env;
const editor = spawn(process.execPath, createParentBoundNodeArgs(astroCli, [
  'dev', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)
]), {
  cwd: root,
  env: {
    ...foregroundEnvironment,
    CI: 'false',
    ASTRO_TELEMETRY_DISABLED: '1',
    // Astro 7 auto-daemonizes inside detected agent environments unless this
    // compatibility switch is present. With --ignore-lock the child remains a
    // foreground process that is bound to, and cleaned up with, this QA run.
    ASTRO_DEV_BACKGROUND: 'foreground-parent-bound',
    // The local editor launcher always serves the production renderer from
    // the loopback origin root. The public artifact may still be deployed
    // below a repository base such as /SMU1; that base is passed separately
    // to the public route-passport child below.
    BASE_PATH: '/',
    DEPLOY_TARGET: 'development',
    SMU1_LOCAL_ADMIN: 'true',
    SMU1_ADMIN_LAUNCHER_REPO_IDENTITY: repoIdentity,
    TEST_SITE_URL: origin
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  windowsHide: true,
  shell: false
});
let rendererLog = '';
editor.stdout.on('data', (chunk) => { rendererLog = `${rendererLog}${chunk}`.slice(-16_000); });
editor.stderr.on('data', (chunk) => { rendererLog = `${rendererLog}${chunk}`.slice(-16_000); });

try {
  await waitForHttp(`${origin}/`, editor);
  await run(process.execPath, [
    path.join(root, 'tools', 'qa', 'route-passport-browser.mjs'),
    `--editor-origin=${origin}`,
    '--require-editor-coverage',
    `--base=${basePath}`,
    `--output=${output}`,
    ...(option('--route') ? [`--route=${option('--route')}`] : []),
    ...(hasFlag('--allow-stale-dist') ? ['--allow-stale-dist'] : []),
    ...(hasFlag('--headful') ? ['--headful'] : []),
    ...(hasFlag('--json') ? ['--json'] : [])
  ]);
} catch (error) {
  if (rendererLog) process.stderr.write(`\n[editor-renderer]\n${rendererLog}\n`);
  throw error;
} finally {
  await stop(editor);
}
