import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SHARDS = 4;
const MAX_SHARDS = 8;

function option(argv, name, fallback = '') {
  return argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
}

export function parseParallelActionOptions(argv, cwd = process.cwd()) {
  const requested = Number(option(argv, '--shards', String(DEFAULT_SHARDS)));
  if (!Number.isSafeInteger(requested) || requested < 2 || requested > MAX_SHARDS) {
    throw new TypeError(`--shards must be an integer from 2 to ${MAX_SHARDS}.`);
  }
  if (argv.includes('--no-js=off')) {
    throw new TypeError('--no-js=off is developer-only and cannot produce complete merged release evidence.');
  }
  const output = path.resolve(cwd, option(argv, '--output', '.admin-runtime/h6-qa/public-action-crawl.json'));
  const shardDirectory = path.resolve(cwd, option(argv, '--shard-dir', '.admin-runtime/h6-qa/public-action-shards'));
  return Object.freeze({
    help: argv.includes('--help') || argv.includes('-h'),
    shards: requested,
    output,
    shardDirectory,
    dist: option(argv, '--dist', 'dist'),
    base: option(argv, '--base', process.env.BASE_PATH || '/'),
    headful: argv.includes('--headful')
  });
}

export function buildShardArguments(options, index) {
  if (!Number.isSafeInteger(index) || index < 1 || index > options.shards) {
    throw new RangeError('Shard index is outside the declared deterministic set.');
  }
  const output = path.join(options.shardDirectory, `shard-${index}-of-${options.shards}.json`);
  return Object.freeze({
    output,
    args: [
      'tools/qa/public-action-crawl.mjs',
      `--dist=${options.dist}`,
      `--base=${options.base}`,
      `--shard=${index}/${options.shards}`,
      `--output=${output}`,
      ...(options.headful ? ['--headful'] : [])
    ]
  });
}

function run(command, args, { cwd, env, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with ${code ?? signal}.`));
    });
  });
}

async function main() {
  const cwd = process.cwd();
  const options = parseParallelActionOptions(process.argv.slice(2), cwd);
  if (options.help) {
    process.stdout.write([
      'Parallel deterministic H6 public action crawl',
      '',
      '  node tools/qa/public-action-parallel.mjs --shards=4',
      '  Options: --dist=<dir>, --base=/SMU1, --output=<json>, --shard-dir=<dir>, --headful.',
      '',
      'Every concrete route belongs to exactly one shard. The final report is written only after',
      'the merger verifies a complete, non-overlapping deterministic shard set.',
      ''
    ].join('\n'));
    return;
  }
  await mkdir(options.shardDirectory, { recursive: true });
  const workers = Array.from({ length: options.shards }, (_, offset) => buildShardArguments(options, offset + 1));
  await Promise.all(workers.map((worker, offset) => run(process.execPath, worker.args, {
    cwd,
    env: process.env,
    label: `public action shard ${offset + 1}/${options.shards}`
  })));
  await mkdir(path.dirname(options.output), { recursive: true });
  await run(process.execPath, [
    'tools/qa/public-action-shards.mjs',
    ...workers.map((worker) => `--input=${worker.output}`),
    `--output=${options.output}`
  ], { cwd, env: process.env, label: 'public action shard merger' });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
