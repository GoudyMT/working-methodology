// The 30 s cap on a fast-lane test (CI-C): a test over the cap is reported with its name and time, unless it sits under
// tests/slow; from K401 it never fails the run. KIT_TEST_FAST_MS sets the cap, so each fixture sleeps 1.5 s against 500 ms.
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

// why: catches a fast-lane test over 30 s that is not reported with its name and time, or that fails the run (CI-C S1, K401)
// renamed from: a fast-lane test over 30 s fails naming the test and its time
test('a fast-lane test over 30 s is reported with its name and time, and the run passes', () => {
	const { dir, file } = fixture(null);
	const r = runner(dir, ['--shards', '1', file], 500);
	const out = r.stdout + r.stderr;
	// K401 (the owner's yes, 2026-11-23): runner speed alone failed 7 of PR 71's 29 reds, so the cap reports, never fails.
	assert.equal(r.status, 0, out);
	assert.match(out, /over the cap \(report only\)/);
	const line = out.split('\n').find((l) => l.includes('the sleeping test') && /\b\d+ ms\b/.test(l) && /\b500\b/.test(l));
	assert.ok(line, out);
	const times = [...line.matchAll(/\b(\d+) ms\b/g)].map((m) => Number(m[1]));
	assert.ok(times.some((t) => t >= 1500), `no time of 1500 ms or more on: ${line}`);
	// The cap line is on stderr too (the sweep's M13), so a run's error output names its slow tests beside any failure.
	assert.ok(r.stderr.split('\n').some((l) => l.includes('the sleeping test') && /\b500\b/.test(l)), `no cap line on stderr: ${r.stderr}`);
	// A traced run (--map) measures every test and is not held to the cap (M12): the same test passes there, so a main
	// push still writes its map.
	const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
	fs.writeFileSync(path.join(dir, '.gitignore'), 'tests/.map*.json\n');
	git('init', '-q', '-b', 'main'); git('add', '.');
	git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
	const traced = runner(dir, ['--map', '--shards', '1', file], 500);
	assert.equal(traced.status, 0, 'a --map run must not apply the fast cap: ' + traced.stdout + traced.stderr);
	// The 1.51.3 sweep: the cap never fails a run now, so the exit alone shows nothing; a --map run prints no cap line.
	assert.doesNotMatch(traced.stdout + traced.stderr, /over the cap/, 'a --map run reported the fast cap');
});

// why: catches the same test under tests/slow reported over the fast-lane cap (CI-C S2)
// renamed from: the same test under tests/slow passes
test('the same test under tests/slow passes with no cap report', () => {
	const fast = fixture(null);
	const fastRun = runner(fast.dir, ['--shards', '1', fast.file], 500);
	assert.match(fastRun.stdout + fastRun.stderr, /over the cap/, 'the fast copy must be over the cap: ' + fastRun.stdout + fastRun.stderr);
	const slow = fixture('slow');
	const slowRun = runner(slow.dir, ['--shards', '1', slow.file], 500);
	assert.equal(slowRun.status, 0, slowRun.stdout + slowRun.stderr);
	assert.doesNotMatch(slowRun.stdout + slowRun.stderr, /over the cap/);
});

// why: catches KIT_TEST_FAST_MS overrides the cap (CI-C S3)
test('KIT_TEST_FAST_MS overrides the cap', () => {
	const { dir, file } = fixture(null);
	const low = runner(dir, ['--shards', '1', file], 500);
	assert.match(low.stdout + low.stderr, /over the cap/, 'a 500 ms cap must report a 1.5 s test: ' + low.stdout + low.stderr);
	const high = runner(dir, ['--shards', '1', file], 5000);
	assert.equal(high.status, 0, high.stdout + high.stderr);
	assert.doesNotMatch(high.stdout + high.stderr, /over the cap/);
	assert.match(high.stdout + high.stderr, /fast-lane cap 5000 ms/);
	const unset = runner(dir, ['--shards', '1', file]);
	assert.equal(unset.status, 0, 'with no override the 1.5 s test must pass: ' + unset.stdout + unset.stderr);
	assert.doesNotMatch(unset.stdout + unset.stderr, /over the cap/, 'a 1.5 s test is over the 30 s default cap');
	assert.match(unset.stdout + unset.stderr, /fast-lane cap 30000 ms/);
});
