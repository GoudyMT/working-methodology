// K399 U21: the CI state file and ci-fix.mjs, the only way to clear a red; closeout.mjs backstop; ci-wait's early red.
// Each test builds a small git repo in a temp folder and runs the tools by path. gh is never called: ci-wait takes an
// injected gh that serves the fixture jobs and logs under tests/fixtures/ci-logs/. A missing tool gives a failing
// status here, never a crash.
// Fixture contract: jobs.json is the GitHub jobs API shape; each failed job's log is the file its "log" field names.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { ciWait } from '../project/.claude/ci-wait.mjs';
import { gateLine } from '../user/kit-tools/ci-digest.mjs';

kitTemp.sessionRoot();
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CIFIX = path.join(KIT, 'user', 'kit-tools', 'ci-fix.mjs');
const CLOSEOUT = path.join(KIT, 'user', 'kit-tools', 'closeout.mjs');
const FIX = path.join(KIT, 'tests', 'fixtures', 'ci-logs');
const VERSION = '1.2.0';
const SIX = 'repair the parser so the edge passes';
const SHA = 'a'.repeat(40);

const git = (root, ...args) => {
	const r = spawnSync('git', ['-c', 'user.name=Owner Test', '-c', 'user.email=owner@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};
const commit = (root, msg) => { git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', msg); };
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const run = (script, args, cwd, extra = {}) => {
	if (!fs.existsSync(script)) return { status: 127, stdout: '', stderr: `${path.basename(script)} is missing` };
	const env = { ...process.env, ...extra };
	delete env.KIT_RECORD_ROOT;
	const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env });
	return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};
const cifix = (root, ...args) => run(CIFIX, args, root);
const stateFile = (root) => path.join(root, '.git', 'kit-ci-state.json');
const logLines = (root) => {
	const f = path.join(root, '.git', 'kit-guard-open.log');
	return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const cifixLines = (root) => {
	const f = path.join(root, 'docs', 'builds', `${VERSION}.cifix.jsonl`);
	return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

const cifixWith = (env, root, ...args) => run(CIFIX, args, root, env);
// Session ids are plain UUIDs; a pop-up is read only from a session that has one.
const SESSION = '5f1c2d3e-4a5b-4c6d-8e7f-900112233445';
const SESSION_2 = '6a2d3e4f-5b6c-4d7e-9f80-a11223344556';
const SESSION_3 = '7b3e4f50-6c7d-4e8f-8091-b22334455667';
// The proof ci-fix.mjs records in a line whose grant is a pop-up id: the session, the pop-up's id, the act it quoted, its time.
function proofFor(id, act) { return { session: SESSION, id, act, at: Date.parse(ANSWER_AT) }; }
// The time every fixture pop-up is answered at (fresh for the run), so a proof's at can equal the answer time.
const ANSWER_AT = new Date().toISOString();
// The session transcript of a repo, where the owner's answered pop-up is (owner-yes.cjs reads it from the Claude folder).
const slugOf = (root) => fs.realpathSync.native(root).replace(/[^A-Za-z0-9]/g, '-');
// An answered pop-up quoting `act` in one code span, accepted by the user, in session sid; returns the env that reads it.
// One pop-up: the ask and its accepted answer, under askId, with the question text and the answer given.
const popUp = (askId, question, answer, at) => {
	const questions = [{ question, header: 'Owner yes', multiSelect: false, options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] }];
	return [
		{ type: 'assistant', isSidechain: false, timestamp: at, message: { content: [{ type: 'tool_use', id: askId, name: 'AskUserQuestion', input: { questions } }] } },
		{ type: 'user', isSidechain: false, timestamp: at, permissionDecision: { decision: 'accept', source: 'user_temporary' }, toolUseResult: { questions, answers: { [question]: answer } }, message: { content: [{ type: 'tool_result', tool_use_id: askId, content: 'answered' }] } },
	];
};
// The answered pop-up(s) in session sid. The first quotes `act` (or the given question) and gets `answer`; `then` adds later
// pop-ups in order, each {question, answer}, so the latest answer is the one that counts.
function answeredYes(root, sid, act, { question = `May I run \`${act}\`?`, answer = 'Yes', then = [] } = {}) {
	const home = kitTemp.makeTemp('cifix-yes-home-');
	const file = path.join(home, 'projects', slugOf(root), `${sid}.jsonl`);
	const at = ANSWER_AT;
	const lines = [...popUp('toolu_ask_owner', question, answer, at), ...then.flatMap((t, k) => popUp(`toolu_ask_later_${k}`, t.question, t.answer, at))];
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	return { CLAUDE_CONFIG_DIR: home, CLAUDE_CODE_SESSION_ID: sid };
}
// A fake gh first on PATH (a copy of node under the gh name, whose preload runs only under that name): it records each call
// in CI_FIX_GH_CALLS and answers the jobs read and the failed-job log from CI_FIX_FIXTURES, as the digest reads them.
const GH_PRELOAD = `const path = require('node:path');
const fs = require('node:fs');
if (/^gh(\\.exe)?$/i.test(path.basename(process.execPath))) {
	const a = [path.basename(process.argv[1]), ...process.argv.slice(2)];
	fs.appendFileSync(process.env.CI_FIX_GH_CALLS, JSON.stringify(a) + '\\n');
	const dir = process.env.CI_FIX_FIXTURES;
	const jobs = JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8')).jobs;
	if (a[0] === 'run' && a[1] === 'view' && a[a.indexOf('--json') + 1] === 'jobs') { process.stdout.write(JSON.stringify({ jobs: jobs.map((j) => ({ ...j, databaseId: j.id })) })); process.exit(0); }
	if (a[0] === 'run' && a[1] === 'view' && a.includes('--job')) { const j = jobs.find((x) => x.id === Number(a[a.indexOf('--job') + 1])); process.stdout.write(j && j.log ? fs.readFileSync(path.join(dir, j.log), 'utf8') : ''); process.exit(0); }
	process.stderr.write('unexpected gh call\\n');
	process.exit(1);
}
`;
let GH_DIR = null;
function fakeGhPath(callsFile) {
	if (!GH_DIR) {
		const dir = kitTemp.makeTemp('cifix-gh-');
		const exe = path.join(dir, process.platform === 'win32' ? 'gh.exe' : 'gh');
		try { fs.linkSync(process.execPath, exe); } catch { fs.copyFileSync(process.execPath, exe); }
		fs.writeFileSync(path.join(dir, 'gh-pre.cjs'), GH_PRELOAD);
		process.on('exit', () => kitTemp.removeTemp(dir));
		GH_DIR = dir;
	}
	return { PATH: GH_DIR + path.delimiter + (process.env.PATH || ''), NODE_OPTIONS: `--require ${path.join(GH_DIR, 'gh-pre.cjs').split(path.sep).join('/')}`, CI_FIX_GH_CALLS: callsFile, CI_FIX_FIXTURES: FIX };
}

const ITEM_TEST = { n: 1, key: 'unit-tests (0)::fails thing', shape: 'test', job: 'unit-tests (0)', step: 'Run tests', file: 'tests/foo.test.mjs', line: 12, name: 'fails thing', message: 'expected 2 got 3', kind: 'diagnose' };
const ITEM_GATE = { n: 2, key: 'windows-tests::fast-cap', shape: 'gate', job: 'windows-tests', step: 'Run tests', file: 'scripts/test-run.mjs', line: 48, name: 'fast-cap', message: 'over the cap: 42940 ms (cap 30000 ms)', kind: 'diagnose' };
const ITEMS = [ITEM_TEST, ITEM_GATE];

/** A repo whose HEAD has a red CI state; prior cifix lines are committed first so the state's sha is HEAD. */
function mkRepo({ items = ITEMS, run: runId = 200, prior, state } = {}) {
	const root = kitTemp.makeTemp('cifix-');
	git(root, 'init', '-q', '-b', 'main');
	write(root, 'VERSION', `${VERSION}\n`);
	write(root, 'src/a.mjs', '// a\n');
	write(root, 'src/b.mjs', '// b\n');
	write(root, 'tests/foo.test.mjs', '// foo\n');
	write(root, 'tests/other.test.mjs', '// other\n');
	write(root, '.github/workflows/ci.yml', 'name: ci\n');
	write(root, 'scripts/setup.mjs', '// setup\n');
	if (prior) write(root, `docs/builds/${VERSION}.cifix.jsonl`, prior.map((l) => JSON.stringify(l)).join('\n') + '\n');
	commit(root, 'base');
	const head = git(root, 'rev-parse', 'HEAD');
	if (state !== null) write(root, '.git/kit-ci-state.json', typeof state === 'string' ? state : JSON.stringify({ sha: head, run: runId, verdict: 'red', settled: true, failed: items, at: new Date().toISOString(), ...state }));
	return root;
}

const fixtureJobs = () => JSON.parse(fs.readFileSync(path.join(FIX, 'jobs.json'), 'utf8'));
const digest = (cwd, jobsFile = path.join(FIX, 'jobs.json'), logsDir = FIX) => {
	const r = cifix(cwd, 'digest', '--jobs', jobsFile, '--logs', logsDir);
	let out = null;
	try { out = JSON.parse(r.stdout); } catch { /* the assertion below says so */ }
	return { r, out };
};
const inJob = (out, job) => out.items.filter((i) => i.job === job);

/**
 * The injected gh of ci-wait: `run list` from script.runs(poll); `run view <run> -R <repo> --json jobs` from script.jobs(poll);
 * `run view <run> -R <repo> --log-failed --job <id>` from the fixture logs. Every call is recorded in fn.calls.
 */
function fakeGh(script) {
	let polls = 0;
	const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
	const fn = (args) => {
		fn.calls.push(args);
		if (args[0] !== 'run') return { status: 1, stdout: '', stderr: `unexpected gh call: ${args.join(' ')}` };
		if (args[1] === 'list') return ok(JSON.stringify(script.runs(polls++)));
		if (args[1] === 'view' && args[args.indexOf('--json') + 1] === 'jobs') {
			const jobs = script.jobs(polls).jobs.map((x) => ({ ...x, databaseId: x.id }));
			return ok(JSON.stringify({ jobs }));
		}
		if (args[1] === 'view' && args.includes('--job')) {
			const job = fixtureJobs().jobs.find((x) => x.id === Number(args[args.indexOf('--job') + 1]));
			return ok(job?.log ? fs.readFileSync(path.join(FIX, job.log), 'utf8') : '');
		}
		return { status: 1, stdout: '', stderr: `unexpected gh call: ${args.join(' ')}` };
	};
	fn.calls = [];
	return fn;
}
const runOf = (status, conclusion) => ({ databaseId: 555, name: 'CI', status, conclusion: status === 'completed' ? conclusion : null, url: 'https://example.test/run/555' });
async function waitWith(opts, gh) {
	let clock = 0;
	const lines = [];
	const res = await ciWait({ commit: SHA, repo: 'o/r', every: 15, max: 60, ...opts }, {
		gh, sleep: async (ms) => { clock += ms; }, now: () => clock, log: (l) => lines.push(l),
	});
	return { ...res, lines };
}
const readState = (common) => {
	const f = path.join(common, 'kit-ci-state.json');
	return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const earlyJobs = () => {
	const all = fixtureJobs();
	all.jobs = all.jobs.map((j) => (j.id === 101 || j.conclusion === 'success' ? j : { ...j, status: 'in_progress', conclusion: null, log: undefined, steps: [] }));
	return all;
};

// why: catches ci-wait writes `<git common>/kit-ci-state.json` {sha, run, verdict, failed[{key, kind}], at} when a run ends (K399 S1)
test('ci-wait writes `<git common>/kit-ci-state.json` {sha, run, verdict, failed[{key, kind}], at} when a run ends', async () => {
	const red = fakeGh({ runs: () => [runOf('completed', 'failure')], jobs: () => fixtureJobs() });
	const common = kitTemp.makeTemp('cw-common-');
	const res = await waitWith({ common }, red);
	assert.equal(res.code, 1);
	const s = readState(common);
	assert.ok(s, 'ci-wait wrote kit-ci-state.json in the git common folder');
	assert.equal(s.sha, SHA);
	assert.equal(s.run, 555);
	assert.equal(s.verdict, 'red');
	assert.ok(!Number.isNaN(Date.parse(s.at)), 'at is a date');
	const byKey = new Map(s.failed.map((f) => [f.key, f.kind]));
	assert.equal(byKey.get('unit-tests (0)::fast cap names the slow test'), 'diagnose');
	assert.equal(byKey.size, 10);
	// control: a green run writes a green state with nothing failed
	const gcommon = kitTemp.makeTemp('cw-common-');
	const green = fakeGh({ runs: () => [runOf('completed', 'success')], jobs: () => ({ total_count: 0, jobs: [] }) });
	assert.equal((await waitWith({ common: gcommon }, green)).code, 0);
	const g = readState(gcommon);
	assert.ok(g, 'a green run also writes the state');
	assert.equal(g.verdict, 'green');
	assert.deepEqual(g.failed, []);
	// unreadable jobs leave a provisional, unsettled state: never a settled red with an empty failed list
	const unreadable = fakeGh({ runs: () => [runOf('completed', 'failure')], jobs: () => fixtureJobs() });
	const garbled = (args) => (args[0] === 'run' && args[1] === 'view' ? { status: 0, stdout: 'not json', stderr: '' } : unreadable(args));
	const ucommon = kitTemp.makeTemp('cw-unreadable-');
	await waitWith({ common: ucommon }, garbled);
	const u = readState(ucommon);
	assert.ok(u, 'a state is written when the jobs are unreadable');
	assert.equal(u.settled, false, 'the state is provisional and unsettled');
	assert.ok(!(u.verdict === 'red' && u.failed.length === 0), 'no settled red with an empty failed list');
	// jobs that read fine but digest to no items (only the rollup job failed) stay provisional and unsettled
	const rollupOnly = fakeGh({ runs: () => [runOf('completed', 'failure')], jobs: () => ({ total_count: 1, jobs: [{ id: 300, name: 'kit-tests', status: 'completed', conclusion: 'failure', steps: [] }] }) });
	const rcommon = kitTemp.makeTemp('cw-rollup-');
	await waitWith({ common: rcommon }, rollupOnly);
	const rs = readState(rcommon);
	assert.ok(rs, 'a state is written when only the rollup job failed');
	assert.equal(rs.settled, false, 'the state is unsettled, not a settled red');
	assert.ok(!(rs.verdict === 'red' && rs.failed.length === 0), 'no settled red with an empty failed list');
});

// why: catches `ci-fix.mjs list` prints the red run's failing items, numbered, with the log line for each (K399 S2)
test('`ci-fix.mjs list` prints the red run\'s failing items, numbered, with the log line for each', () => {
	const root = mkRepo();
	const r = cifix(root, 'list');
	assert.equal(r.status, 0, r.stderr);
	for (const it of ITEMS) {
		assert.ok(r.stdout.includes(it.key), `the list names ${it.key}`);
		assert.ok(r.stdout.includes(it.message), `the list shows the log line of ${it.key}`);
		assert.match(r.stdout, new RegExp(`^\\s*${it.n}\\b.*${it.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'), `item ${it.n} is numbered with its key on one line`);
	}
});

// why: catches `diagnose` refuses an item not in the run's failed list (K399 S2)
test('`diagnose` refuses an item not in the run\'s failed list', () => {
	const root = mkRepo();
	for (const n of ['9', '0', 'x']) {
		const r = cifix(root, 'diagnose', n, '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs');
		assert.equal(r.status, 1, `item ${n}: ${r.stdout}`);
		assert.notEqual(r.stderr.trim(), '');
	}
	assert.deepEqual(cifixLines(root), []);
	assert.ok(logLines(root).some((l) => l.hook === 'ci-fix' && typeof l.cause === 'string' && l.cause !== ''), 'the refusal is logged by hook ci-fix');
	// a state for another commit than HEAD is no run of this head: refused too
	const old = mkRepo({ state: { sha: 'b'.repeat(40) } });
	assert.equal(cifix(old, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs').status, 1);
	assert.deepEqual(cifixLines(old), []);
	// control: an item in the list is taken
	const ok = cifix(root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs');
	assert.equal(ok.status, 0, ok.stderr);
});

// why: catches `--cause code` refuses a test file; `pin` allows only that test's own file; `env` only CI or setup files (K399 S2)
test('`--cause code` refuses a test file; `pin` allows only that test\'s own file; `env` only CI or setup files', () => {
	const root = mkRepo();
	const refuse = (n, cause, files) => {
		const r = cifix(root, 'diagnose', String(n), '--cause', cause, '--fix', SIX, '--files', files);
		assert.equal(r.status, 1, `${cause} ${files} should be refused: ${r.stdout}`);
	};
	refuse(1, 'code', 'tests/foo.test.mjs');
	refuse(1, 'code', 'src/a.mjs,tests/foo.test.mjs');
	refuse(1, 'pin', 'tests/other.test.mjs');
	refuse(1, 'pin', 'src/a.mjs');
	refuse(1, 'pin', 'tests/foo.test.mjs,src/a.mjs');
	refuse(2, 'env', 'src/a.mjs');
	refuse(2, 'env', 'tests/foo.test.mjs');
	refuse(1, 'guess', 'src/a.mjs');
	assert.deepEqual(cifixLines(root), []);
	// control: each allowed pairing is taken, one fresh repo each
	const pin = cifix(mkRepo(), 'diagnose', '1', '--cause', 'pin', '--fix', SIX, '--files', 'tests/foo.test.mjs');
	assert.equal(pin.status, 0, pin.stderr);
	const code = cifix(mkRepo(), 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs,src/b.mjs');
	assert.equal(code.status, 0, code.stderr);
	for (const files of ['.github/workflows/ci.yml', 'scripts/setup.mjs']) {
		const env = cifix(mkRepo(), 'diagnose', '2', '--cause', 'env', '--fix', SIX, '--files', files);
		assert.equal(env.status, 0, `${files}: ${env.stderr}`);
	}
});

// why: catches a fix of under 6 words is refused; each line goes to `docs/builds/<version>.cifix.jsonl` (K399 S2)
test('a fix of under 6 words is refused; each line goes to `docs/builds/<version>.cifix.jsonl`', () => {
	const root = mkRepo();
	for (const fix of ['fix it', 'fix it now please ok']) {
		const r = cifix(root, 'diagnose', '1', '--cause', 'code', '--fix', fix, '--files', 'src/a.mjs');
		assert.equal(r.status, 1, `"${fix}" is under 6 words: ${r.stdout}`);
	}
	assert.deepEqual(cifixLines(root), []);
	const ok = cifix(root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs');
	assert.equal(ok.status, 0, ok.stderr);
	assert.ok(ok.stdout.includes(`fails thing: code, ${SIX}`), `the one line for the owner: ${ok.stdout}`);
	const lines = cifixLines(root);
	assert.equal(lines.length, 1);
	assert.deepEqual({ run: lines[0].run, key: lines[0].key, cause: lines[0].cause, fix: lines[0].fix, files: lines[0].files, attempt: lines[0].attempt },
		{ run: 200, key: 'unit-tests (0)::fails thing', cause: 'code', fix: SIX, files: ['src/a.mjs'], attempt: 1 });
});

// why: catches a second diagnose on an item diagnosed in an earlier run is refused unless a grant id is given (K399 S3)
test('a second diagnose on an item diagnosed in an earlier run is refused unless a grant id is given', () => {
	const earlier = { run: 100, key: ITEM_TEST.key, cause: 'code', fix: SIX, files: ['src/a.mjs'], attempt: 1 };
	const root = mkRepo({ prior: [earlier], run: 200 });
	const before = fs.readFileSync(path.join(root, 'docs', 'builds', `${VERSION}.cifix.jsonl`), 'utf8');
	const no = cifix(root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs');
	assert.equal(no.status, 1, no.stdout);
	assert.equal(fs.readFileSync(path.join(root, 'docs', 'builds', `${VERSION}.cifix.jsonl`), 'utf8'), before, 'a refusal writes nothing');
	assert.ok(logLines(root).some((l) => l.hook === 'ci-fix'), 'the refusal is logged');
	// an item diagnosed in no earlier run is still taken as attempt 1
	const other = cifix(root, 'diagnose', '2', '--cause', 'env', '--fix', SIX, '--files', 'scripts/setup.mjs');
	assert.equal(other.status, 0, other.stderr);
	// attempt 2 needs a grant that is the owner's accepted pop-up quoting the item's code: a made-up grant id is refused
	const made = cifix(root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs', '--grant', 'g-41');
	assert.equal(made.status, 1, `a made-up grant id is refused: ${made.stdout}`);
	assert.equal(cifixLines(root).filter((l) => l.key === ITEM_TEST.key).length, 1, 'a refused grant writes no line');
	// with the owner's pop-up quoting the item's key in an accepted answer, the answer's id is the grant: attempt 2
	const env = answeredYes(root, SESSION, ITEM_TEST.key);
	const yes = cifixWith(env, root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs', '--grant', 'toolu_ask_owner');
	assert.equal(yes.status, 0, yes.stderr);
	const again = cifixLines(root).filter((l) => l.key === ITEM_TEST.key);
	assert.equal(again.length, 2);
	assert.equal(again[1].attempt, 2);
	assert.equal(again[1].grant, 'toolu_ask_owner');
	// the attempt-2 pop-up is read by owner-yes.cjs's rules: the grant id is spent once, and a Yes to a longer span is refused
	const reuse = cifixWith(answeredYes(root, SESSION_2, ITEM_TEST.key), root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs', '--grant', 'toolu_ask_owner');
	assert.equal(reuse.status, 1, `a grant id already used for an attempt-2 line is refused: ${reuse.stdout}`);
	const longRoot = mkRepo({ prior: [earlier], run: 200 });
	const longSpan = cifixWith(answeredYes(longRoot, SESSION_3, `${ITEM_TEST.key} extra`), longRoot, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs', '--grant', 'toolu_ask_owner');
	assert.equal(longSpan.status, 1, `a Yes to a span longer than the item's key is refused: ${longSpan.stdout}`);
});

// A fixture test file whose first test holds the base timeout: line, for the timeout: rewrite and removal pins.
const T_OLD = `import { test } from './harness.mjs';\n\n// why: catches one in a fixture file\ntest('one', { timeout: 1000 }, () => {});\n\n// why: catches two in a fixture file\ntest('two', () => {});\n`;
// A fixture test file with two timeout: lines, for the pin that two lost timeout: lines need two deleted tests.
const U_OLD = `import { test } from './harness.mjs';

// why: catches p in a fixture file
test('p', { timeout: 1000 }, () => {});

// why: catches q in a fixture file
test('q', { timeout: 2000 }, () => {});

// why: catches r in a fixture file
test('r', () => {});
`;

/** A repo with VERSION, a closeout commit and a build record with a sweep; steps(root) run after the closeout commit. */
function closeoutRepo(steps) {
	const root = kitTemp.makeTemp('cifix-co-');
	git(root, 'init', '-q', '-b', 'main');
	write(root, 'VERSION', `${VERSION}\n`);
	write(root, 'tests/a.test.mjs', `import { test } from './harness.mjs';\n\n// why: catches old one in a fixture file\ntest('old one', () => {});\n`);
	write(root, 'tests/t.test.mjs', T_OLD);
	write(root, 'tests/u.test.mjs', U_OLD);
	write(root, 'src/a.mjs', '// a\n');
	write(root, 'src/b.mjs', '// b\n');
	write(root, 'scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\nconst RETRIES = 3;\nconst SLOW_MS = 2 * 1000;\n');
	write(root, 'scripts/test-check.mjs', 'const SCORE_FLOOR = 8;\n');
	commit(root, 'base');
	const base = git(root, 'rev-parse', 'HEAD');
	const closeout = { version: VERSION, head: base, findings: [{ id: 'F1', severity: 'high', security: false, owner: false }], tickets: ['F1'] };
	write(root, `docs/builds/${VERSION}.closeout.json`, `${JSON.stringify(closeout, null, 2)}\n`);
	commit(root, 'closeout');
	steps?.(root, base);
	const rec = {
		version: VERSION, date: '2026-11-12', level: 'minor', area: 'Test value', title: 'feat: tests say why they are kept', headline: 'Every test names what it guards.',
		items: [{ id: 'T1', kind: 'changed', text: 'Each test carries a why line.', evidence: 'tests/x.test.mjs', where: 'tests', before: 'no reason', after: 'a why line' }],
		decisions: [{ decision: 'One record', why: 'the changelog and the body never differ' }],
		verification: ['Every test passed in CI.'],
		sweep: { tier: 'Feature', commit: base, dimensions: ['Privacy', 'Supply chain', 'Legal', 'Code security', 'Gaps, scaling, test value', 'Alignment'].map((name) => ({ name, result: 'clean' })), findings: { critical: 0, high: 1, medium: 0, low: 0 },
			fixes: [{ id: 'F1', finding: 'F1', severity: 'high', text: 'one high, fixed here', commit: base, test: 'tests/a.test.mjs::old one' }] },
		tests: { before: 10, after: 10 },
	};
	write(root, `docs/builds/${VERSION}.json`, `${JSON.stringify(rec, null, 2)}\n`);
	commit(root, 'record');
	return { root, base };
}
const coCheck = (root, extra) => run(CLOSEOUT, ['check', '--root', root], root, extra);
const GOOD = { run: 200, key: ITEM_TEST.key, cause: 'code', fix: SIX, files: ['src/a.mjs'], attempt: 1 };
/** The steps of a cifix case: the diagnosis line in its own commit, then a fix commit touching `touch`. */
// Two diagnoses of the run (item A names src/a.mjs, item B names src/b.mjs) in one commit, then the touch commit.
const twoItems = (touch, msg) => (root) => {
	write(root, `docs/builds/${VERSION}.cifix.jsonl`, [GOOD, { ...GOOD, key: ITEM_GATE.key, files: ['src/b.mjs'] }].map((l) => JSON.stringify(l)).join('\n') + '\n');
	commit(root, 'docs: record the diagnoses');
	write(root, touch, `// changed ${touch}\n`);
	commit(root, msg);
};
const cifixCase = (line, touch = 'src/a.mjs', msg = 'fix(ci): clear the red') => (root) => {
	write(root, `docs/builds/${VERSION}.cifix.jsonl`, `${JSON.stringify(line)}\n`);
	commit(root, 'docs: record the diagnosis');
	write(root, touch, `// changed ${touch}\n`);
	commit(root, msg);
};

// why: catches closeout.mjs check fails a cifix line with a bad cause, short fix, attempt 2 without a grant, a fix commit outside its diagnosis's files, or a pin fix made as fix: (K399 S4)
test('closeout.mjs check fails a cifix line with a bad cause, short fix, attempt 2 without a grant, or a fix commit outside its diagnosis\'s files', () => {
	const good = coCheck(closeoutRepo(cifixCase(GOOD)).root);
	assert.equal(good.status, 0, `the clean case passes: ${good.stderr}`);
	const bad = {
		'a bad cause': closeoutRepo(cifixCase({ ...GOOD, cause: 'guess' })),
		'a short fix': closeoutRepo(cifixCase({ ...GOOD, fix: 'fix it' })),
		'attempt 2 without a grant': closeoutRepo(cifixCase({ ...GOOD, attempt: 2 })),
		'a fix commit outside the diagnosis files': closeoutRepo(cifixCase(GOOD, 'src/b.mjs')),
	};
	for (const [what, { root }] of Object.entries(bad)) {
		const r = coCheck(root);
		assert.equal(r.status, 1, `${what} must fail: ${r.stdout}`);
		assert.match(r.stderr, /cifix/, what);
		assert.ok(logLines(root).some((l) => l.hook === 'closeout'), `${what} is logged`);
	}
	// pin: the change lands in a retest: commit on that test's own file; the same change as fix: is refused
	const PIN = { ...GOOD, cause: 'pin', files: ['tests/foo.test.mjs'] };
	const pinOk = coCheck(closeoutRepo(cifixCase(PIN, 'tests/foo.test.mjs', 'retest(ci): pin the foo case')).root);
	assert.equal(pinOk.status, 0, `a pin fix in a retest(ci): commit passes: ${pinOk.stderr}`);
	const pinBad = closeoutRepo(cifixCase(PIN, 'tests/foo.test.mjs', 'fix(ci): pin the foo case'));
	const pr = coCheck(pinBad.root);
	assert.equal(pr.status, 1, `a pin fix in a fix: commit must fail: ${pr.stdout}`);
	assert.match(pr.stderr, /cifix/, 'the pin refusal names cifix');
	assert.equal(logLines(pinBad.root).filter((l) => l.hook === 'closeout').length, 1, 'one closeout log line');
	// a made-up attempt-2 grant is not a yes: closeout refuses it (a grant is the owner's accepted pop-up, which CI cannot read)
	const made = coCheck(closeoutRepo(cifixCase({ ...GOOD, attempt: 2, grant: 'g-41' })).root);
	assert.equal(made.status, 1, `a made-up attempt-2 grant fails closeout: ${made.stdout}`);
	assert.match(made.stderr, /cifix/);
	// closeout runs on the PC: an attempt-2 line whose grant is the owner's accepted pop-up quoting the item's key passes
	const real = closeoutRepo(cifixCase({ ...GOOD, attempt: 2, grant: 'toolu_ask_owner', proof: proofFor('toolu_ask_owner', ITEM_TEST.key) }));
	const realYes = coCheck(real.root, answeredYes(real.root, SESSION, ITEM_TEST.key));
	assert.equal(realYes.status, 0, `an attempt-2 grant that is a real accepted pop-up passes closeout: ${realYes.stderr}`);
	// a CI fix commit is a fix(ci): or retest(ci): commit; a plain fix: commit outside the run's files pairs with no cifix line
	const plain = coCheck(closeoutRepo(cifixCase(GOOD, 'src/b.mjs', 'fix: the sweep finding F1')).root);
	assert.equal(plain.status, 0, `a plain fix: commit outside the run's files passes: ${plain.stderr}`);
	// the newest run's lines at the fix commit: a fix(ci) commit on the first item's file passes with two diagnoses
	const two = coCheck(closeoutRepo(twoItems('src/a.mjs', 'fix(ci): clear the red')).root);
	assert.equal(two.status, 0, `a fix(ci) commit on the first item's file passes: ${two.stderr}`);
	// a commit touching a file a diagnosis names pairs only as fix(ci): or retest(ci): (the ! marker and fixup!/squash!/amend!
	// prefixes of those count as the same type); a plain chore: commit touching it fails
	const chore = coCheck(closeoutRepo(cifixCase(GOOD, 'src/a.mjs', 'chore: tidy the file')).root);
	assert.equal(chore.status, 1, `a chore: commit touching a diagnosed file fails: ${chore.stdout}`);
	for (const msg of ['fix(ci)!: clear the red', 'fixup! fix(ci): clear the red', 'squash! retest(ci): clear the red', 'amend! fix(ci): clear the red']) {
		assert.equal(coCheck(closeoutRepo(cifixCase(GOOD, 'src/a.mjs', msg)).root).status, 0, `${msg} counts as a CI fix commit and passes`);
	}
});

const gateCase = (file, text, extraLine) => (root) => {
	if (extraLine) {
		write(root, `docs/builds/${VERSION}.cifix.jsonl`, `${JSON.stringify(extraLine)}\n`);
		commit(root, 'docs: record the owner yes');
	}
	write(root, file, `${text}\n`);
	commit(root, 'chore: change a gate number');
};

// why: catches closeout.mjs check fails a gate-file number that rises on a cap line or falls on a floor line against the base with no owner-yes record (K399 S4)
test('closeout.mjs check fails a gate-file number that rises on a cap line or falls on a floor line against the base with no owner-yes record', () => {
	const gate = (file, text, extra) => {
		const { root, base } = closeoutRepo(gateCase(file, text, extra));
		return { root, r: coCheck(root, { PR_BASE: base }) };
	};
	const capUp = gate('scripts/test-run.mjs', 'const FAST_CAP_MS = 60000;');
	assert.equal(capUp.r.status, 1, `a cap raised from 30000 to 60000 must fail: ${capUp.r.stdout}`);
	assert.match(capUp.r.stderr, /test-run\.mjs/);
	assert.ok(logLines(capUp.root).some((l) => l.hook === 'closeout'));
	const floorDown = gate('scripts/test-check.mjs', 'const SCORE_FLOOR = 5;');
	assert.equal(floorDown.r.status, 1, `a floor lowered from 8 to 5 must fail: ${floorDown.r.stdout}`);
	assert.match(floorDown.r.stderr, /test-check\.mjs/);
	// control: a cap lowered and a floor raised tighten the gate and pass
	assert.equal(gate('scripts/test-run.mjs', 'const FAST_CAP_MS = 20000;\nconst RETRIES = 3;\nconst SLOW_MS = 2 * 1000;').r.status, 0);
	assert.equal(gate('scripts/test-check.mjs', 'const SCORE_FLOOR = 9;').r.status, 0);
	// control: the owner-yes record that names the change lets the same rise through
	const yes = { run: 200, key: 'gate:scripts/test-run.mjs:const FAST_CAP_MS = 60000;', cause: 'env', fix: 'the owner approved this one cap number', files: ['scripts/test-run.mjs'], attempt: 1, grant: 'toolu_ask_owner', proof: proofFor('toolu_ask_owner', 'ci-fix gate-yes scripts/test-run.mjs:const FAST_CAP_MS = 60000;') };
	const named = closeoutRepo(gateCase('scripts/test-run.mjs', 'const FAST_CAP_MS = 60000;\nconst RETRIES = 3;\nconst SLOW_MS = 2 * 1000;', yes));
	const namedRun = coCheck(named.root, { PR_BASE: named.base, ...answeredYes(named.root, SESSION, 'ci-fix gate-yes scripts/test-run.mjs:const FAST_CAP_MS = 60000;') });
	assert.equal(namedRun.status, 0, namedRun.stderr);
	// control: a number raised on a line that is neither cap nor floor (RETRIES 3 to 5) passes with exit 0
	const retries = gate('scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\nconst RETRIES = 5;\nconst SLOW_MS = 2 * 1000;');
	assert.equal(retries.r.status, 0, `a retry count raised is not a gate: ${retries.r.stderr}`);
	// every number on a gate line is compared: the second number of SLOW_MS = 2 * 1000 raised to 9000 fails
	const slow = gate('scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\nconst RETRIES = 3;\nconst SLOW_MS = 2 * 9000;');
	assert.equal(slow.r.status, 1, `a cap line raised in its second number fails: ${slow.r.stdout}`);
	assert.match(slow.r.stderr, /test-run\.mjs/);
	// ci-fix.mjs gate-yes writes the gate's owner-yes line only with the owner's accepted pop-up quoting the new line, else refuses and logs
	const gy = mkRepo();
	const gyLine = 'const FAST_CAP_MS = 60000;';
	const refused = cifix(gy, 'gate-yes', 'scripts/test-run.mjs', gyLine);
	assert.equal(refused.status, 1, `gate-yes without the owner's pop-up is refused: ${refused.stdout}`);
	assert.ok(logLines(gy).some((l) => l.hook === 'ci-fix'), 'the refusal is logged by hook ci-fix');
	assert.deepEqual(cifixLines(gy), [], 'a refused gate-yes writes no line');
	const granted = cifixWith(answeredYes(gy, SESSION, gyLine), gy, 'gate-yes', 'scripts/test-run.mjs', gyLine);
	assert.equal(granted.status, 0, granted.stderr);
	const gl = cifixLines(gy);
	assert.equal(gl.length, 1, 'one owner-yes line');
	assert.equal(gl[0].key, `gate:scripts/test-run.mjs:${gyLine}`);
	assert.ok(typeof gl[0].grant === 'string' && gl[0].grant !== '', 'the line carries the grant');
	// the pop-up is read by owner-yes.cjs's rules: the quoted act is the whole span; a question naming two acts, a Yes later
	// answered No, a pop-up naming another line or file, and a session id that is not a plain UUID are all refused
	const gy2 = mkRepo();
	const tryGate = (env, file = 'scripts/test-run.mjs', line = gyLine) => cifixWith(env, gy2, 'gate-yes', file, line);
	assert.equal(tryGate(answeredYes(gy2, SESSION, `${gyLine} // note`)).status, 1, 'a Yes to a span longer than the line is refused');
	assert.equal(tryGate(answeredYes(gy2, SESSION_2, gyLine, { question: `May I run \`${gyLine}\` and \`x\`?` })).status, 1, 'a question naming two acts is refused');
	assert.equal(tryGate(answeredYes(gy2, SESSION_3, gyLine, { then: [{ question: `May I run \`${gyLine}\`?`, answer: 'No' }] })).status, 1, 'a Yes later answered No is refused');
	assert.equal(tryGate(answeredYes(gy2, SESSION, 'const SCORE_FLOOR = 60000;')).status, 1, 'a pop-up naming another line is refused');
	assert.equal(tryGate(answeredYes(gy2, SESSION_2, gyLine), 'scripts/test-check.mjs').status, 1, 'a pop-up for this line, with another file, is refused');
	const traversal = answeredYes(gy2, SESSION_3, gyLine);
	assert.equal(tryGate({ ...traversal, CLAUDE_CODE_SESSION_ID: '../x' }).status, 1, 'a session id that is not a plain UUID is refused');
	assert.deepEqual(cifixLines(gy2).filter((l) => l.key.startsWith('gate:')), [], 'no refused pop-up writes an owner-yes line');
	// a gate line holding Math.max( and Math.min( is compared on any number change; numbers in comment text are not compared
	const mixed = gate('scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\nconst RETRIES = 3;\nconst SLOW_MS = Math.max(2 * 1000, Math.min(2 * 9000, left()));');
	assert.equal(mixed.r.status, 1, `a mixed max and min gate line raised is held: ${mixed.r.stdout}`);
	const commented = gate('scripts/test-run.mjs', 'const FAST_CAP_MS = 30000; // was 60000\nconst RETRIES = 3;\nconst SLOW_MS = 2 * 1000;');
	assert.equal(commented.r.status, 0, `numbers in comment text are not compared: ${commented.r.stderr}`);
});

// why: catches digest: the fixture logs give the expected items (TAP, temp growth, fast cap, crash, CRLF, grouped check, rollup dropped) (K399 S5)
test('digest: the fixture logs give the expected items (TAP, temp growth, fast cap, crash, CRLF, grouped check, rollup dropped)', () => {
	const cwd = mkRepo({ state: null });
	const { r, out } = digest(cwd);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(out && Array.isArray(out.items), `digest prints JSON with items: ${r.stdout.slice(0, 200)}`);
	assert.equal(out.items.length, 10);
	assert.deepEqual(out.items.map((i) => i.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	for (const i of out.items) assert.equal(i.key, `${i.job}::${i.name}`);
	// TAP: both failing tests with file and line from the test frame; the passing one is no item
	const tap = inJob(out, 'unit-tests (0)');
	assert.deepEqual(tap.map((i) => [i.shape, i.name, i.file, i.line]), [
		['test', 'fast cap names the slow test', 'tests/fast-cap.test.mjs', 39],
		['test', 'a temp folder is removed at the end', 'tests/kit-temp.test.mjs', 218]]);
	assert.match(tap[0].message, /the report names the test/);
	// temp growth, fast cap and crash are one item each
	const growth = inJob(out, 'unit-tests (1)');
	assert.equal(growth.length, 1);
	assert.equal(growth[0].shape, 'gate');
	assert.equal(growth[0].name, 'temp-growth');
	assert.match(growth[0].message, /18/);
	const cap = inJob(out, 'windows-tests');
	assert.deepEqual([cap.length, cap[0].shape, cap[0].name, cap[0].file], [1, 'gate', 'fast-cap', 'tests/kit-hooks.test.mjs']);
	assert.match(cap[0].message, /42940/);
	const crash = inJob(out, 'slow-tests');
	assert.deepEqual([crash.length, crash[0].shape, crash[0].file, crash[0].line], [1, 'crash', 'scripts/test-run.mjs', 341]);
	assert.match(crash[0].message, /sessionRoot is not a function/);
	// grouped check: five findings, two reasons, two items with their counts
	const checks = inJob(out, 'test-check (0)');
	assert.equal(checks.length, 2);
	assert.ok(checks.every((i) => i.shape === 'check'));
	const bySweep = checks.find((i) => /a test added after the sweep/.test(i.message));
	const byFix = checks.find((i) => /a medium fix adds a new test/.test(i.message));
	assert.equal(bySweep?.count, 3);
	assert.equal(byFix?.count, 2);
	// rollup jobs are dropped
	assert.equal(out.items.filter((i) => ['kit-tests', 'test-check (all)'].includes(i.job)).length, 0);
	// CRLF and colour codes: the same log with CR line ends and escape codes gives the same items
	const dir = kitTemp.makeTemp('cifix-crlf-');
	const log = fs.readFileSync(path.join(FIX, 'tap-fail.log'), 'utf8').replace(/\r\n/g, '\n').replace(/not ok/g, '\u001b[31mnot ok\u001b[0m');
	fs.writeFileSync(path.join(dir, 'tap-fail.log'), log.replace(/\n/g, '\r\n'));
	const one = fixtureJobs();
	one.jobs = one.jobs.filter((j) => j.id === 101);
	fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(one));
	const crlf = digest(cwd, path.join(dir, 'jobs.json'), dir);
	assert.equal(crlf.r.status, 0, crlf.r.stderr);
	const pick = (list) => list.map((i) => [i.key, i.name, i.file, i.line, i.message]);
	assert.deepEqual(pick(crlf.out.items), pick(tap));
	// no flags: the run comes from the state and the repo from origin, read through gh on PATH (no network)
	const withState = mkRepo();
	git(withState, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
	const calls = path.join(kitTemp.makeTemp('cifix-calls-'), 'calls.jsonl');
	const noFlags = cifixWith(fakeGhPath(calls), withState, 'digest');
	assert.equal(noFlags.status, 0, noFlags.stderr);
	assert.equal(JSON.parse(noFlags.stdout).items.length, 10, 'the run read through gh gives its ten items');
	const made = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
	assert.ok(made.length >= 1, 'gh was asked for the run');
	for (const a of made) assert.equal(a[a.indexOf('-R') + 1], 'o/r', `gh call without -R o/r: ${a.join(' ')}`);
	assert.ok(made.some((a) => a.includes('200')), 'the run comes from the state (run 200)');
});

// why: catches digest: a failed job with no known shape gives an unparsed item, never none, and jobs covered counts it (K399 S5)
test('digest: a failed job with no known shape gives an unparsed item, never none, and jobs covered counts it', () => {
	const cwd = mkRepo({ state: null });
	const { out } = digest(cwd);
	assert.ok(out && out.items, 'digest printed items');
	const un = inJob(out, 'link-scan');
	assert.equal(un.length, 1);
	assert.equal(un[0].shape, 'unparsed');
	assert.match(un[0].message, /LAST-LINE-MARKER the scan stopped here/);
	assert.doesNotMatch(un[0].message, /scan line 1:/, 'only the last 25 lines are kept');
	const failedJobs = fixtureJobs().jobs.filter((j) => j.conclusion === 'failure' && !['kit-tests', 'test-check (all)'].includes(j.name));
	assert.equal(out.jobsCovered, failedJobs.length);
	assert.ok(out.jobsFailed >= out.jobsCovered);
	// a failed job whose log is empty is still covered by an unparsed item
	const dir = kitTemp.makeTemp('cifix-empty-');
	fs.writeFileSync(path.join(dir, 'empty.log'), '');
	const jobs = fixtureJobs();
	jobs.jobs = [jobs.jobs.find((j) => j.id === 106), { id: 120, name: 'silent-job', status: 'completed', conclusion: 'failure', log: 'empty.log', steps: [{ name: 'Run it', number: 1, status: 'completed', conclusion: 'failure' }] }];
	fs.copyFileSync(path.join(FIX, 'unparsed.log'), path.join(dir, 'unparsed.log'));
	fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
	const two = digest(cwd, path.join(dir, 'jobs.json'), dir);
	assert.equal(two.out?.items.length, 2);
	assert.equal(two.out?.jobsCovered, 2);
	assert.equal(inJob(two.out, 'silent-job')[0]?.shape, 'unparsed');
	// a timed-out, cancelled or startup-failed job is a failed job too: each gives an unparsed item, never none
	const stopped = fixtureJobs();
	stopped.jobs = ['timed_out', 'cancelled', 'startup_failure'].map((c, k) => ({ id: 130 + k, name: `stopped-${c}`, status: 'completed', conclusion: c, log: 'empty.log', steps: [{ name: 'Run it', number: 1, status: 'completed', conclusion: 'failure' }] }));
	fs.writeFileSync(path.join(dir, 'stopped.json'), JSON.stringify(stopped));
	const st = digest(cwd, path.join(dir, 'stopped.json'), dir);
	for (const c of ['timed_out', 'cancelled', 'startup_failure']) {
		const it = inJob(st.out ?? { items: [] }, `stopped-${c}`);
		assert.equal(it.length, 1, `a ${c} job gives one item`);
		assert.equal(it[0]?.shape, 'unparsed', `a ${c} job gives an unparsed item`);
	}
});

// why: catches ci-wait reports the first red job before the run ends with settled: false, and --settle writes the full list (K399 S6)
test('ci-wait reports the first red job before the run ends with settled: false, and --settle writes the full list', async () => {
	const common = kitTemp.makeTemp('cw-early-');
	const early = fakeGh({ runs: () => [runOf('in_progress')], jobs: earlyJobs });
	const first = await waitWith({ common }, early);
	assert.equal(first.code, 1, 'the first red job ends the wait with code 1 while the run is open');
	assert.ok(first.lines.some((l) => /unit-tests \(0\)/.test(l)), `the report names the red job: ${first.lines.join(' | ')}`);
	const s1 = readState(common);
	assert.ok(s1, 'a partial state is written');
	assert.equal(s1.settled, false);
	assert.equal(s1.verdict, 'red');
	assert.deepEqual(s1.failed.map((f) => f.key).sort(), ['unit-tests (0)::a temp folder is removed at the end', 'unit-tests (0)::fast cap names the slow test']);
	// --settle waits for the run to end and writes the whole list
	const late = fakeGh({ runs: (p) => [p < 2 ? runOf('in_progress') : runOf('completed', 'failure')], jobs: () => fixtureJobs() });
	const full = await waitWith({ common, settle: true }, late);
	assert.equal(full.code, 1);
	const s2 = readState(common);
	assert.equal(s2.settled, true);
	assert.equal(s2.failed.length, 10);
	assert.ok(s2.failed.some((f) => f.key.startsWith('slow-tests::')));
	// control: with every unset the default poll is 15 seconds, so each gap between polls is 15000 ms
	const gaps = [];
	let tick = 0;
	const dflt = await ciWait({ commit: SHA, repo: 'o/r', max: 60, common: kitTemp.makeTemp('cw-default-') }, {
		gh: fakeGh({ runs: (p) => [p < 2 ? runOf('in_progress') : runOf('completed', 'failure')], jobs: () => fixtureJobs() }),
		sleep: async (ms) => { gaps.push(ms); tick += ms; }, now: () => tick, log: () => {},
	});
	assert.equal(dflt.code, 1, 'the default-poll wait still ends red');
	assert.ok(gaps.length >= 2, `the wait polled again between runs: ${gaps}`);
	assert.deepEqual([...new Set(gaps)], [15000], 'the default gap between polls is 15000 ms');
	// every gh call ci-wait makes names its repo with -R (release-check pins this)
	assert.ok(early.calls.length > 0 && late.calls.length > 0, 'the recorded gh calls are read');
	for (const c of [...early.calls, ...late.calls]) assert.equal(c[c.indexOf('-R') + 1], 'o/r', `gh call without -R o/r: ${c.join(' ')}`);
});

// why: catches bypass: a --files entry naming a test file through ./, a backslash or another case is still refused under --cause code (K399 S2)
test('bypass: a --files entry naming a test file through ./, a backslash or another case is still refused under --cause code', () => {
	const root = mkRepo();
	for (const files of ['./tests/foo.test.mjs', 'tests\\foo.test.mjs', 'TESTS/FOO.TEST.MJS', 'Tests/Foo.test.mjs', './src/../tests/foo.test.mjs', 'src/a.mjs,.\\tests\\foo.test.mjs']) {
		const r = cifix(root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', files);
		assert.equal(r.status, 1, `${files} names a test file: ${r.stdout}`);
	}
	assert.deepEqual(cifixLines(root), []);
	// control: the plain source file is taken
	assert.equal(cifix(root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs').status, 0);
});

// why: catches repeat: list twice on the same state prints the same numbered items (K399 S2)
test('repeat: list twice on the same state prints the same numbered items', () => {
	const root = mkRepo();
	const a = cifix(root, 'list');
	const b = cifix(root, 'list');
	assert.equal(a.status, 0, a.stderr);
	assert.equal(b.status, 0);
	assert.match(a.stdout, /^\s*1\b/m);
	assert.match(a.stdout, /^\s*2\b/m);
	assert.equal(b.stdout, a.stdout);
	assert.equal(cifixLines(root).length, 0, 'list writes nothing');
});

// why: catches fail-closed: an unreadable kit-ci-state.json makes diagnose refuse with exit 1, logged (K399 S1)
test('fail-closed: an unreadable kit-ci-state.json makes diagnose refuse with exit 1, logged', () => {
	const root = mkRepo({ state: '{ this is not json' });
	const bad = cifix(root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs');
	assert.equal(bad.status, 1, bad.stdout);
	assert.notEqual(bad.stderr.trim(), '');
	assert.ok(logLines(root).some((l) => l.hook === 'ci-fix' && l.cause), 'the refusal is logged');
	write(root, '.git/kit-ci-state.json', '');
	assert.equal(cifix(root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs').status, 1, 'an empty state file refuses too');
	assert.deepEqual(cifixLines(root), []);
	// control: the same call on a readable state is taken
	const head = git(root, 'rev-parse', 'HEAD');
	write(root, '.git/kit-ci-state.json', JSON.stringify({ sha: head, run: 200, verdict: 'red', settled: true, failed: ITEMS, at: new Date().toISOString() }));
	assert.equal(cifix(root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs').status, 0);
});

const bareRepo = () => {
	const root = kitTemp.makeTemp('cifix-nover-');
	git(root, 'init', '-q', '-b', 'main');
	write(root, 'README.md', '# a project that is not the kit\n');
	commit(root, 'base');
	return root;
};

// why: catches closeout.mjs check in a project with no VERSION prints "no build record: nothing to close out", exits 0 and logs nothing (K399 S7)
test('closeout.mjs check in a project with no VERSION prints "no build record: nothing to close out", exits 0 and logs nothing', () => {
	const root = bareRepo();
	const r = coCheck(root);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /no build record: nothing to close out/);
	assert.doesNotMatch(r.stderr, /cannot read VERSION/);
	assert.deepEqual(logLines(root), []);
});

// why: catches closeout.mjs defer in a project with no VERSION writes its line to docs/builds/next.jsonl and prints "written, carry on", never a stack trace (K399 S7)
test('closeout.mjs defer in a project with no VERSION writes its line to docs/builds/next.jsonl and prints "written, carry on", never a stack trace', () => {
	const root = bareRepo();
	const r = run(CLOSEOUT, ['defer', 'carry this to the next patch', '--root', root], root);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /written, carry on/);
	assert.doesNotMatch(r.stderr, /\bat .*\(|Error:/);
	const file = path.join(root, 'docs', 'builds', 'next.jsonl');
	assert.ok(fs.existsSync(file), 'docs/builds/next.jsonl is written');
	assert.equal(JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n')[0]).text, 'carry this to the next patch');
	// control: a project with a VERSION still writes <version>.next.jsonl
	const withVersion = bareRepo();
	write(withVersion, 'VERSION', `${VERSION}\n`);
	assert.equal(run(CLOSEOUT, ['defer', 'versioned line', '--root', withVersion], withVersion).status, 0);
	assert.ok(fs.existsSync(path.join(withVersion, 'docs', 'builds', `${VERSION}.next.jsonl`)));
});

// why: catches digest kinds: the fixture items are each given fixable, diagnose or escalate as the fixed lists say (K399 CIFP)
test('digest kinds: the fixture items are each given fixable, diagnose or escalate as the fixed lists say', () => {
	const { out } = digest(mkRepo({ state: null }));
	assert.ok(out && out.items, 'digest printed items');
	const kinds = (job) => [...new Set(inJob(out, job).map((i) => i.kind))];
	assert.deepEqual(kinds('rule-map'), ['fixable'], 'a stale rule map has a deterministic fixer');
	assert.deepEqual(kinds('recall-score'), ['escalate'], 'a score gate miss is the owner\'s');
	for (const job of ['unit-tests (0)', 'unit-tests (1)', 'windows-tests', 'slow-tests', 'test-check (0)', 'link-scan']) assert.deepEqual(kinds(job), ['diagnose'], job);
	// same item red twice: a cifix line for it from an earlier run makes the digest escalate it; its sibling stays diagnose
	const SAME = 'unit-tests (0)::fast cap names the slow test';
	const prior = { run: 100, key: SAME, cause: 'code', fix: SIX, files: ['src/a.mjs'], attempt: 1 };
	const twice = digest(mkRepo({ state: null, prior: [prior] })).out;
	assert.ok(twice && twice.items, 'digest printed items with a prior line');
	assert.equal(twice.items.find((i) => i.key === SAME)?.kind, 'escalate', 'an item diagnosed in an earlier run is red twice: escalate');
	assert.equal(twice.items.find((i) => i.key === 'unit-tests (0)::a temp folder is removed at the end')?.kind, 'diagnose', 'a sibling with no prior line stays diagnose');
	assert.equal(out.items.find((i) => i.key === SAME)?.kind, 'diagnose', 'the same item with no prior line stays diagnose');
});

// why: catches ci-fix.mjs fix touches only the fixable items and logs one cifix line for each (K399 CIFP)
test('ci-fix.mjs fix touches only the fixable items and logs one cifix line for each', () => {
	const fixable = { n: 3, key: 'rule-map::rule-map', shape: 'check', job: 'rule-map', step: 'Rule map is fresh', file: 'docs/rule-map.json', line: 0, name: 'rule-map', message: 'docs/rule-map.json is stale: run node scripts/rule-map.mjs write', kind: 'fixable' };
	const escalate = { n: 4, key: 'recall-score::score-gate', shape: 'gate', job: 'recall-score', step: 'Score gate', file: '', line: 0, name: 'score-gate', message: 'median score 0.71 is under the floor 0.80', kind: 'escalate' };
	const root = kitTemp.makeTemp('cifix-fix-');
	git(root, 'init', '-q', '-b', 'main');
	git(root, 'config', 'user.name', 'Owner Test');
	git(root, 'config', 'user.email', 'owner@example.com');
	write(root, 'VERSION', `${VERSION}\n`);
	write(root, 'src/a.mjs', '// a\n');
	write(root, 'tests/foo.test.mjs', '// foo\n');
	write(root, 'docs/rule-map.json', 'STALE\n');
	write(root, 'scripts/rule-map.mjs', "import fs from 'node:fs';\nif (process.argv[2] === 'write') fs.writeFileSync('docs/rule-map.json', 'FRESH\\n');\n");
	commit(root, 'base');
	const head = git(root, 'rev-parse', 'HEAD');
	write(root, '.git/kit-ci-state.json', JSON.stringify({ sha: head, run: 200, verdict: 'red', settled: true, failed: [ITEM_TEST, ITEM_GATE, fixable, escalate], at: new Date().toISOString() }));
	const r = cifix(root, 'fix');
	assert.equal(r.status, 0, r.stderr);
	assert.equal(fs.readFileSync(path.join(root, 'docs', 'rule-map.json'), 'utf8'), 'FRESH\n', 'the fixer ran');
	const touched = git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
	assert.ok(touched.includes('docs/rule-map.json'), `the fix is committed: ${touched}`);
	assert.ok(!touched.some((f) => f.startsWith('src/') || f.startsWith('tests/')), 'no diagnose item\'s file is touched');
	assert.equal(git(root, 'log', '-1', '--format=%an'), 'Owner Test', 'committed under the repo\'s own identity');
	assert.equal(git(root, 'rev-parse', 'HEAD~1'), head);
	const lines = cifixLines(root);
	assert.equal(lines.length, 1, 'one cifix line, for the one fixable item');
	assert.equal(lines[0].key, 'rule-map::rule-map');
	assert.equal(lines[0].run, 200);
	assert.equal(lines[0].attempt, 1);
	assert.ok(['code', 'pin', 'env'].includes(lines[0].cause), 'the line passes the closeout check\'s cause list');
	assert.ok(lines[0].fix.trim().split(/\s+/).length >= 6, 'and its fix words');
	assert.ok(lines[0].files.includes('docs/rule-map.json'));
});

const GATE_ACT = 'ci-fix gate-yes scripts/test-run.mjs:const FAST_CAP_MS = 60000;';
const GATE_KEY = 'gate:scripts/test-run.mjs:const FAST_CAP_MS = 60000;';
const gateYesLine = (extra = {}) => ({ run: 200, key: GATE_KEY, cause: 'env', fix: 'the owner accepted this gate line change', files: ['scripts/test-run.mjs'], attempt: 1, ...(extra.grant ? { proof: proofFor(extra.grant, String(extra.key ?? GATE_KEY).replace(/^gate:/, 'ci-fix gate-yes ')) } : {}), ...extra });

// why: catches closeout.mjs accepting a made-up, mismatched or reused gate: grant that is no accepted pop-up (K399 U22 ruling 1)
test('closeout.mjs check counts a gate: grant only when it is the id of one accepted pop-up quoting the gate-yes act, used by no other line', () => {
	const steps = (lines) => (root) => {
		write(root, `docs/builds/${VERSION}.cifix.jsonl`, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
		commit(root, 'docs: record the owner yes');
		write(root, 'scripts/test-run.mjs', 'const FAST_CAP_MS = 60000;\nconst RETRIES = 3;\nconst SLOW_MS = 2 * 1000;\n');
		commit(root, 'chore: change a gate number');
	};
	const go = (lines, act) => {
		const { root, base } = closeoutRepo(steps(lines));
		return coCheck(root, { PR_BASE: base, ...(act ? answeredYes(root, SESSION, act) : {}) });
	};
	const real = go([gateYesLine({ grant: 'toolu_ask_owner' })], GATE_ACT);
	assert.equal(real.status, 0, `control: a grant that is the accepted pop-up's id passes: ${real.stderr}`);
	// with a session id set and its record readable, no accepted pop-up has that id: only the live read can catch a made-up grant
	const made = go([gateYesLine({ grant: 'g-7' })], GATE_ACT);
	assert.equal(made.status, 1, `a made-up gate grant must fail: ${made.stdout}`);
	assert.match(made.stderr, /gate|grant/, 'the refusal names the gate grant');
	const other = go([gateYesLine({ grant: 'toolu_ask_owner' })], 'ci-fix gate-yes scripts/test-run.mjs:const FAST_CAP_MS = 70000;');
	assert.equal(other.status, 1, `a pop-up quoting another line is no grant: ${other.stdout}`);
	const reused = go([gateYesLine({ grant: 'toolu_ask_owner' }), gateYesLine({ key: 'gate:scripts/test-check.mjs:const SCORE_FLOOR = 5;', files: ['scripts/test-check.mjs'], grant: 'toolu_ask_owner' })], GATE_ACT);
	assert.equal(reused.status, 1, `a grant used by a second line must fail: ${reused.stdout}`);
	assert.match(reused.stderr, /grant/, 'the refusal names the reused grant');
});

// why: catches a gate-yes line written after a diagnosis replacing it, so a chore: commit on a diagnosed file passes (K399 U22 ruling 2)
test('closeout.mjs check keeps the earlier diagnoses when a gate: line follows them, so a chore: commit on a diagnosed file still fails', () => {
	const build = (msg) => closeoutRepo((root) => {
		write(root, `docs/builds/${VERSION}.cifix.jsonl`, `${JSON.stringify(GOOD)}\n`);
		commit(root, 'docs: record the diagnosis');
		write(root, `docs/builds/${VERSION}.cifix.jsonl`, `${JSON.stringify(GOOD)}\n${JSON.stringify(gateYesLine({ grant: 'toolu_ask_owner' }))}\n`);
		commit(root, 'docs: record the owner yes');
		write(root, 'src/a.mjs', '// changed src/a.mjs\n');
		commit(root, msg);
	});
	const chore = build('chore: tidy the file');
	const r = coCheck(chore.root, answeredYes(chore.root, SESSION, GATE_ACT));
	assert.equal(r.status, 1, `a chore: commit on a file diagnosed before the gate line fails: ${r.stdout}`);
	assert.match(r.stderr, /src\/a\.mjs/, 'the refusal names the diagnosed file');
	// control: the same change as a fix(ci): commit stays inside the diagnosis's files and passes
	const fix = build('fix(ci): clear the red');
	const ok = coCheck(fix.root, answeredYes(fix.root, SESSION, GATE_ACT));
	assert.equal(ok.status, 0, `a fix(ci): commit on the diagnosed file passes after a gate line: ${ok.stderr}`);
});

// why: catches a line holding a cap word and a floor word read as a cap, so a floor can be lowered with no owner yes (K399 U22 ruling 3)
test('ci-digest gateLine reads a line with both a cap word and a floor word (no Math call) as mixed', () => {
	const mixed = gateLine('scripts/test-run.mjs', 'const LIMIT_MIN_MS = 3000;');
	assert.equal(mixed && mixed.kind, 'mixed', `a cap word beside a floor word is mixed: ${JSON.stringify(mixed)}`);
	assert.equal(gateLine('scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;').kind, 'cap', 'control: a cap word alone is a cap');
	assert.equal(gateLine('scripts/test-check.mjs', 'const SCORE_FLOOR = 8;').kind, 'floor', 'control: a floor word alone is a floor');
});

// why: catches a // , /* */ or # inside a quoted string cutting the gate line's loosening off as a comment (K399 U22 ruling 4)
test('ci-digest gateLine does not read a comment mark inside a quoted string as a comment, and keeps the raw line when quotes are unclear', () => {
	const slash = gateLine('scripts/test-run.mjs', 'const NOTE = "see // here"; const FAST_CAP_MS = 60000;');
	assert.deepEqual(slash && [slash.kind, slash.nums.includes(60000)], ['cap', true], `a quoted // keeps the cap number: ${JSON.stringify(slash)}`);
	const block = gateLine('scripts/test-run.mjs', 'const A = "/* x"; const FAST_CAP_MS = 60000; const B = "y */";');
	assert.deepEqual(block && [block.kind, block.nums.includes(60000)], ['cap', true], `a quoted /* */ keeps the cap number: ${JSON.stringify(block)}`);
	const hash = gateLine('.github/workflows/ci.yml', 'run: echo "a # b" timeout-minutes: 45');
	assert.deepEqual(hash && [hash.kind, hash.nums.includes(45)], ['cap', true], `a quoted # keeps the cap number: ${JSON.stringify(hash)}`);
	const unclear = gateLine('scripts/test-run.mjs', 'const S = "oops // x; const FAST_CAP_MS = 60000;');
	assert.ok(unclear && unclear.nums.includes(60000), `an unclosed quote keeps the raw line (fail closed): ${JSON.stringify(unclear)}`);
	// control: a real comment is still left out
	assert.deepEqual(gateLine('scripts/test-run.mjs', 'const FAST_CAP_MS = 30000; // was 60000').nums, [30000], 'numbers in a real comment are not compared');
});

// why: catches a bare-line gate-yes pop-up accepted against a stale or green CI state (K399 U22 ruling 5)
test('ci-fix.mjs gate-yes takes the bare-line act only when the state is red and for the current head; the full act always works', () => {
	const line = 'const FAST_CAP_MS = 60000;';
	const file = 'scripts/test-run.mjs';
	const tryBare = (state) => {
		const root = mkRepo({ state });
		return { root, r: cifixWith(answeredYes(root, SESSION, line), root, 'gate-yes', file, line) };
	};
	const fresh = tryBare({});
	assert.equal(fresh.r.status, 0, `control: a red state for the head takes the bare-line pop-up: ${fresh.r.stderr}`);
	const stale = tryBare({ sha: 'b'.repeat(40) });
	assert.equal(stale.r.status, 1, `a bare-line pop-up against another sha's state is refused: ${stale.r.stdout}`);
	assert.deepEqual(cifixLines(stale.root), [], 'a refused gate-yes writes no line');
	const green = tryBare({ verdict: 'green', failed: [] });
	assert.equal(green.r.status, 1, `a bare-line pop-up against a green state is refused: ${green.r.stdout}`);
	// the full act binds the file and line itself, so it works against the stale state too
	const root = mkRepo({ state: { sha: 'b'.repeat(40) } });
	const full = cifixWith(answeredYes(root, SESSION, `ci-fix gate-yes ${file}:${line}`), root, 'gate-yes', file, line);
	assert.equal(full.status, 0, `the full gate-yes act still works: ${full.stderr}`);
});

// why: catches a // inside a regex literal read as a comment, hiding the cap number that sits after it
test('ci-digest gateLine does not read a // inside a regex literal as a comment, so a cap after it is still read in full', () => {
	const after = gateLine('scripts/test-run.mjs', 'const r = /https?:\\/\\//; const FAST_CAP_MS = 60000;');
	assert.deepEqual(after && [after.kind, after.nums.includes(60000)], ['cap', true], `a cap after a regex holding // is read: ${JSON.stringify(after)}`);
	const before = gateLine('scripts/test-run.mjs', 'const FAST_CAP_MS = 60000; const r = /a\\//;');
	assert.ok(before && before.key.includes('/a\\//;'), `the full line is read, regex included: ${JSON.stringify(before)}`);
	// control: a comment after whitespace is still left out
	assert.deepEqual(gateLine('scripts/test-run.mjs', 'const r = /a\\//; const FAST_CAP_MS = 30000; // was 60000').nums, [30000], 'numbers in a real comment are not compared');
});

// why: catches closeout.mjs accepting a gate grant when the accepted pop-up's id is another id than the line's grant
test('closeout.mjs check refuses a gate: grant whose id differs from the accepted pop-up quoting the right act', () => {
	const go = (grant) => {
		const { root, base } = closeoutRepo((r) => {
			write(r, `docs/builds/${VERSION}.cifix.jsonl`, `${JSON.stringify(gateYesLine({ grant }))}\n`);
			commit(r, 'docs: record the owner yes');
			write(r, 'scripts/test-run.mjs', 'const FAST_CAP_MS = 60000;\nconst RETRIES = 3;\nconst SLOW_MS = 2 * 1000;\n');
			commit(r, 'chore: change a gate number');
		});
		return coCheck(root, { PR_BASE: base, ...answeredYes(root, SESSION, GATE_ACT) });
	};
	assert.equal(go('toolu_ask_owner').status, 0, 'control: the pop-up id as the grant passes');
	const other = go('toolu_some_other_id');
	assert.equal(other.status, 1, `a grant that is not the pop-up's id must fail: ${other.stdout}`);
	assert.match(other.stderr, /gate/, 'the refusal names the gate line');
});

// why: catches a bare-line gate-yes pop-up accepted when the state is for the current head but not red
test('ci-fix.mjs gate-yes refuses the bare-line act when the state is for HEAD but its verdict is not red', () => {
	const line = 'const FAST_CAP_MS = 60000;';
	const bare = (state) => {
		const root = mkRepo({ state });
		return cifixWith(answeredYes(root, SESSION, line), root, 'gate-yes', 'scripts/test-run.mjs', line);
	};
	assert.equal(bare({}).status, 0, 'control: a red state at HEAD naming the file takes the bare line');
	const notRed = bare({ verdict: 'green' });
	assert.equal(notRed.status, 1, `a green state that still lists the file in failed refuses the bare line: ${notRed.stdout}`);
});

// why: catches a block comment before an unclosed quote dropped, so the line is not kept whole and fails open
test('ci-digest gateLine keeps the raw line, comment numbers included, when a block comment precedes an unclosed quote', () => {
	const g = gateLine('scripts/test-run.mjs', '/* was 1 */ const FAST_CAP_MS = 60000; const S = "oops');
	assert.deepEqual(g && g.nums, [1, 60000], `the raw line is kept when the quote never closes: ${JSON.stringify(g)}`);
});

const RUN_BASE_TAIL = '\nconst RETRIES = 3;\nconst SLOW_MS = 2 * 1000;';
const gateRun = (file, text) => {
	const { root, base } = closeoutRepo(gateCase(file, text));
	return coCheck(root, { PR_BASE: base });
};

// why: catches a cap line given a second number, so a note or sum smuggles a bigger limit past closeout
test('closeout.mjs check fails a cap line whose count of numbers changed against its base line', () => {
	for (const text of ['const FAST_CAP_MS = 30000;//60000', 'const FAST_CAP_MS = 30000 + 60000;']) {
		const r = gateRun('scripts/test-run.mjs', text + RUN_BASE_TAIL);
		assert.equal(r.status, 1, `${text} must fail with no owner yes: ${r.stdout}`);
		assert.match(r.stderr, /test-run\.mjs/, 'the refusal names the gate file');
	}
	// control: a comment after a space is no number to compare, and passes
	assert.equal(gateRun('scripts/test-run.mjs', 'const FAST_CAP_MS = 30000; // was 60000' + RUN_BASE_TAIL).status, 0, 'a spaced comment passes');
});

// why: catches a gate line rewritten as 6e4 or 60_000 so its key leaves the base and the raise goes unseen
test('closeout.mjs check fails a gate file whose base gate line is gone and a new gate line with an unknown key appears', () => {
	for (const text of ['const FAST_CAP_MS = 6e4;', 'const FAST_CAP_MS = 60_000;']) {
		const r = gateRun('scripts/test-run.mjs', text + RUN_BASE_TAIL);
		assert.equal(r.status, 1, `${text} replacing the base cap line must fail: ${r.stdout}`);
		assert.match(r.stderr, /test-run\.mjs/, 'the refusal names the gate file');
	}
});

// why: catches a gate line removed or added in a gate file passing closeout with no owner-yes line, as the hook holds it
test('closeout.mjs check fails a removed base gate line and an added gate line with no owner-yes line for them, even when every base line stays', () => {
	const removed = gateRun('scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\nconst RETRIES = 3;');
	assert.equal(removed.status, 1, `a base cap line removed with no replacement must fail: ${removed.stdout}`);
	assert.match(removed.stderr, /test-run\.mjs/, 'the refusal names the gate file');
	const added = gateRun('scripts/test-run.mjs', `const FAST_CAP_MS = 30000;${RUN_BASE_TAIL}\nconst NEW_CAP_MS = 5000;`);
	assert.equal(added.status, 1, `a new cap line with every base line kept must fail: ${added.stdout}`);
	assert.match(added.stderr, /test-run\.mjs/, 'the refusal names the gate file');
	// control: an owner-yes line for the added line's text (a real accepted pop-up, with its proof) lets it through
	const act = 'ci-fix gate-yes scripts/test-run.mjs:const NEW_CAP_MS = 5000;';
	const yes = gateYesLine({ key: 'gate:scripts/test-run.mjs:const NEW_CAP_MS = 5000;', grant: 'toolu_ask_owner' });
	const { root, base } = closeoutRepo(gateCase('scripts/test-run.mjs', `const FAST_CAP_MS = 30000;${RUN_BASE_TAIL}\nconst NEW_CAP_MS = 5000;`, yes));
	const ok = coCheck(root, { PR_BASE: base, ...answeredYes(root, SESSION, act) });
	assert.equal(ok.status, 0, `an owner-yes line for the added line passes: ${ok.stderr}`);
});

// why: catches a test file's timeout: line rewritten or removed with its test kept, so closeout lets a loosened limit through
test('closeout.mjs check holds a rewritten timeout: line and a removed one whose test stays, and lets a removed one go with its test', () => {
	const tCheck = (text) => {
		const { root, base } = closeoutRepo(gateCase('tests/t.test.mjs', text));
		return coCheck(root, { PR_BASE: base });
	};
	const rewrites = [T_OLD.replace('timeout: 1000', 'timeout: 1e4'), T_OLD.replace('timeout: 1000', 'timeout: 1000 * 60')];
	for (const text of rewrites) {
		const r = tCheck(text);
		assert.equal(r.status, 1, `a rewritten timeout: line must fail: ${r.stdout}`);
		assert.match(r.stderr, /t\.test\.mjs/, 'the refusal names the test file');
	}
	const kept = tCheck(T_OLD.replace('{ timeout: 1000 }, ', ''));
	assert.equal(kept.status, 1, `a timeout: line removed with its test kept must fail: ${kept.stdout}`);
	// control: the test deleted along with its timeout: line passes
	const gone = tCheck(T_OLD.replace(/\/\/ why: catches one in a fixture file\ntest\('one', \{ timeout: 1000 \}, \(\) => \{\}\);\n\n/, ''));
	assert.equal(gone.status, 0, `a timeout: line removed with its test passes: ${gone.stderr}`);
});

const ATTEMPT2_ACT = ITEM_TEST.key;
const ciMode = { CLAUDE_CODE_SESSION_ID: '', GITHUB_ACTIONS: 'true' };
const attempt2Line = (extra = {}) => ({ ...GOOD, attempt: 2, grant: 'toolu_ask_owner', proof: proofFor('toolu_ask_owner', ATTEMPT2_ACT), ...extra });

// why: catches closeout in CI, with no session id, refusing a real proof or accepting a wrong, missing or reused one
test('closeout.mjs check in CI mode reads the proof in an attempt-2 or gate owner-yes line, and refuses a proof that does not match its line', () => {
	const attempt = (lines, env = ciMode, answer) => {
		const root = closeoutRepo((r) => {
			write(r, `docs/builds/${VERSION}.cifix.jsonl`, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
			commit(r, 'docs: record the diagnosis');
		}).root;
		return coCheck(root, { ...env, ...(answer ? answeredYes(root, SESSION, ATTEMPT2_ACT, { answer }) : {}) });
	};
	const good = attempt([attempt2Line()]);
	assert.equal(good.status, 0, `an attempt-2 line with its proof passes with no session id: ${good.stderr}`);
	const gate = (lines) => {
		const { root, base } = closeoutRepo(gateCase('scripts/test-run.mjs', 'const FAST_CAP_MS = 60000;\nconst RETRIES = 3;\nconst SLOW_MS = 2 * 1000;', lines[0]));
		return coCheck(root, { PR_BASE: base, ...ciMode });
	};
	const gateOk = gate([gateYesLine({ grant: 'toolu_ask_owner' })]);
	assert.equal(gateOk.status, 0, `a gate owner-yes line with its proof passes with no session id: ${gateOk.stderr}`);
	const bad = {
		'a proof act for another key': attempt([attempt2Line({ proof: proofFor('toolu_ask_owner', 'unit-tests (1)::other') })]),
		'a grant that is not the proof id': attempt([attempt2Line({ grant: 'toolu_other' })]),
		'a proof that is missing': attempt([attempt2Line({ proof: undefined })]),
		'a grant used twice': attempt([attempt2Line(), attempt2Line({ key: ITEM_GATE.key, files: ['src/b.mjs'], proof: proofFor('toolu_ask_owner', ITEM_GATE.key) })]),
	};
	for (const [what, r] of Object.entries(bad)) {
		assert.equal(r.status, 1, `${what} must fail in CI mode: ${r.stdout}`);
		assert.match(r.stderr, /cifix/, what);
	}
	const gateBad = gate([gateYesLine({ grant: 'toolu_ask_owner', proof: proofFor('toolu_ask_owner', 'ci-fix gate-yes scripts/test-run.mjs:const FAST_CAP_MS = 99999;') })]);
	assert.equal(gateBad.status, 1, `a gate proof whose act is another line must fail in CI mode: ${gateBad.stdout}`);
	// with a session id and its record readable, the pop-up is re-read live: a proof whose pop-up was answered No still fails
	const live = attempt([attempt2Line()], {}, 'Yes');
	assert.equal(live.status, 0, `control: the live read of an accepted Yes passes: ${live.stderr}`);
	const liveNo = attempt([attempt2Line()], {}, 'No');
	assert.equal(liveNo.status, 1, `a proof whose pop-up is not an accepted Yes fails the live read: ${liveNo.stdout}`);
});

// why: catches ci-fix.mjs writing an attempt-2 or gate owner-yes line with no proof closeout can read in CI
test('ci-fix.mjs diagnose attempt 2 and gate-yes write the pop-up proof (session, id, act, at) into the cifix line', () => {
	const earlier = { run: 100, key: ITEM_TEST.key, cause: 'code', fix: SIX, files: ['src/a.mjs'], attempt: 1 };
	const root = mkRepo({ prior: [earlier], run: 200 });
	const d = cifixWith(answeredYes(root, SESSION, ITEM_TEST.key), root, 'diagnose', '1', '--cause', 'code', '--fix', SIX, '--files', 'src/a.mjs', '--grant', 'toolu_ask_owner');
	assert.equal(d.status, 0, d.stderr);
	const two = cifixLines(root).filter((l) => l.key === ITEM_TEST.key)[1];
	assert.ok(two && two.proof, `the attempt-2 line carries a proof: ${JSON.stringify(two)}`);
	assert.deepEqual([two.proof.session, two.proof.id], [SESSION, 'toolu_ask_owner'], 'the proof names the session and the pop-up id');
	assert.ok(typeof two.proof.act === 'string' && two.proof.act.includes(ITEM_TEST.key), 'the proof names the act the pop-up quoted');
	assert.ok(two.proof.at, 'the proof carries the answer time');
	const gy = mkRepo();
	const line = 'const FAST_CAP_MS = 60000;';
	const g = cifixWith(answeredYes(gy, SESSION, `ci-fix gate-yes scripts/test-run.mjs:${line}`), gy, 'gate-yes', 'scripts/test-run.mjs', line);
	assert.equal(g.status, 0, g.stderr);
	const gl = cifixLines(gy).find((l) => l.key.startsWith('gate:'));
	assert.ok(gl && gl.proof, `the gate-yes line carries a proof: ${JSON.stringify(gl)}`);
	assert.deepEqual([gl.proof.session, gl.proof.id, gl.proof.act], [SESSION, gl.grant, `ci-fix gate-yes scripts/test-run.mjs:${line}`], 'the proof names session, id (the grant) and the act');
	assert.ok(gl.proof.at, 'the proof carries the answer time');
});

// why: catches ci-fix.mjs usage leaving out gate-yes, so a session never learns the only way to record a gate yes
test('ci-fix.mjs with no arguments lists gate-yes <file> <line> in its usage', () => {
	const r = cifix(mkRepo());
	assert.match(`${r.stdout}${r.stderr}`, /gate-yes <file> <line>/, `the usage lists gate-yes: ${r.stderr}`);
});

// Adds a second session's transcript beside the one answeredYes wrote: session sid answered `answer` to a pop-up quoting act.
function addSession(env, root, sid, act, answer) {
	const file = path.join(env.CLAUDE_CONFIG_DIR, 'projects', slugOf(root), `${sid}.jsonl`);
	fs.writeFileSync(file, popUp('toolu_ask_other', `May I run \`${act}\`?`, answer, ANSWER_AT).map((l) => JSON.stringify(l)).join('\n') + '\n');
}

// why: catches closeout re-reading the pop-up from the current session, or passing a proof it cannot read outside Actions
test('closeout.mjs check re-reads the pop-up from the session the proof names, fails an unreadable or mistimed proof outside Actions, and passes it on consistency in Actions', () => {
	const build = (line) => closeoutRepo((r) => {
		write(r, `docs/builds/${VERSION}.cifix.jsonl`, `${JSON.stringify(line)}\n`);
		commit(r, 'docs: record the diagnosis');
	}).root;
	const outside = { CLAUDE_CODE_SESSION_ID: '', GITHUB_ACTIONS: '' };
	// outside Actions a proof whose session record cannot be read fails
	const unread = coCheck(build(attempt2Line()), outside);
	assert.equal(unread.status, 1, `outside Actions an unreadable proof session fails: ${unread.stdout}`);
	// with GITHUB_ACTIONS=true the same line passes on consistency
	const inActions = coCheck(build(attempt2Line()), ciMode);
	assert.equal(inActions.status, 0, `in Actions the same proof passes on consistency: ${inActions.stderr}`);
	// the pop-up is read from proof.session: another current session, whose own answer is a No, does not matter
	const root = build(attempt2Line());
	const env = answeredYes(root, SESSION, ATTEMPT2_ACT);
	addSession(env, root, SESSION_2, ATTEMPT2_ACT, 'No');
	const other = coCheck(root, { ...env, CLAUDE_CODE_SESSION_ID: SESSION_2, GITHUB_ACTIONS: '' });
	assert.equal(other.status, 0, `a proof naming session S passes when the current session is another: ${other.stderr}`);
	// a proof.at that differs from the answer time fails when the record is read
	const late = build(attempt2Line({ proof: { ...proofFor('toolu_ask_owner', ATTEMPT2_ACT), at: Date.parse(ANSWER_AT) + 1000 } }));
	const mistimed = coCheck(late, { ...answeredYes(late, SESSION, ATTEMPT2_ACT), GITHUB_ACTIONS: '' });
	assert.equal(mistimed.status, 1, `a proof.at that is not the answer time fails: ${mistimed.stdout}`);
});

const BARE_LINE = 'const FAST_CAP_MS = 60000;';
const BARE_TAIL = '\nconst RETRIES = 3;\nconst SLOW_MS = 2 * 1000;';

// why: catches a bare-line gate proof accepted for another file or with no file, so one pop-up covers a line anywhere
test('closeout.mjs check accepts a bare-line gate proof only when proof.file is the line\'s file', () => {
	// Fixture change (ruling 5, 06:52Z): the proof's sha is a commit in this branch's history (the base commit), not a made-up one.
	const go = (proofExtra) => {
		const { root, base } = closeoutRepo((r, b) => {
			const yes = gateYesLine({ grant: 'toolu_ask_owner', proof: { ...proofFor('toolu_ask_owner', BARE_LINE), sha: b, ...proofExtra } });
			gateCase('scripts/test-run.mjs', BARE_LINE + BARE_TAIL, yes)(r);
		});
		return coCheck(root, { PR_BASE: base, ...answeredYes(root, SESSION, BARE_LINE) });
	};
	const ok = go({ file: 'scripts/test-run.mjs' });
	assert.equal(ok.status, 0, `control: a bare-line proof naming the line's file passes: ${ok.stderr}`);
	const other = go({ file: 'scripts/test-check.mjs' });
	assert.equal(other.status, 1, `a bare-line proof for another file must fail: ${other.stdout}`);
	const none = go({ file: undefined });
	assert.equal(none.status, 1, `a bare-line proof with no file must fail: ${none.stdout}`);
});

// why: catches closeout accepting a bare-line gate proof whose sha is no commit of this branch, so a pop-up from elsewhere counts
test('closeout.mjs check accepts a bare-line gate proof only when its sha is an ancestor of HEAD', () => {
	const go = (shaOf) => {
		const { root, base } = closeoutRepo((r, b) => {
			// a commit on a side branch, left out of the branch's history
			git(r, 'checkout', '-q', '-b', 'side');
			write(r, 'src/side.mjs', '// side\n');
			commit(r, 'side work');
			const side = git(r, 'rev-parse', 'HEAD');
			git(r, 'checkout', '-q', 'main');
			const yes = gateYesLine({ grant: 'toolu_ask_owner', proof: { ...proofFor('toolu_ask_owner', BARE_LINE), file: 'scripts/test-run.mjs', sha: shaOf({ base: b, side }) } });
			gateCase('scripts/test-run.mjs', BARE_LINE + BARE_TAIL, yes)(r);
		});
		return coCheck(root, { PR_BASE: base, ...answeredYes(root, SESSION, BARE_LINE) });
	};
	const inHistory = go(({ base }) => base);
	assert.equal(inHistory.status, 0, `control: a sha in this branch's history passes: ${inHistory.stderr}`);
	const made = go(() => 'a'.repeat(40));
	assert.equal(made.status, 1, `a sha that is no commit must fail: ${made.stdout}`);
	const side = go(({ side: s }) => s);
	assert.equal(side.status, 1, `a sha on another branch only must fail: ${side.stdout}`);
});

// why: catches closeout counting a proof whose live-read answer is a Yes to another act with the same pop-up id
test('closeout.mjs check fails a proof whose live-read answer is a Yes to another act than the proof names', () => {
	const FULL = `ci-fix attempt-2 ${ITEM_TEST.key}`;
	const go = (quoted) => {
		const root = closeoutRepo((r) => {
			write(r, `docs/builds/${VERSION}.cifix.jsonl`, `${JSON.stringify(attempt2Line({ proof: proofFor('toolu_ask_owner', FULL) }))}\n`);
			commit(r, 'docs: record the diagnosis');
		}).root;
		return coCheck(root, { ...answeredYes(root, SESSION, quoted), GITHUB_ACTIONS: '' });
	};
	const same = go(FULL);
	assert.equal(same.status, 0, `control: a Yes to the act the proof names passes: ${same.stderr}`);
	const other = go(ITEM_TEST.key);
	assert.equal(other.status, 1, `a Yes to the item's key alone, same id, is another act and must fail: ${other.stdout}`);
});

// why: catches closeout skipping the live read in Actions when the named session's record is readable, so a No pop-up passes
test('closeout.mjs check with GITHUB_ACTIONS=true still reads a readable session record and fails a proof whose pop-up was answered No', () => {
	const go = (answer) => {
		const root = closeoutRepo((r) => {
			write(r, `docs/builds/${VERSION}.cifix.jsonl`, `${JSON.stringify(attempt2Line())}\n`);
			commit(r, 'docs: record the diagnosis');
		}).root;
		return coCheck(root, { ...answeredYes(root, SESSION, ATTEMPT2_ACT, { answer }), GITHUB_ACTIONS: 'true' });
	};
	const yes = go('Yes');
	assert.equal(yes.status, 0, `control: a Yes in a readable record passes in Actions: ${yes.stderr}`);
	const no = go('No');
	assert.equal(no.status, 1, `a No in a readable record must fail in Actions: ${no.stdout}`);
});

// why: catches a newer No to the same act in the current session's record leaving an earlier proven Yes standing
test('closeout.mjs check fails a proof when a newer No to the same act is in the current session\'s record', () => {
	const go = (offsetMs) => {
		const root = closeoutRepo((r) => {
			write(r, `docs/builds/${VERSION}.cifix.jsonl`, `${JSON.stringify(attempt2Line())}\n`);
			commit(r, 'docs: record the diagnosis');
		}).root;
		const env = answeredYes(root, SESSION, ATTEMPT2_ACT);
		const at = new Date(Date.parse(ANSWER_AT) + offsetMs).toISOString();
		const file = path.join(env.CLAUDE_CONFIG_DIR, 'projects', slugOf(root), `${SESSION_2}.jsonl`);
		fs.writeFileSync(file, popUp('toolu_ask_revoke', `May I run \`${ATTEMPT2_ACT}\`?`, 'No', at).map((l) => JSON.stringify(l)).join('\n') + '\n');
		return coCheck(root, { ...env, CLAUDE_CODE_SESSION_ID: SESSION_2, GITHUB_ACTIONS: '' });
	};
	const older = go(-1000);
	assert.equal(older.status, 0, `control: an older No in the current session does not revoke the Yes: ${older.stderr}`);
	const newer = go(1000);
	assert.equal(newer.status, 1, `a newer No to the same act in the current session must revoke the proof: ${newer.stdout}`);
});

// why: catches a lost timeout: line allowed by the name check alone when the test is renamed, skipped or the line sat outside a test
test('closeout.mjs check holds a lost timeout: line when its test is renamed or skipped or the line sat outside any test, and passes a deleted test', () => {
	// baseText is committed first and is the PR base; nextText is the change under test
	const uCheck = (baseText, nextText) => {
		let mine = null;
		const { root } = closeoutRepo((r) => {
			write(r, 'tests/u.test.mjs', baseText);
			git(r, 'add', '-A');
			git(r, 'commit', '-q', '--allow-empty', '-m', 'chore: the base of this change');
			mine = git(r, 'rev-parse', 'HEAD');
			gateCase('tests/u.test.mjs', nextText.replace(/\n$/, ''))(r);
		});
		return coCheck(root, { PR_BASE: mine });
	};
	const held = (r, what) => {
		assert.equal(r.status, 1, `${what} must fail: ${r.stdout}`);
		assert.match(r.stderr, /removes a timeout line/, `${what}: the refusal names the removed timeout line`);
	};
	const pLine = "// why: catches p in a fixture file\ntest('p', { timeout: 1000 }, () => {});\n";
	const gone = uCheck(U_OLD, U_OLD.replace(`${pLine}\n`, ''));
	assert.equal(gone.status, 0, `control: test p deleted with its timeout: line passes: ${gone.stderr}`);
	held(uCheck(U_OLD, U_OLD.replace("test('p', { timeout: 1000 }", "test('p2', {")), 'a renamed test with its timeout: line removed, nothing deleted');
	held(uCheck(U_OLD, U_OLD.replace("test('p', { timeout: 1000 }, ", "test.skip('p', ")), 'a test changed to test.skip with its timeout: line removed');
	const outside = U_OLD.replace("test('p', { timeout: 1000 }, () => {});\n", "test('p', () => {});\nconst POLL = { timeout: 3000 };\n");
	held(uCheck(outside, outside.replace('const POLL = { timeout: 3000 };\n', '')), 'a timeout: line after a test\'s close removed, its test kept');
	held(uCheck(outside, outside.replace("// why: catches p in a fixture file\ntest('p', () => {});\nconst POLL = { timeout: 3000 };\n\n", '')), 'a timeout: line outside any test removed with the test above it');
});

// why: catches a rename with its timeout: line dropped passing when the same change deletes an unrelated test, so count alone clears it
test('closeout.mjs check holds a renamed test whose timeout: line is removed in the same change that deletes an unrelated test', () => {
	const uCheck = (nextText) => {
		const { root, base } = closeoutRepo(gateCase('tests/u.test.mjs', nextText.replace(/\n$/, '')));
		return coCheck(root, { PR_BASE: base });
	};
	const noR = U_OLD.replace("\n// why: catches r in a fixture file\ntest('r', () => {});\n", '');
	const control = uCheck(noR.replace("// why: catches p in a fixture file\ntest('p', { timeout: 1000 }, () => {});\n\n", ''));
	assert.equal(control.status, 0, `control: p deleted with its timeout: line and r deleted passes: ${control.stderr}`);
	const r = uCheck(noR.replace("test('p', { timeout: 1000 }", "test('p2', {"));
	assert.equal(r.status, 1, `p renamed to p2 with its timeout: line removed while r is deleted must fail: ${r.stdout}`);
	assert.match(r.stderr, /removes a timeout line/, 'the refusal names the removed timeout line');
});

// why: catches a lost timeout: line allowed when its test is renamed to the name of another test, so no new name shows
test('closeout.mjs check holds a timeout: line lost when its test is renamed to the name of another test, where only the count of tests can hold it', () => {
	const { root, base } = closeoutRepo(gateCase('tests/u.test.mjs', U_OLD.replace("test('p', { timeout: 1000 }", "test('r', {").replace(/\n$/, '')));
	const r = coCheck(root, { PR_BASE: base });
	assert.equal(r.status, 1, `p renamed to the existing name r with its timeout: line removed must fail: ${r.stdout}`);
	assert.match(r.stderr, /removes a timeout line/, 'the refusal names the removed timeout line');
});

// why: catches a test kept under another spelling (todo, space before the dot, name on the next line) losing its timeout: line
test('closeout.mjs check holds a lost timeout: line when its test name still appears as test.todo, test .skip or a name on the next line', () => {
	const forms = { 'test.todo': "test.todo('p', () => {});", 'test .skip': "test .skip('p', () => {});", 'a name on the next line': "test.skip(\n  'p', () => {});" };
	for (const [what, next] of Object.entries(forms)) {
		const { root, base } = closeoutRepo(gateCase('tests/u.test.mjs', U_OLD.replace("test('p', { timeout: 1000 }, () => {});", next).replace(/\n$/, '')));
		const r = coCheck(root, { PR_BASE: base });
		assert.equal(r.status, 1, `p kept as ${what} with its timeout: line removed must fail: ${r.stdout}`);
		assert.match(r.stderr, /removes a timeout line/, `${what}: the refusal names the removed timeout line`);
	}
});

// why: catches a kept test whose name holds an escaped quote losing its timeout: line because the name search misses it
test('closeout.mjs check holds a lost timeout: line when its kept test has an escaped quote in its name', () => {
	const withTimeout = "test('the owner\\'s yes', { timeout: 1000 }, () => {});";
	const baseText = U_OLD.replace("test('p', { timeout: 1000 }, () => {});", withTimeout);
	let mine = null;
	const { root } = closeoutRepo((r) => {
		write(r, 'tests/u.test.mjs', baseText);
		git(r, 'add', '-A');
		git(r, 'commit', '-q', '--allow-empty', '-m', 'chore: the base of this change');
		mine = git(r, 'rev-parse', 'HEAD');
		// an unrelated test r is deleted in the same change, so the count bound (drop 1, lost 1) is met and only the name check is left
		const noR = baseText.replace("\n// why: catches r in a fixture file\ntest('r', () => {});\n", '');
		gateCase('tests/u.test.mjs', noR.replace(withTimeout, "test('the owner\\'s yes', () => {});").replace(/\n$/, ''))(r);
	});
	const r = coCheck(root, { PR_BASE: mine });
	assert.equal(r.status, 1, `a test named with an escaped quote, kept, with its timeout: line removed must fail: ${r.stdout}`);
	assert.match(r.stderr, /removes a timeout line/, 'the refusal names the removed timeout line');
});

// why: catches ci-fix.mjs gate-yes writing a bare-line proof with no file or state sha, so closeout cannot bind it to a file
test('ci-fix.mjs gate-yes writes proof.file and proof.sha for a bare-line act', () => {
	const root = mkRepo();
	const r = cifixWith(answeredYes(root, SESSION, BARE_LINE), root, 'gate-yes', 'scripts/test-run.mjs', BARE_LINE);
	assert.equal(r.status, 0, r.stderr);
	const line = cifixLines(root).find((l) => l.key.startsWith('gate:'));
	assert.deepEqual([line.proof.act, line.proof.file, line.proof.sha], [BARE_LINE, 'scripts/test-run.mjs', git(root, 'rev-parse', 'HEAD')], `the proof binds the bare line to its file and the state's head: ${JSON.stringify(line.proof)}`);
});

// why: catches closeout letting two lost timeout: lines through when only one test was deleted
test('closeout.mjs check holds two removed timeout: lines when only one test is deleted, and passes one removed with its test', () => {
	const uCheck = (text) => {
		const { root, base } = closeoutRepo(gateCase('tests/u.test.mjs', text));
		return coCheck(root, { PR_BASE: base });
	};
	const one = uCheck(U_OLD.replace("// why: catches p in a fixture file\ntest('p', { timeout: 1000 }, () => {});\n\n", ''));
	assert.equal(one.status, 0, `control: one timeout: line removed with its test passes: ${one.stderr}`);
	const two = uCheck(U_OLD.replace("// why: catches p in a fixture file\ntest('p', { timeout: 1000 }, () => {});\n\n", '').replace('{ timeout: 2000 }, ', ''));
	assert.equal(two.status, 1, `two timeout: lines gone with one test deleted must fail: ${two.stdout}`);
	assert.match(two.stderr, /u\.test\.mjs/, 'the refusal names the test file');
});

// why: catches closeout passing a timeout: line lost from a kept test because another test was deleted, so the count alone decides
test('closeout.mjs check allows a lost timeout: line only when the test that held it is gone from the new text', () => {
	const uCheck = (text) => {
		const { root, base } = closeoutRepo(gateCase('tests/u.test.mjs', text));
		return coCheck(root, { PR_BASE: base });
	};
	// p loses its timeout and stays; r is deleted: the count dropped by one and one line was lost, but the line was p's
	const swapped = uCheck(U_OLD.replace('{ timeout: 1000 }, ', '').replace("// why: catches r in a fixture file\ntest('r', () => {});\n", ''));
	assert.equal(swapped.status, 1, `a timeout: line lost from a kept test must fail although another test was deleted: ${swapped.stdout}`);
	assert.match(swapped.stderr, /u\.test\.mjs/, 'the refusal names the test file');
	// control: p deleted together with its own timeout: line passes
	const gone = uCheck(U_OLD.replace("// why: catches p in a fixture file\ntest('p', { timeout: 1000 }, () => {});\n\n", ''));
	assert.equal(gone.status, 0, `control: a test deleted with its own timeout: line passes: ${gone.stderr}`);
});
