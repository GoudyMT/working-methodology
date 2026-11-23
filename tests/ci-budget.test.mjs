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
import kitTemp from '../project/.claude/kit-temp.cjs';

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
	const dir = kitTemp.makeTemp('ci-budget-');
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	return dir;
}

// Writes the inputs into a fresh temp repo and runs the script there.
function run(jobs, { timings, args = [], raw, history, env = {} } = {}) {
	const dir = repo();
	const jobsFile = path.join(dir, 'jobs.json');
	fs.writeFileSync(jobsFile, raw !== undefined ? raw : JSON.stringify({ total_count: jobs.length, jobs }));
	const argv = [SCRIPT, '--jobs', jobsFile];
	// The earlier main runs, newest first, each a run-jobs answer.
	if (history !== undefined) {
		const hf = path.join(dir, 'history.json');
		fs.writeFileSync(hf, JSON.stringify(history.map((js) => ({ total_count: js.length, jobs: js }))));
		argv.push('--history', hf);
	}
	if (timings !== undefined) {
		const tf = path.join(dir, 'timings.json');
		fs.writeFileSync(tf, typeof timings === 'string' ? timings : JSON.stringify(timings));
		argv.push('--timings', tf);
	}
	const r = spawnSync(process.execPath, [...argv, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
	const logFile = path.join(dir, '.git', 'kit-guard-open.log');
	const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean) : [];
	kitTemp.removeTemp(dir); // the run's temp growth check counts a folder left behind
	return { ...r, log };
}

// why: catches a merge-path job at 181 s that is not reported over the limit with its 5 slowest tests (CI-C S1, K401)
// renamed from: a merge-path job at 181 s fails naming the job and its 5 slowest tests
test('a merge-path job at 181 s is reported over the limit with its 5 slowest tests, and the check passes', () => {
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
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	assert.match(r.stdout, /unit-tests \(2\)/);
	for (const slow of ['a.test.mjs::two', 'c.test.mjs::five', 'b.test.mjs::three', 'c.test.mjs::six', 'b.test.mjs::four']) {
		assert.ok(r.stdout.includes(slow), `the 5 slowest tests omit ${slow}: ${r.stdout}`);
	}
	for (const fast of ['a.test.mjs::one', 'c.test.mjs::seven']) {
		assert.ok(!r.stdout.includes(fast), `a test outside the 5 slowest is named: ${fast}`);
	}
	assert.match(r.stdout, /OVER unit-tests \(2\): 181 s, over the 180 s limit \(report only\)/);
	assert.ok(!/OVER lint/.test(r.stdout), 'a job inside the budget is reported over');
	// A job over the limit absent from a present timings file, and one with under 5 timed tests, are named without a crash.
	const absent = run([job('unit-tests (2)', 181)], { timings: { 'other-job': { 'a::t': 1 } } });
	assert.equal(absent.status, 0, `${absent.stdout}${absent.stderr}`);
	assert.match(absent.stdout, /unit-tests \(2\)/);
	assert.match(absent.stdout, /no per-test timings for this job/);
	const few = run([job('unit-tests (2)', 181)], { timings: { 'unit-tests (2)': { 'a::t1': 4, 'a::t2': 9 } } });
	assert.equal(few.status, 0, `${few.stdout}${few.stderr}`);
	assert.match(few.stdout, /unit-tests \(2\)/);
	assert.ok(few.stdout.includes('a::t1') && few.stdout.includes('a::t2'), `a job with 2 timed tests omits them: ${few.stdout}`);
	// Control: a job over the limit with no timings says so instead of inventing tests.
	const bare = run([job('unit-tests (2)', 181)]);
	assert.equal(bare.status, 0);
	assert.match(bare.stdout, /unit-tests \(2\)/);
	assert.match(bare.stdout, /no per-test timings for this job/);
});

// why: catches a job at 180 s passes (CI-C S1)
test('a job at 180 s passes', () => {
	const r = run([job('unit-tests (1)', 180), job('lint', 20)]);
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	assert.ok(!r.stderr.includes('unit-tests (1)'), `a job at the limit is named as a failure: ${r.stderr}`);
	assert.ok(!/OVER unit-tests/.test(r.stdout), `a job at the limit is reported over: ${r.stdout}`);
	// Control: the limit is the --limit argument, and the same job over a lower one is reported over it, report only.
	const lower = run([job('unit-tests (1)', 180)], { args: ['--limit', '179'] });
	assert.equal(lower.status, 0, `${lower.stdout}${lower.stderr}`);
	assert.match(lower.stdout, /OVER unit-tests \(1\): 180 s, over the 179 s limit \(report only\)/);
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
	const cancelled0 = () => ({ ...job('nulled-cancel', 0), conclusion: 'cancelled' });
	const cancelled = run([job('unit-tests (1)', 30), job('unit-tests (2)', 40, { conclusion: 'cancelled' })]);
	assert.equal(cancelled.status, 1, `${cancelled.stdout}${cancelled.stderr}`);
	assert.match(cancelled.stderr, /unit-tests \(2\)/);
	assert.match(cancelled.stderr, /cancel/i);
	// A skipped job is named on its own line and does not fail by itself.
	const s = run([job('unit-tests (1)', 30), skipped]);
	assert.equal(s.status, 0, `${s.stdout}${s.stderr}`);
	assert.match(`${s.stdout}${s.stderr}`, /^.*slow-lane.*skipped.*$|^.*skipped.*slow-lane.*$/im);
	// Cancelled and skipped jobs with no start or end time are named, with no crash.
	const nulls = { ...cancelled0(), started_at: null, completed_at: null };
	const n = run([job('unit-tests (1)', 30), nulls, { ...skipped, completed_at: null }]);
	assert.equal(n.status, 1, `${n.stdout}${n.stderr}`);
	assert.match(n.stderr, /nulled-cancel/);
	assert.match(`${n.stdout}${n.stderr}`, /slow-lane/);
	assert.ok(!/TypeError|at .*\.mjs:\d+/.test(n.stderr), `the script crashed: ${n.stderr}`);
	// A success job with no start or end time was never measured: it fails, named.
	const blank = run([job('unit-tests (1)', 30), { ...job('blank-success', 10), started_at: null, completed_at: null }]);
	assert.equal(blank.status, 1, `${blank.stdout}${blank.stderr}`);
	assert.match(blank.stderr, /blank-success/);
	// A job that concluded failure or timed_out fails, named, whatever its time.
	for (const conclusion of ['failure', 'timed_out']) {
		const f = run([job('unit-tests (1)', 30), job('quick-fail', 10, { conclusion })]);
		assert.equal(f.status, 1, `${conclusion}: ${f.stdout}${f.stderr}`);
		assert.match(f.stderr, /quick-fail/);
	}
	// A job that never completed fails and is named.
	const open = { ...job('release', 10), status: 'in_progress', conclusion: null, completed_at: null };
	const o = run([job('unit-tests (1)', 30), open]);
	assert.equal(o.status, 1, `${o.stdout}${o.stderr}`);
	assert.match(o.stderr, /release/);
});

// why: catches a job renamed or added to the workflow is still measured (the list comes from the run, not a fixed list) (CI-C S4)
test('a job renamed or added to the workflow is still measured (the list comes from the run, not a fixed list)', () => {
	const r = run([job('unit-tests (1)', 30), job('brand-new-job-zz9', 200), job('another renamed job', 181)]);
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	assert.match(r.stdout, /OVER brand-new-job-zz9/);
	assert.match(r.stdout, /OVER another renamed job/);
	// Control: --self leaves out the checking job itself, however long it has run, and nothing else.
	const self = run([job('budget-check', 500), job('unit-tests (1)', 30)], { args: ['--self', 'budget-check'] });
	assert.equal(self.status, 0, `${self.stdout}${self.stderr}`);
	assert.doesNotMatch(self.stdout, /budget-check/);
	const notSelf = run([job('budget-check', 500), job('unit-tests (1)', 30)], { args: ['--self', 'other'] });
	assert.match(notSelf.stdout, /OVER budget-check/);
	// --self is an exact name: a prefix of a job's name leaves that job measured.
	const prefix = run([job('budget-check', 500), job('unit-tests (1)', 30)], { args: ['--self', 'budget'] });
	assert.match(prefix.stdout, /OVER budget-check/);
	// --skip leaves a job out by name, with its matrix legs, whatever state it is in; each is named on a skipped line.
	const stuck = { ...job('minimal-code (2)', 10), status: 'in_progress', conclusion: null, completed_at: null };
	const skipRun = run(
		[
			job('unit-tests (1)', 30),
			job('minimal-code', 500),
			job('minimal-code (1)', 10, { conclusion: 'cancelled' }),
			stuck,
			job('minimal-code (3)', 900),
			job('minimal-code (4)', 181),
		],
		{ args: ['--skip', 'minimal-code'] },
	);
	assert.equal(skipRun.status, 0, `${skipRun.stdout}${skipRun.stderr}`);
	for (const name of ['minimal-code', 'minimal-code (1)', 'minimal-code (2)', 'minimal-code (3)', 'minimal-code (4)']) {
		const said = `${skipRun.stdout}${skipRun.stderr}`.split('\n').some((l) => /skipped/i.test(l) && l.includes(name));
		assert.ok(said, `${name} is not named on a skipped line: ${skipRun.stdout}`);
	}
	const extra = run([job('minimal-code-extra', 181), job('minimal-code', 500)], { args: ['--skip', 'minimal-code'] });
	assert.match(extra.stdout, /OVER minimal-code-extra/);
	// The workflow runs it: the kit-tests job fetches the run's jobs into one file and runs the check, never tolerated.
	const yml = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');
	const part = yml.split(/^  kit-tests:$/m)[1] || '';
	const kit = part.split(/^  [A-Za-z0-9_-]+:$/m)[0];
	assert.ok(kit.includes('steps:'), 'no kit-tests job in ci.yml');
	assert.match(kit, /gh api [^\n]*--paginate/);
	const line = kit.split('\n').find((l) => l.includes('scripts/ci-budget.mjs'));
	assert.ok(line, 'kit-tests never runs scripts/ci-budget.mjs');
	assert.match(line, /--jobs \S+/);
	assert.match(line, /--self kit-tests(\s|$)/);
	assert.ok(
		line.includes('node "$( [ -f "$RUNNER_TEMP/base/scripts/ci-budget.mjs" ] && echo "$RUNNER_TEMP/base/" )scripts/ci-budget.mjs" --jobs'),
		`the step does not run the base copy when it exists, in one line: ${line}`,
	);
	assert.match(line, /--skip minimal-code(\s|$)/);
	// The 1.51.3 sweep (M8): a failed fetch of the earlier main runs warns and skips the trend; it never fails the check.
	assert.match(kit, /if fetch_history; then[\s\S]*?else\s+echo "::warning::the earlier main runs could not be read/); // pin: 1 (GitHub reads the workflow line)
	// M6: the Windows step takes its slice and its count from the matrix itself, so no part can be dropped unseen.
	const win = (yml.split(/^  windows-tests:$/m)[1] || '').split(/^  [A-Za-z0-9_-]+:$/m)[0];
	assert.match(win, /PART: \$\{\{ strategy\.job-index \}\}/);
	assert.match(win, /PARTS: \$\{\{ strategy\.job-total \}\}/);
	assert.match(win, /--slice "\$PART\/\$PARTS"/);
	assert.doesNotMatch(line, /\|\|/);
	assert.doesNotMatch(kit, /continue-on-error/);
	const needs = (/^    needs: \[(.*)\]$/m.exec(kit) || [])[1];
	assert.ok(needs, 'kit-tests has no needs list');
	assert.ok(!needs.split(',').map((s) => s.trim()).includes('minimal-code'), `kit-tests needs minimal-code: ${needs}`);
});

// why: catches two runs on the same jobs JSON give the same verdict (CI-C S5)
test('two runs on the same jobs JSON give the same verdict', () => {
	const jobs = [job('unit-tests (1)', 200), job('lint', 20, { wait: 300 }), job('stopped-job', 5, { conclusion: 'cancelled' })];
	const timings = { 'unit-tests (1)': { 'a::t1': 5, 'a::t2': 9 } };
	const first = run(jobs, { timings });
	const second = run(jobs, { timings });
	assert.equal(first.status, 1, `${first.stdout}${first.stderr}`);
	assert.match(first.stdout, /OVER unit-tests \(1\)/);
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
	const mlog = path.join(dir, '.git', 'kit-guard-open.log');
	const mrows = fs.existsSync(mlog) ? fs.readFileSync(mlog, 'utf8').trim().split('\n').filter(Boolean) : [];
	assert.equal(mrows.length, 1, `expected one row for the missing file, got ${mrows.length}`);
	const mrow = JSON.parse(mrows[0]);
	assert.equal(mrow.hook, 'ci-budget');
	assert.ok(typeof mrow.cause === 'string' && mrow.cause.length > 0, 'the missing-file row names no cause');
	kitTemp.removeTemp(dir);
	// Valid JSON that measures nothing never passes: no jobs array, an empty one, a wrong type, or a short list.
	for (const raw of ['{}', '{"message":"Not Found"}', '{"jobs":"x"}', '{"jobs":[]}', JSON.stringify({ total_count: 3, jobs: [job('a', 5)] })]) {
		const r = run([], { raw });
		assert.equal(r.status, 2, `${raw}: ${r.stdout}${r.stderr}`);
		assert.equal(r.log.length, 1, `${raw}: expected one log row, got ${r.log.length}`);
		assert.ok(JSON.parse(r.log[0]).cause.length > 0, `${raw}: the row names no cause`);
	}
	// A readable run passes and logs nothing.
	const ok = run([job('unit-tests (1)', 30)]);
	assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
	assert.equal(ok.log.length, 0);
});

// why: doc claim: ci.yml gives each test-check run a budget of 60 to 120 s, inside the 180 s job budget (H2)
test('the test-check budgets, Linux slice and Windows part, fit inside the 180 s job budget', () => {
	const yml = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
	const budgets = [...yml.matchAll(/test-check\.mjs[^\n]*--budget (\d+)/g)].map((m) => Number(m[1]));
	assert.equal(budgets.length, 2, `the Linux slice and the Windows part each set a --budget, found ${JSON.stringify(budgets)}`);
	// 180 s less setup (checkout, node, the base unpack) is about 120 s; a longer budget runs past the job's own limit.
	for (const b of budgets) assert.ok(b >= 60 && b <= 120, `a test-check --budget of ${b} s is not between 60 and 120 s, so it does not fit the 180 s job budget`);
});

// K401 (the owner's yes, 2026-11-23): a job over the limit on one run is runner speed as often as a real slowdown, so the
// check reports it and passes; the same job over the limit on 3 main runs in a row is a trend, named for a list row.
// why: catches a job over the limit on 3 main runs in a row that is never named as a trend for a list row (K401)
test('a job over the limit on 3 main runs in a row is named as a trend, and 2 in a row is not', () => {
	const now = [job('windows-tests (0)', 190), job('lint', 20)];
	const over = [job('windows-tests (0)', 185), job('lint', 20)];
	const under = [job('windows-tests (0)', 120), job('lint', 20)];
	const three = run(now, { history: [over, over] });
	assert.equal(three.status, 0, `${three.stdout}${three.stderr}`);
	assert.match(three.stdout, /TREND windows-tests \(0\): over the 180 s limit on 3 main runs in a row: open a list row/); // pin: 1 (the TREND line opens a list row)
	assert.match(three.stdout, /^::warning::windows-tests \(0\) ran over the 180 s budget on 3 main runs in a row$/m); // pin: 1 (GitHub reads a ::warning:: line)
	assert.doesNotMatch(three.stdout, /TREND lint/);
	// The 1.51.3 sweep: every job over the limit is a warning on any run, a PR's included, not only a trend.
	assert.match(three.stdout, /^::warning::windows-tests \(0\) ran 190 s, over the 180 s limit$/m);
	assert.doesNotMatch(three.stdout, /::warning::lint/);
	// Two in a row is not a trend, whichever earlier run was under: the newest, or the one before it.
	for (const history of [[under, over], [over, under]]) {
		const two = run(now, { history });
		assert.equal(two.status, 0, `${two.stdout}${two.stderr}`);
		assert.doesNotMatch(two.stdout, /TREND/, `history ${history === under ? 'under' : 'mixed'}`);
	}
	// Only the 2 newest earlier runs count: a third run under the limit behind them does not break the trend.
	assert.match(run(now, { history: [over, over, under] }).stdout, /TREND windows-tests \(0\)/);
	// The 1.51.3 sweep: an earlier run whose job was cancelled or failed past the limit still counts its time.
	const cancelled = [job('windows-tests (0)', 1800, { conclusion: 'cancelled' }), job('lint', 20)];
	assert.match(run(now, { history: [cancelled, over] }).stdout, /TREND windows-tests \(0\)/);
	// A job over only in the earlier runs, or missing from one, is no trend.
	const quick = [job('windows-tests (0)', 100), job('lint', 20)];
	assert.doesNotMatch(run(quick, { history: [over, over] }).stdout, /TREND/);
	assert.doesNotMatch(run(now, { history: [[job('lint', 20)], over] }).stdout, /TREND/);
	const none = run(now);
	assert.doesNotMatch(none.stdout, /TREND/);
	// Every run prints one compact JSON line of its job times, for the totals, named by its run.
	const jsonOf = (r) => JSON.parse((r.stdout.split('\n').find((l) => l.startsWith('ci-budget-json: ')) || '').slice('ci-budget-json: '.length));
	const parsed = jsonOf(three);
	assert.equal(parsed.limit, 180);
	assert.deepEqual(parsed.jobs, { lint: 20, 'windows-tests (0)': 190 });
	assert.deepEqual(parsed.over, ['windows-tests (0)']);
	assert.deepEqual(parsed.trend, ['windows-tests (0)']);
	const ids = jsonOf(run(now, { env: { GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'abc123', GITHUB_EVENT_NAME: 'push' } }));
	assert.deepEqual([ids.run, ids.attempt, ids.sha, ids.event], ['77', '2', 'abc123', 'push']);
	const calm = jsonOf(run([job('lint', 20)]));
	assert.deepEqual([calm.over, calm.trend, calm.failed], [[], [], []]);
	// A job that failed still fails the check, named, and its time is in the JSON line's failed list.
	const failed = run([job('windows-tests (0)', 60, { conclusion: 'failure' }), job('slow-fail', 400, { conclusion: 'failure' })], { history: [over, over] });
	assert.equal(failed.status, 1, `${failed.stdout}${failed.stderr}`);
	assert.match(failed.stderr, /FAIL windows-tests \(0\): failure/);
	assert.match(failed.stderr, /FAIL slow-fail: failure/);
	assert.deepEqual(jsonOf(failed).failed, [{ name: 'slow-fail', s: 400, reason: 'failure' }, { name: 'windows-tests (0)', s: 60, reason: 'failure' }]);
});
