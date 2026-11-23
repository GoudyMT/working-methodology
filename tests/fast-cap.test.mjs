// The 30 s cap on a fast-lane test (CI-C): a test over the cap fails the run and names itself with its time, unless it
// sits under tests/slow. KIT_TEST_FAST_MS sets the cap, so each fixture sleeps 1.5 s and runs against a 500 ms cap.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const RUNNER = path.resolve('scripts/test-run.mjs');
const SLEEPER = "import { test } from 'node:test';\n" +
	"test('the sleeping test', async () => { await new Promise((r) => setTimeout(r, 1500)); });\n";

// The runner's environment with the cap removed, so each run sets its own (or none).
const runner = (cwd, args, fastMs) => {
	const { KIT_WINDOWS_SLICE: _w, KIT_TEST_FAST_MS: _f, ...base } = process.env;
	const env = fastMs === undefined ? base : { ...base, KIT_TEST_FAST_MS: String(fastMs) };
	return spawnSync(process.execPath, [RUNNER, ...args], { cwd, encoding: 'utf8', env });
};

// A temp repo with one sleeping test file, in tests/ itself or under tests/slow.
const fixture = (lane) => {
	const dir = kitTemp.makeTemp('fast-cap-');
	const folder = path.join(dir, 'tests', ...(lane ? [lane] : []));
	fs.mkdirSync(folder, { recursive: true });
	const file = path.join(folder, 'sleeper.test.mjs');
	fs.writeFileSync(file, SLEEPER);
	return { dir, file };
};

// why: catches a fast-lane test over 30 s fails naming the test and its time (CI-C S1)
test('a fast-lane test over 30 s fails naming the test and its time', () => {
	const { dir, file } = fixture(null);
	const r = runner(dir, ['--shards', '1', file], 500);
	const out = r.stdout + r.stderr;
	assert.notEqual(r.status, 0, out);
	const line = out.split('\n').find((l) => l.includes('the sleeping test') && /\b\d+ ms\b/.test(l) && /\b500\b/.test(l));
	assert.ok(line, out);
});

// why: catches the same test under tests/slow passes (CI-C S2)
test('the same test under tests/slow passes', () => {
	const fast = fixture(null);
	const fastRun = runner(fast.dir, ['--shards', '1', fast.file], 500);
	assert.notEqual(fastRun.status, 0, 'the fast copy must be over the cap: ' + fastRun.stdout + fastRun.stderr);
	const slow = fixture('slow');
	const slowRun = runner(slow.dir, ['--shards', '1', slow.file], 500);
	assert.equal(slowRun.status, 0, slowRun.stdout + slowRun.stderr);
});

// why: catches KIT_TEST_FAST_MS overrides the cap (CI-C S3)
test('KIT_TEST_FAST_MS overrides the cap', () => {
	const { dir, file } = fixture(null);
	const low = runner(dir, ['--shards', '1', file], 500);
	assert.notEqual(low.status, 0, 'a 500 ms cap must fail a 1.5 s test: ' + low.stdout + low.stderr);
	const high = runner(dir, ['--shards', '1', file], 5000);
	assert.equal(high.status, 0, high.stdout + high.stderr);
	const unset = runner(dir, ['--shards', '1', file]);
	assert.equal(unset.status, 0, 'with no override the 1.5 s test must pass: ' + unset.stdout + unset.stderr);
});
