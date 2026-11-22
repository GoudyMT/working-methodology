// K309 and K312 (build 24): a unit's history proves test-first only when its commits have the right shape. Prose did
// not hold that record, so user/kit-tools/unit-check.mjs reads the commits in a range: a test-only red commit before
// each feat or fix, red tests that fail on their own tree and pass on the code's, refactors that leave tests alone,
// and retest commits that need the owner's yes. These tests build fixture repos in temp folders and drive the CLI.
// They fail until unit-check.mjs exists.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const MODULE = fileURLToPath(new URL('../user/kit-tools/unit-check.mjs', import.meta.url));

const BASE_SRC = 'export function add(a, b) {\n\treturn a;\n}\n';
const GOOD_SRC = 'export function add(a, b) {\n\treturn a + b;\n}\n';
const WRONG_SRC = 'export function add(a, b) {\n\treturn a - b;\n}\n';
const CASE_ONE = ['add case one', 'assert.equal(add(4, 0), 4);'];
const CASE_ONE_RED = ['add case one', 'assert.equal(add(4, 9), 13);'];
const ADDS = ['adds two numbers', 'assert.equal(add(1, 2), 3);'];
const NEGS = ['adds negatives', 'assert.equal(add(-1, -2), -3);'];
const CLAMP = ['clamps at zero', 'assert.equal(add(-1, -2), 0);'];
const CLAMP_SRC = 'export function add(a, b) {\n\treturn Math.max(0, a + b);\n}\n';
const REWORDED = ['add case one', 'assert.equal(add(5, 8), 13);'];
const testFile = (...cases) => [
	"import { test } from 'node:test';",
	"import assert from 'node:assert/strict';",
	"import { add } from '../src/add.mjs';",
	...cases.map(([name, body]) => `test(${JSON.stringify(name)}, () => { ${body} });`),
].join('\n') + '\n';
const BASE_FILE = testFile(CASE_ONE);
const RED_FILE = testFile(CASE_ONE_RED, ADDS);
const SUM_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../src/sum.mjs';\ntest('sums two numbers', () => { assert.equal(sum(1, 2), 3); });\n";
const SUM_SRC = 'export function sum(a, b) {\n\treturn a + b;\n}\n';
const SUM_BAD_SRC = 'export function total(a, b) {\n\treturn a + b;\n}\n';
const LEGACY_FILE = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('legacy case', () => { assert.equal(1, 2); });\n";

const gitRun = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const gitOut = (dir, ...args) => {
	const r = gitRun(dir, ...args);
	if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
};

// Writes the files, commits them with a fixed identity, and returns the new commit's short hash.
function commit(dir, subject, files) {
	for (const [rel, body] of Object.entries(files)) {
		const abs = path.join(dir, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, body);
		gitOut(dir, 'add', '--', rel);
	}
	gitOut(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', subject);
	return gitOut(dir, 'rev-parse', '--short', 'HEAD');
}

// A fixture repo on branch main: one base commit (outside the checked range) and the tag `base` on it.
function repo(extra = {}) {
	const dir = kitTemp.makeTemp('unit-check-');
	gitOut(dir, 'init', '-q', '-b', 'main');
	commit(dir, 'chore: base', { 'src/add.mjs': BASE_SRC, 'tests/add.test.mjs': BASE_FILE, ...extra });
	gitOut(dir, 'tag', 'base');
	return dir;
}
const redCommit = (dir, body = RED_FILE) => commit(dir, 'test: adds two numbers', { 'tests/add.test.mjs': body });
const featCommit = (dir, src = GOOD_SRC) => commit(dir, 'feat: add two numbers', { 'src/add.mjs': src });
const runCheck = (dir, range = 'base..HEAD') => spawnSync(process.execPath, [MODULE, range, '--repo', dir], { encoding: 'utf8' });
const faultLines = (r) => r.stderr.split('\n').map((s) => s.trim()).filter(Boolean);
// The fault lines are an unordered set: exactly one line names this hash and matches this rule.
const faultFor = (r, hash, rule) => {
	const hits = faultLines(r).filter((l) => l.includes(hash) && rule.test(l));
	assert.equal(hits.length, 1, `expected one line for ${hash} matching ${rule}; stderr:\n${r.stderr}`);
};

// why: catches a run with no range argument passing as a clean check.
test('CLI: no range argument exits 2 for bad use', () => {
	const dir = repo();
	const r = spawnSync(process.execPath, [MODULE, '--repo', dir], { encoding: 'utf8' });
	assert.equal(r.status, 2, r.stderr);
});

// why: catches an empty range reading as a pass with nothing checked.
test('CLI: a range with no commits exits 2 for bad use', () => {
	const dir = repo();
	const r = runCheck(dir, 'HEAD..HEAD');
	assert.equal(r.status, 2, r.stderr);
});

// why: catches a folder with no git history being checked and passed silently.
test('CLI: a folder that is not a git repo exits 2 for bad use', () => {
	const dir = kitTemp.makeTemp('unit-check-nogit-');
	const r = runCheck(dir);
	assert.equal(r.status, 2, r.stderr);
});

// why: catches a clean good history that exits non-zero on the way.
test('CLI: a good range exits 0 with nothing on stderr', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stderr, '');
});

// why: catches a check that needs --repo even when run inside the repo.
test('CLI: repo defaults to the current folder when --repo is left out', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	const r = spawnSync(process.execPath, [MODULE, 'base..HEAD'], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a run that merges two faults into one stderr line.
test('CLI: one stderr line per fault, each naming its short hash and rule', () => {
	const dir = repo();
	const feat = featCommit(dir);
	const chore = commit(dir, 'chore: change add and its test', { 'src/add.mjs': WRONG_SRC, 'tests/add.test.mjs': RED_FILE });
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	const lines = faultLines(r);
	assert.equal(lines.length, 2, r.stderr);
	faultFor(r, feat, /no red commit before it/);
	faultFor(r, chore, /mixed/);
});

// why: catches a commit mixing source and test files passing unflagged.
test('classing: a chore commit touching src and a test file is mixed and exits 1', () => {
	const dir = repo();
	const mixed = commit(dir, 'chore: change add and its test', { 'src/add.mjs': GOOD_SRC, 'tests/add.test.mjs': RED_FILE });
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	const lines = faultLines(r);
	assert.equal(lines.length, 1, r.stderr);
	assert.ok(lines[0].includes(mixed) && /mixed/.test(lines[0]), lines[0]);
});

for (const folder of ['test', 'tests', '__tests__', 'spec']) {
	// why: catches a helper under a test folder passing as test-only, not mixed.
	test(`classing: a commit adding ${folder}/helper.mjs with a src change is mixed`, () => {
		const dir = repo();
		const mixed = commit(dir, 'chore: add a helper under a test folder', {
			[`${folder}/helper.mjs`]: 'export const helper = 1;\n',
			'src/add.mjs': GOOD_SRC,
		});
		const r = runCheck(dir);
		assert.equal(r.status, 1, r.stderr);
		faultFor(r, mixed, /mixed/);
	});
}

for (const file of ['src/add.spec.mjs', 'lib/add.test.js']) {
	// why: catches a spec or test named file with a src change passing as test-only.
	test(`classing: a commit adding ${file} with a src change is mixed`, () => {
		const dir = repo();
		const mixed = commit(dir, 'chore: add a spec-named file', { [file]: 'export const x = 1;\n', 'src/add.mjs': GOOD_SRC });
		const r = runCheck(dir);
		assert.equal(r.status, 1, r.stderr);
		faultFor(r, mixed, /mixed/);
	});
}

// why: catches a feature commit with no test before it passing unflagged.
test('red-green: a good red then feat pair exits 0', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a feature commit with no test before it passing unflagged.
test('red-green: a feat commit with no red commit before it exits 1', () => {
	const dir = repo();
	const feat = featCommit(dir);
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	const lines = faultLines(r);
	assert.equal(lines.length, 1, r.stderr);
	assert.ok(lines[0].includes(feat) && /no red commit before it/.test(lines[0]), lines[0]);
});

// why: catches a fix commit with no test before it passing unflagged.
test('red-green: a fix commit with no red commit before it exits 1', () => {
	const dir = repo();
	const fix = commit(dir, 'fix: add two numbers', { 'src/add.mjs': GOOD_SRC });
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, fix, /no red commit before it/);
});

// why: catches a test written after its code satisfying the red rule.
test('red-green: a test committed after its feat does not count as the red commit', () => {
	const dir = repo();
	const feat = featCommit(dir);
	redCommit(dir);
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, feat, /no red commit before it/);
});

// why: catches a second feature riding on the first pair's red commit.
test('red-green: a second feat after a green pair needs its own red commit', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	const second = commit(dir, 'feat: document add', { 'src/add.mjs': `${GOOD_SRC}// sums\n` });
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, second, /no red commit before it/);
});

// why: catches a new test that passes on its red tree unflagged.
test('red-green: a red commit whose new test passes on its own tree is a fault', () => {
	const dir = repo();
	const red = redCommit(dir, testFile(CASE_ONE, ['passes early', 'assert.equal(add(4, 0), 4);']));
	featCommit(dir);
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, red, /passed before the code/);
});

// why: catches a red check reading an old failing test as red.
test('red-green: a new passing test is a fault even when an old test in the file fails', () => {
	const dir = repo({ 'tests/add.test.mjs': testFile(CASE_ONE, ['already failing', 'assert.equal(1, 2);']) });
	const red = redCommit(dir, testFile(CASE_ONE, ['already failing', 'assert.equal(1, 2);'], ['passes early', 'assert.equal(add(4, 0), 4);']));
	featCommit(dir);
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, red, /passed before the code/);
});

// why: catches a green step that leaves a red test failing unflagged.
test('red-green: a feat that leaves a red test failing is a fault', () => {
	const dir = repo();
	redCommit(dir, testFile(ADDS));
	const feat = featCommit(dir, WRONG_SRC);
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, feat, /still fails after the code/);
});

// why: catches a changed existing test that fails on red wrongly faulted.
test('red-green: a changed existing test that fails on its red tree is a good pair', () => {
	const dir = repo();
	redCommit(dir, testFile(CASE_ONE_RED));
	featCommit(dir);
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a changed test that already passes on the red tree going unflagged.
test('red-green: a changed existing test that passes on its red tree is a fault', () => {
	const dir = repo();
	const red = redCommit(dir, testFile(['add case one', 'assert.equal(add(5, 0), 5);']));
	featCommit(dir);
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, red, /passed before the code/);
});

// why: catches a red commit whose test cannot load faulted as untested.
test('red-green: a red commit whose new test file cannot load counts as red', () => {
	const dir = repo();
	commit(dir, 'test: add sum', { 'tests/sum.test.mjs': SUM_TEST });
	commit(dir, 'feat: add sum', { 'src/sum.mjs': SUM_SRC });
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a file that still cannot load after code passing.
test('red-green: a new test file that still cannot load after the feat is a fault', () => {
	const dir = repo();
	commit(dir, 'test: add sum', { 'tests/sum.test.mjs': SUM_TEST });
	const feat = commit(dir, 'feat: add sum', { 'src/sum.mjs': SUM_BAD_SRC });
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, feat, /still fails after the code/);
});

// why: catches a check that faults a unit for an untouched old failing file.
test('red-green: a failing old test file the range never touches does not fault the unit', () => {
	const dir = repo({ 'tests/legacy.test.mjs': LEGACY_FILE });
	redCommit(dir);
	featCommit(dir);
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a check reading the dirty working tree, not the commit trees.
test('red-green: uncommitted working-tree edits do not change the verdict', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	fs.writeFileSync(path.join(dir, 'src', 'add.mjs'), WRONG_SRC);
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a check that writes into the repo or its working tree.
test('red-green: the check leaves HEAD, the index and the working tree as they were', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	fs.writeFileSync(path.join(dir, 'src', 'add.mjs'), WRONG_SRC);
	fs.writeFileSync(path.join(dir, 'scratch.txt'), 'owner scratch\n');
	const headBefore = gitOut(dir, 'rev-parse', 'HEAD');
	const statusBefore = gitOut(dir, 'status', '--porcelain');
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(gitOut(dir, 'rev-parse', 'HEAD'), headBefore);
	assert.equal(gitOut(dir, 'status', '--porcelain'), statusBefore);
	assert.equal(fs.readFileSync(path.join(dir, 'src', 'add.mjs'), 'utf8'), WRONG_SRC);
});

// why: catches a red commit with no code after it faulted as bad.
test('red-green: a test commit followed by no source commit is fine', () => {
	const dir = repo();
	redCommit(dir);
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a reformat-only refactor faulted for touching source.
test('refactor: a source-only refactor that keeps the tests green exits 0', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	commit(dir, 'refactor: parenthesize the sum', { 'src/add.mjs': 'export function add(a, b) {\n\treturn (a + b);\n}\n' });
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a refactor that edits a test file passing unflagged.
test('refactor: a refactor that changes a test file is a fault', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	const refactor = commit(dir, 'refactor: rename the adds case', {
		'tests/add.test.mjs': testFile(CASE_ONE_RED, ['adds two integers', 'assert.equal(add(1, 2), 3);']),
	});
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, refactor, /refactor changed a test file/);
});

// why: catches a refactor that breaks a green test passing unflagged.
test('refactor: a source refactor that turns a green test red is a fault', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	const refactor = commit(dir, 'refactor: special-case one', {
		'src/add.mjs': 'export function add(a, b) {\n\tif (a === 1) return 4;\n\treturn a + b;\n}\n',
	});
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, refactor, /refactor changed which tests pass/);
});

// why: catches a refactor that turns a red test green unflagged.
test('refactor: a refactor that turns a previously failing test green is a fault', () => {
	const dir = repo();
	redCommit(dir);
	commit(dir, 'chore: reformat the add source', { 'src/add.mjs': `${BASE_SRC}\n` });
	const refactor = commit(dir, 'refactor: move to a plain sum', { 'src/add.mjs': GOOD_SRC });
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, refactor, /refactor changed which tests pass/);
});

// why: catches a build commit mixing source and test passing unflagged.
test('unchecked types: a build commit that mixes source and test is a mixed fault', () => {
	const dir = repo();
	const build = commit(dir, 'build: pin add', { 'src/add.mjs': GOOD_SRC, 'tests/add.test.mjs': RED_FILE });
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, build, /mixed/);
});

// why: catches a retest commit refused for changing a test after green.
test('retest: a retest commit after green exits 0 and prints its owner yes line', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	commit(dir, 'retest: add a negatives case', { 'tests/add.test.mjs': testFile(CASE_ONE_RED, ADDS, NEGS) });
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /owner yes needed: [0-9a-f]{7,40} retest: add a negatives case/, r.stdout);
});

// why: catches retest commits sharing one owner yes line.
test('retest: two retest commits print two owner yes lines', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	commit(dir, 'retest: add a negatives case', { 'tests/add.test.mjs': testFile(CASE_ONE_RED, ADDS, NEGS) });
	commit(dir, 'retest: tighten the negatives case', { 'tests/add.test.mjs': testFile(CASE_ONE_RED, ADDS, ['adds negatives', 'assert.equal(add(-2, -2), -4);']) });
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
	const lines = r.stdout.split('\n').filter((l) => /^owner yes needed: /.test(l));
	assert.equal(lines.length, 2, r.stdout);
});

// why: catches a new failing test after green wrongly refused as no red.
test('test-red: a test, feat, new failing test, fix sequence exits 0', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	commit(dir, 'test: clamp the sum at zero', { 'tests/add.test.mjs': testFile(CASE_ONE_RED, ADDS, CLAMP) });
	commit(dir, 'fix: clamp the sum at zero', { 'src/add.mjs': CLAMP_SRC });
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a test edit with no failing test passing unflagged.
test('test-red: a test commit that rewords a passing assertion faults for use retest', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	const reword = commit(dir, 'test: reword the case one assertion', { 'tests/add.test.mjs': testFile(REWORDED, ADDS) });
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, reword, /test changed without a red test; use retest:/);
});

// why: guards rule:test-integrity (a retest commit that rewords a passing assertion passes and prints its owner yes line).
test('test-red: the same reword as retest exits 0 and prints its owner yes line', () => {
	const dir = repo();
	redCommit(dir);
	featCommit(dir);
	commit(dir, 'retest: reword the case one assertion', { 'tests/add.test.mjs': testFile(REWORDED, ADDS) });
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /owner yes needed: [0-9a-f]{7,40} retest: reword the case one assertion/, r.stdout);
});

// why: catches a chore source commit with no red faulted anyway.
test('unchecked types: a chore source commit with no red before it exits 0', () => {
	const dir = repo();
	commit(dir, 'chore: tidy the add source', { 'src/add.mjs': GOOD_SRC });
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a docs-only commit faulted as an untested change.
test('unchecked types: a docs-only commit exits 0', () => {
	const dir = repo();
	commit(dir, 'docs: describe add', { 'docs/add.md': '# add\n\nSums two numbers.\n' });
	const r = runCheck(dir);
	assert.equal(r.status, 0, r.stderr);
});

// why: catches a docs commit that edits a test file passing unflagged.
test('unchecked types: a docs commit that also touches a test file is a mixed fault', () => {
	const dir = repo();
	const docs = commit(dir, 'docs: describe add', { 'docs/add.md': '# add\n', 'tests/add.test.mjs': RED_FILE });
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, docs, /mixed/);
});

// why: catches a ci commit mixing source and test passing unflagged.
test('unchecked types: a ci commit that mixes source and test is a mixed fault', () => {
	const dir = repo();
	const ci = commit(dir, 'ci: pin add', { 'src/add.mjs': GOOD_SRC, 'tests/add.test.mjs': RED_FILE });
	const r = runCheck(dir);
	assert.equal(r.status, 1, r.stderr);
	faultFor(r, ci, /mixed/);
});
