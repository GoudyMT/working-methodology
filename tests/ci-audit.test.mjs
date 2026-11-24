// U19 (K381): scripts/ci-audit.mjs reads run and job JSON (--runs <file> --jobs <file> [--pr-target 90]) and prints a table
// plus a last line `ci-audit-json: {...}`; these tests spawn it on the fixtures in tests/fixtures/ci-audit/ and assert on
// that line. A missing script fails each test on the exit-status assertion.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/ci-audit.mjs');
const FX = path.resolve('tests/fixtures/ci-audit');

function audit(kind, extra = []) {
	return auditRaw(kind, extra).out;
}

function auditRaw(kind, extra = []) {
	const r = spawnSync(process.execPath, [SCRIPT, '--runs', path.join(FX, `runs-${kind}.json`), '--jobs', path.join(FX, `jobs-${kind}.json`), ...extra], { encoding: 'utf8' });
	assert.equal(r.status, 0, `ci-audit exited ${r.status}: ${(r.stderr || '').slice(0, 300)}`);
	const line = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('ci-audit-json: ')).pop();
	assert.ok(line, 'stdout has no ci-audit-json line');
	return { out: JSON.parse(line.slice('ci-audit-json: '.length)), stdout: r.stdout };
}

// why: catches a job's waiting, setup or running time at p50 or p95 coming out wrong (K381 S1)
test('fixture jobs give waiting, setup and running at p50 and p95 per job', () => {
	const { out, stdout } = auditRaw('times');
	// the table prints the pattern lists it used: a setup pattern and a cause pattern
	assert.match(stdout, /checkout/i, 'setup pattern list printed');
	assert.match(stdout, /time budget/i, 'cause pattern list printed');
	const j = out.jobs;
	assert.deepEqual(j['kit-tests'].waiting, { p50: 20, p95: 30 });
	assert.deepEqual(j['kit-tests'].setup, { p50: 6, p95: 7 });
	assert.deepEqual(j['kit-tests'].running, { p50: 80, p95: 100 });
	assert.equal(j['kit-tests'].measured, 3);
	assert.equal(j['kit-tests'].notMeasured, 0);
	assert.deepEqual(j.lint.waiting, { p50: 2, p95: 3 });
	assert.deepEqual(j.lint.setup, { p50: 4, p95: 4 });
	assert.deepEqual(j.lint.running, { p50: 20, p95: 30 });
});

// why: catches the time to the required check measured from the wrong start or end (K381 S2)
test('the time to the required check runs from run start to kit-tests done', () => {
	// run start to kit-tests completed_at: 75, 106, 137 s; lint finishing earlier must not matter
	const t = audit('times');
	assert.deepEqual(t.toRequired, { p50: 106, p95: 137 });
	// merge-path time is the same series, reported against the 90 s PR target
	assert.deepEqual(t.mergePath, { targetS: 90, p50: 106, p95: 137 });
	// the run start is run_started_at (runs 11 and 12 were created long before they started), not created_at
	assert.deepEqual(audit('retry').toRequired, { p50: 30, p95: 30 });
});

// why: catches a run with attempt above 1 missing from the retried list (K381 S3)
test('a run with attempt above 1 is listed', () => {
	const retried = audit('retry').retried.map(String).sort();
	assert.deepEqual(retried, ['11', '12']);
});

// why: catches a job with no steps or no start time counted as 0 seconds (K381 S4)
test('a job with no steps or no start time is counted as not measured, never as 0', () => {
	const j = audit('unmeasured').jobs;
	for (const name of ['a', 'b']) {
		assert.equal(j[name].measured, 1, `${name} measured`);
		assert.equal(j[name].notMeasured, 1, `${name} notMeasured`);
		// one real sample only: a 0 counted in would drag p50 down to 0
		assert.deepEqual(j[name].running, { p50: 60, p95: 60 }, `${name} running`);
		assert.deepEqual(j[name].setup, { p50: 2, p95: 2 }, `${name} setup`);
		assert.deepEqual(j[name].waiting, { p50: 5, p95: 5 }, `${name} waiting`);
	}
});

// why: catches a red run given the wrong cause class or minutes to the next push (K381 CIFP)
test('fixture red runs give the right cause class and the minutes from red to the next push', () => {
	const out = audit('reds');
	const by = Object.fromEntries(out.reds.map((r) => [String(r.run), r]));
	const want = { 31: 'style or record', 32: 'code', 34: 'timing', 35: 'infra', 38: 'owed', 39: 'fails-first', 40: 'CI bug', 41: 'infra',
		42: 'CI bug', // a failed Set up job step is a setup-pattern step
		43: 'infra', // run conclusion timed_out
		44: 'style or record', 45: 'style or record', 46: 'style or record', 47: 'style or record', 48: 'style or record', 49: 'style or record', // secret, build record, scrub, words, link, map
		50: 'style or record', // two failed steps (Check names, then Run tests): the first one decides
	};
	assert.deepEqual(Object.keys(by).sort(), Object.keys(want).sort(), 'only red runs are listed');
	for (const [id, cause] of Object.entries(want)) assert.equal(by[id].cause, cause, `run ${id} cause`);
	assert.equal(by[31].minutesToNextPush, 12);
	assert.equal(by[32].minutesToNextPush, 5);
	// a rerun on the same head_sha is not a next push: 35 goes to run 37 (head F) at 9 min, not run 36
	assert.equal(by[35].minutesToNextPush, 9);
	assert.ok(by[34].minutesToNextPush == null, 'no later push on that branch: no minutes');
	// merge-path time is reported against the PR target: 90 s by default, --pr-target overrides
	assert.equal(out.mergePath.targetS, 90);
	assert.equal(audit('reds', ['--pr-target', '45']).mergePath.targetS, 45);
});
