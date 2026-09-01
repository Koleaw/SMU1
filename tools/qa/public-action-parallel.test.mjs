import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { buildShardArguments, parseParallelActionOptions } from './public-action-parallel.mjs';

test('parallel action crawl creates one exact, non-overlapping CLI shard per worker', () => {
  const root = path.resolve('fixture-root');
  const options = parseParallelActionOptions(['--shards=4', '--base=/SMU1', '--dist=dist'], root);
  const workers = Array.from({ length: 4 }, (_, index) => buildShardArguments(options, index + 1));
  assert.deepEqual(workers.map((worker) => worker.args.find((value) => value.startsWith('--shard='))), [
    '--shard=1/4', '--shard=2/4', '--shard=3/4', '--shard=4/4'
  ]);
  assert.equal(new Set(workers.map((worker) => worker.output)).size, 4);
  assert.ok(workers.every((worker) => worker.args.includes('--base=/SMU1')));
});

test('parallel action crawl rejects unsafe or unbounded worker counts', () => {
  for (const value of ['0', '1', '9', '1.5', 'not-a-number']) {
    assert.throws(() => parseParallelActionOptions([`--shards=${value}`]), /--shards/u);
  }
});

test('parallel release crawl defaults to root and always keeps exact no-JS coverage', () => {
  const previousBasePath = process.env.BASE_PATH;
  delete process.env.BASE_PATH;
  try {
    const options = parseParallelActionOptions([]);
    assert.equal(options.base, '/');
    assert.equal(buildShardArguments(options, 1).args.includes('--no-js=off'), false);
    assert.throws(
      () => parseParallelActionOptions(['--no-js=off']),
      /cannot produce complete merged release evidence/u
    );
  } finally {
    if (previousBasePath === undefined) delete process.env.BASE_PATH;
    else process.env.BASE_PATH = previousBasePath;
  }
});
