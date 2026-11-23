// U8 (CI-C): the merge-path time budget, enforced in the required check. scripts/ci-budget.mjs reads GitHub's run-jobs
// answer (--jobs), measures every job in it except --self, and fails any job over --limit (default 180 s) naming the job
// and its 5 slowest tests from the optional --timings. Queue wait is not counted. Exit 0 pass, 1 a failure, 2 an
// unreadable --jobs or --timings, which also appends a row to <git common dir>/kit-guard-open.log (fail closed).
// The script runs in a temp git repo with hand-written jobs JSON, so a missing script fails each test on an assertion.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/ci-budget.mjs');
const T0 = Date.parse('2026-01-01T00:00:00Z');
const iso = (sec) => new Date(T0 + sec * 1000).toISOString();

// A completed job: queued at `queued` s, started `wait` s later, ran for `ran` s.
const job = (name, ran, { wait = 5, conclusion = 'success', queued = 0 } = {}) => ({
	name,
	status: 'completed',
	conclusion,
	created_at: iso(queued),
	started_at: iso(queued + wait),
	completed_at: iso(queued + wait + ran),
});

function repo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-budget-'));
	spawnSync('git', ['init', '-q'], { cwd: dir });
	return dir;
}

// Writes the inputs into a fresh temp repo and runs the script there.
function run(jobs, { timings, args = [], raw } = {}) {
	const dir = repo();
	const jobsFile = path.join(dir, 'jobs.json');
	fs.writeFileSync(jobsFile, raw !== undefined ? raw : JSON.stringify({ total_count: jobs.length, jobs }));
	const argv = [SCRIPT, '--jobs', jobsFile];
	if (timings !== undefined) {
		const tf = path.join(dir, 'timings.json');
		fs.writeFileSync(tf, typeof timings === 'string' ? timings : JSON.stringify(timings));
		argv.push('--timings', tf);
	}
	const r = spawnSync(process.execPath, [...argv, ...args], { cwd: dir, encoding: 'utf8' });
	const logFile = path.join(dir, '.git', 'kit-guard-open.log');
	const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean) : [];
	return { ...r, dir, log };
}

// why: catches a merge-path job at 181 s fails naming the job and its 5 slowest tests (CI-C S1)
test('a merge-path job at 181 s fails naming the job and its 5 slowest tests', () => {
	const r = run([job('unit-tests (2)', 181), job('lint', 20)], {
		timings: {
			'unit-tests (2)': {
				'a.test.mjs::one': 1000,
				'a.test.mjs::two': 9000,
				'b.test.mjs::three': 7000,
				'b.test.mjs::four': 3000,
				'c.test.mjs::five': 8000,
				'c.test.mjs::six': 5000,
				'c.test.mjs::seven': 2000,
			},
		},
	});
	assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
	assert.match(r.stderr, /unit-tests \(2\)/);
	for (const slow of ['a.test.mjs::two', 'c.test.mjs::five', 'b.test.mjs::three', 'c.test.mjs::six', 'b.test.mjs::four']) {
		assert.ok(r.stderr.includes(slow), `the 5 slowest tests omit ${slow}: ${r.stderr}`);
	}
	for (const fast of ['a.test.mjs::one', 'c.test.mjs::seven']) {
		assert.ok(!r.stderr.includes(fast), `a test outside the 5 slowest is named: ${fast}`);
	}
	assert.ok(!r.stderr.includes('lint'), 'a job inside the budget is named as a failure');
	// Control: a failing job with no timings says so instead of inventing tests.
	const bare = run([job('unit-tests (2)', 181)]);
	assert.equal(bare.status, 1);
	assert.match(bare.stderr, /unit-tests \(2\)/);
	assert.match(bare.stderr, /no per-test timings for this job/);
});

// why: catches a job at 180 s passes (CI-C S1)
test('a job at 180 s passes', () => {
	const r = run([job('unit-tests (1)', 180), job('lint', 20)]);
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	assert.ok(!r.stderr.includes('unit-tests (1)'), `a job at the limit is named as a failure: ${r.stderr}`);
	// Control: the limit is the --limit argument, and the same job over a lower one fails at the line.
	const lower = run([job('unit-tests (1)', 180)], { args: ['--limit', '179'] });
	assert.equal(lower.status, 1, `${lower.stdout}${lower.stderr}`);
	assert.match(lower.stderr, /unit-tests \(1\)/);
});

// why: catches queue wait is not counted, and the report says so (CI-C S2)
test('queue wait is not counted, and the report says so', () => {
	// 100 s of work after a 900 s wait for a runner: the wall time since creation is 1000 s, the job's time is 100 s.
	const r = run([job('unit-tests (3)', 100, { wait: 900 })]);
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	assert.match(r.stdout, /queue wait is not counted/);
	assert.ok(!r.stderr.includes('unit-tests (3)'), `a long queue wait failed the job: ${r.stderr}`);
});

// why: catches a cancelled or skipped job is named, never passed silently (CI-C S3)
test('a cancelled or skipped job is named, never passed silently', () => {
	const skipped = { ...job('slow-lane', 0), conclusion: 'skipped', started_at: null };
	const cancelled = run([job('unit-tests (1)', 30), job('unit-tests (2)', 40, { conclusion: 'cancelled' })]);
	assert.equal(cancelled.status, 1, `${cancelled.stdout}${cancelled.stderr}`);
	assert.match(cancelled.stderr, /unit-tests \(2\)/);
	assert.match(cancelled.stderr, /cancel/i);
	// A skipped job is named on its own line and does not fail by itself.
	const s = run([job('unit-tests (1)', 30), skipped]);
	assert.equal(s.status, 0, `${s.stdout}${s.stderr}`);
	assert.match(`${s.stdout}${s.stderr}`, /^.*slow-lane.*skipped.*$|^.*skipped.*slow-lane.*$/im);
	// A job that never completed fails and is named.
	const open = { ...job('release', 10), status: 'in_progress', conclusion: null, completed_at: null };
	const o = run([job('unit-tests (1)', 30), open]);
	assert.equal(o.status, 1, `${o.stdout}${o.stderr}`);
	assert.match(o.stderr, /release/);
});

// why: catches a job renamed or added to the workflow is still measured (the list comes from the run, not a fixed list) (CI-C S4)
test('a job renamed or added to the workflow is still measured (the list comes from the run, not a fixed list)', () => {
	const r = run([job('unit-tests (1)', 30), job('brand-new-job-zz9', 200), job('another renamed job', 181)]);
	assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
	assert.match(r.stderr, /brand-new-job-zz9/);
	assert.match(r.stderr, /another renamed job/);
	// Control: --self leaves out the checking job itself, however long it has run, and nothing else.
	const self = run([job('budget-check', 500), job('unit-tests (1)', 30)], { args: ['--self', 'budget-check'] });
	assert.equal(self.status, 0, `${self.stdout}${self.stderr}`);
	const notSelf = run([job('budget-check', 500), job('unit-tests (1)', 30)], { args: ['--self', 'other'] });
	assert.equal(notSelf.status, 1, `${notSelf.stdout}${notSelf.stderr}`);
	assert.match(notSelf.stderr, /budget-check/);
});

// why: catches two runs on the same jobs JSON give the same verdict (CI-C S5)
test('two runs on the same jobs JSON give the same verdict', () => {
	const jobs = [job('unit-tests (1)', 200), job('lint', 20, { wait: 300 }), job('stopped-job', 5, { conclusion: 'cancelled' })];
	const timings = { 'unit-tests (1)': { 'a::t1': 5, 'a::t2': 9 } };
	const first = run(jobs, { timings });
	const second = run(jobs, { timings });
	assert.equal(first.status, 1, `${first.stdout}${first.stderr}`);
	assert.match(first.stderr, /unit-tests \(1\)/);
	assert.match(first.stderr, /stopped-job/);
	assert.match(first.stdout, /queue wait is not counted/);
	assert.equal(second.status, first.status);
	assert.equal(second.stdout, first.stdout);
	assert.equal(second.stderr, first.stderr);
	// Control: the same jobs in another order are the same verdict.
	const flipped = run([...jobs].reverse(), { timings });
	assert.equal(flipped.status, first.status);
});

// why: catches an unreadable jobs API answer fails the check and is logged (CI-C S6)
test('an unreadable jobs API answer fails the check and is logged', () => {
	const bad = run([], { raw: '<html>502 Bad Gateway</html>' });
	assert.equal(bad.status, 2, `${bad.stdout}${bad.stderr}`);
	assert.equal(bad.log.length, 1, `expected one row in kit-guard-open.log, got ${bad.log.length}`);
	const row = JSON.parse(bad.log[0]);
	assert.equal(row.hook, 'ci-budget');
	assert.ok(typeof row.cause === 'string' && row.cause.length > 0, 'the log row names no cause');
	assert.ok(!Number.isNaN(Date.parse(row.at)), `the log row has no time: ${row.at}`);
	// Control: an unreadable --timings and a missing --jobs file fail closed the same way.
	const badTimings = run([job('unit-tests (1)', 30)], { timings: 'not json{' });
	assert.equal(badTimings.status, 2, `${badTimings.stdout}${badTimings.stderr}`);
	assert.equal(badTimings.log.length, 1);
	const dir = repo();
	const missing = spawnSync(process.execPath, [SCRIPT, '--jobs', path.join(dir, 'nope.json')], { cwd: dir, encoding: 'utf8' });
	assert.equal(missing.status, 2, `${missing.stdout}${missing.stderr}`);
	// A readable run passes and logs nothing.
	const ok = run([job('unit-tests (1)', 30)]);
	assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
	assert.equal(ok.log.length, 0);
});
