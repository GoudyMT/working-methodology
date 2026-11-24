// K367, U25 (patch 1.51.4): a feature-branch push no longer asks for a test change; CI's scripts/test-integrity.mjs
// judges every commit in merge-base..head against its parent instead (rule:test-integrity). Interface (lead ruling):
// node scripts/test-integrity.mjs <base-sha> [--retests <file>], run in the head checkout; exit 0 pass, 1 finding,
// 2 cannot run. Each case runs in a temp git repo with HOME and the Claude folders pointed at temp dirs.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { honestBody, STD_TITLE } from './kit-helpers.mjs';

kitTemp.sessionRoot();
const SCRIPT = path.resolve('scripts/test-integrity.mjs');
const AUDIT = path.resolve('project/.claude/pr-body-audit.mjs');
const CI = path.resolve('.github/workflows/ci.yml');
const KIT_PRE_PUSH = path.resolve('.githooks/pre-push');
const PROJECT_PRE_PUSH = path.resolve('project/.githooks/pre-push');
const ZERO = '0'.repeat(40);

function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('integrity-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, ...extra };
}
const GIT_ID = { GIT_AUTHOR_NAME: 'Tester', GIT_AUTHOR_EMAIL: 'tester@example.invalid', GIT_COMMITTER_NAME: 'Tester', GIT_COMMITTER_EMAIL: 'tester@example.invalid' };
function git(cwd, args) {
	const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, env: isolatedEnv(GIT_ID), encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
}
function put(dir, files) {
	for (const [rel, text] of Object.entries(files)) {
		const file = path.join(dir, rel);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
	}
}
function commit(dir, message) {
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
	return git(dir, ['rev-parse', 'HEAD']);
}

const T0 = "import { test } from './harness.mjs';\n\ntest('adds', () => {\n  assert.equal(1 + 1, 2);\n});\n";
const SRC0 = 'export const add = (a, b) => a + b;\n';

// A repo whose main holds a source file and one test, with the PR branch feat/x checked out at that base.
function prRepo(extra = {}) {
	const dir = kitTemp.makeTemp('integrity-repo-');
	git(dir, ['init', '-q', '-b', 'main']);
	put(dir, { 'src/add.js': SRC0, 'tests/add.test.mjs': T0, ...extra });
	const base = commit(dir, 'chore: base');
	git(dir, ['checkout', '-q', '-b', 'feat/x']);
	return { dir, base };
}
// test-integrity as CI runs it: in the head checkout, base sha as the argument. A missing script is an assertion here.
function integrity(dir, base, args = [], env = {}) {
	assert.ok(fs.existsSync(SCRIPT), 'scripts/test-integrity.mjs exists');
	const r = spawnSync(process.execPath, [SCRIPT, base, ...args], { cwd: dir, env: isolatedEnv({ GITHUB_STEP_SUMMARY: '', ...env }), encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// A repo with a bare origin that already holds main, so a push to a feature branch is not a first push.
function pushRepo() {
	const dir = kitTemp.makeTemp('integrity-push-');
	git(dir, ['init', '-q', '-b', 'main']);
	put(dir, { 'src/add.js': SRC0, 'tests/add.test.mjs': T0 });
	const red = commit(dir, 'test: add cases');
	const bare = kitTemp.makeTemp('integrity-bare-');
	git(bare, ['init', '-q', '--bare', '-b', 'main']);
	git(dir, ['remote', 'add', 'origin', bare]);
	git(dir, ['push', '-q', 'origin', 'main']);
	return { dir, red, bare };
}
const NO_MARKERS = { CLAUDECODE: '', AI_AGENT: '', CLAUDE_CODE_SESSION_ID: '', KIT_OWNER_PUSH: '', KIT_PUSH_APPROVED: '' };
function pushRun(hook, dir, bare, input) {
	return spawnSync('sh', [hook, 'origin', bare], { cwd: dir, env: isolatedEnv(NO_MARKERS), input, encoding: 'utf8' });
}

// why: catches a feature-branch push that changes, deletes or retests a test still asking for the owner's yes (K367 S1)
test('a feature-branch push that edits, deletes or retests a test passes both pre-push hooks with no ask', () => {
	for (const [label, hook] of [['project hook', PROJECT_PRE_PUSH], ['kit hook', KIT_PRE_PUSH]]) {
		const { dir, red, bare } = pushRepo();
		git(dir, ['checkout', '-q', '-b', 'feat/x', red]);
		put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1', '1 + 2') });
		const edit = commit(dir, 'fix: change the add case');
		fs.rmSync(path.join(dir, 'tests', 'add.test.mjs'));
		const del = commit(dir, 'fix: drop the add test file');
		put(dir, { 'tests/add.test.mjs': T0 });
		const retest = commit(dir, 'retest: put the add case back');
		let was = red;
		for (const [what, sha] of [['edit', edit], ['delete', del], ['retest', retest]]) {
			const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${sha} refs/heads/feat/x ${was}\n`);
			// Owner's pick (option A): only the kit source's own hook relaxes; a project's hook keeps its test-change scan.
			if (hook === KIT_PRE_PUSH) {
				assert.equal(r.status, 0, `${label} ${what}: ${r.stderr}`);
				assert.doesNotMatch(r.stderr, /owner'?s? yes/i, `${label} ${what} asks no yes`);
				assert.doesNotMatch(r.stderr, /test change|test-change/i, `${label} ${what} names no test hold`);
			} else {
				assert.notEqual(r.status, 0, `${label} ${what} is held: ${r.stderr}`);
				assert.match(r.stderr, /holds a test change/i, `${label} ${what} keeps its test-change hold text`);
				assert.match(r.stderr, /owner'?s? yes/i, `${label} ${what} asks the owner's yes`);
			}
			was = sha;
		}
	}
});

// why: catches a main, tag, force or delete push losing its own hold when it carries a test change (K367 S1)
test('a main, tag, force or delete push with a test change is refused under the project hook own reason', () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1', '1 + 2') });
	const edit = commit(dir, 'fix: change the add case');
	const cases = [
		['main', `refs/heads/main ${edit} refs/heads/main ${red}\n`, /refs\/heads\/main: the main branch/],
		['tag', `refs/tags/v1 ${edit} refs/tags/v1 ${ZERO}\n`, /refs\/tags\/v1: not a branch/],
		['delete', `(delete) ${ZERO} refs/heads/feat/x ${red}\n`, /refs\/heads\/feat\/x: a delete/],
	];
	// A force: the remote's feat/x is a commit the local one does not contain.
	git(dir, ['checkout', '-q', '-b', 'other', red]);
	put(dir, { 'src/add.js': `${SRC0}// other\n` });
	const other = commit(dir, 'feat: other line');
	cases.push(['force', `refs/heads/feat/x ${edit} refs/heads/feat/x ${other}\n`, /refs\/heads\/feat\/x: a force push/]);
	for (const [what, input, reason] of cases) {
		const r = pushRun(PROJECT_PRE_PUSH, dir, bare, input);
		assert.notEqual(r.status, 0, `${what} is refused: ${r.stderr}`);
		// The project hook keeps its full test-change scan (owner's pick, option A): its hold text is what refuses.
		// A delete carries no commit, so the scan holds nothing for it and the hook's own delete reason refuses it.
		if (what === 'delete') assert.match(r.stderr, reason, 'delete keeps the hook own reason');
		else assert.match(r.stderr, /holds a test change/i, `${what} is held by the project hook's test-change scan`);
		// The kit-source hook keeps its existing test-change hold (lead ruling). A delete carries no commit, so its scan
		// holds nothing today and the kit hook has no delete reason of its own: nothing is pinned for it there.
		if (what === 'delete') continue;
		const k = pushRun(KIT_PRE_PUSH, dir, bare, input);
		assert.notEqual(k.status, 0, `kit hook ${what} is refused: ${k.stderr}`);
		assert.match(k.stderr, /holds a test change/i, `kit hook ${what} keeps its test-change hold`);
	}
	// A remote whose default branch cannot be read (its HEAD names a branch it lacks) while it has branches: the kit hook
	// takes an unknown default as protected, so a test change pushed to any branch is held, never passed as a feature branch.
	git(bare, ['symbolic-ref', 'HEAD', 'refs/heads/gone']);
	assert.doesNotMatch(git(dir, ['ls-remote', '--symref', bare, 'HEAD']), /^ref:/m, 'the remote names no default branch');
	assert.match(git(dir, ['ls-remote', '--heads', bare]), /refs\/heads\/main/, 'the remote has branches');
	const unknown = pushRun(KIT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${edit} refs/heads/feat/x ${red}\n`);
	assert.notEqual(unknown.status, 0, `kit hook, unknown default: ${unknown.stderr}`);
	assert.match(unknown.stderr, /holds a test change/i, 'kit hook, unknown default, keeps its test-change hold');
	// A remote whose default branch is develop: a test change pushed to develop is held, while the same commit on a feature
	// branch of that remote passes. Only the default-branch term can tell develop from a feature branch here.
	git(dir, ['push', '-q', 'origin', `${red}:refs/heads/develop`]);
	git(bare, ['symbolic-ref', 'HEAD', 'refs/heads/develop']);
	assert.match(git(dir, ['ls-remote', '--symref', bare, 'HEAD']), /^ref: refs\/heads\/develop\tHEAD/m, 'the remote names develop its default');
	const onDevelop = pushRun(KIT_PRE_PUSH, dir, bare, `refs/heads/develop ${edit} refs/heads/develop ${red}\n`);
	assert.notEqual(onDevelop.status, 0, `kit hook, push to the default branch develop: ${onDevelop.stderr}`);
	assert.match(onDevelop.stderr, /holds a test change/i, 'kit hook holds a test change pushed to the default branch develop');
	const offDevelop = pushRun(KIT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${edit} refs/heads/feat/x ${red}\n`);
	assert.equal(offDevelop.status, 0, `kit hook, feature branch on a develop remote: ${offDevelop.stderr}`);
});

// why: catches a commit that weakens a test its parent holds, new test files included, passing CI unseen (K367 S2)
test('test-integrity fails a commit that changes or deletes a line of a test its parent holds, outside a retest: commit', () => {
	// A weakened line of a test the base holds.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1') });
		const weak = commit(dir, 'fix: loosen the add check');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, r.out);
		assert.ok(r.out.includes(weak.slice(0, 7)), `names the commit: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
		// The failure names the remedy (S4): reword the commit to retest: and force-push after the owner's yes.
		assert.match(r.out, /retest:/);
		assert.match(r.out, /force/i);
		assert.match(r.out, /owner/i);
	}
	// A deleted test file.
	{
		const { dir, base } = prRepo();
		fs.rmSync(path.join(dir, 'tests', 'add.test.mjs'));
		commit(dir, 'fix: drop the add test file');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// A commit that only removes one assertion line: a pure deletion of a line.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': T0.replace('  assert.equal(1 + 1, 2);\n', '') });
		const cut = commit(dir, 'fix: drop an assertion');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, r.out);
		assert.ok(r.out.includes(cut.slice(0, 7)), `names the commit: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// A new test file (the red commit's own) weakened by a later commit in the range: the file is not on the base.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/new.test.mjs': T0.replace("'adds'", "'adds new'") });
		commit(dir, 'test: add the new cases');
		put(dir, { 'tests/new.test.mjs': T0.replace("'adds'", "'adds new'").replace('1 + 1, 2', '1, 1') });
		const weak = commit(dir, 'fix: make the new case pass');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, r.out);
		assert.ok(r.out.includes(weak.slice(0, 7)), `names the commit: ${r.out}`);
		assert.match(r.out, /tests\/new\.test\.mjs/);
	}
	// Control: a source-only change and a new test file with no later edit pass.
	{
		const { dir, base } = prRepo();
		put(dir, { 'src/add.js': `${SRC0}// tidy\n` });
		commit(dir, 'fix: tidy add');
		put(dir, { 'tests/new.test.mjs': T0.replace("'adds'", "'adds new'") });
		commit(dir, 'test: add the new cases');
		const r = integrity(dir, base);
		assert.equal(r.code, 0, r.out);
	}
});

// why: catches a pure addition to a test file switching off a test or a whole file past CI (K367 S3)
test('test-integrity passes a pure addition only inside a new test( block and fails one inside an old test', () => {
	const added = "\ntest('adds two', () => {\n  assert.equal(2 + 2, 4);\n});\n";
	// A new test( block the parent lacks: passes.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': T0 + added });
		commit(dir, 'test: add the two case');
		const r = integrity(dir, base);
		assert.equal(r.code, 0, r.out);
	}
	// An added process.exit(0) ahead of every test: switches the whole file off.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': `process.exit(0);\n${T0}` });
		const exit = commit(dir, 'test: add a guard line');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, r.out);
		assert.ok(r.out.includes(exit.slice(0, 7)), `names the commit: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// An added early return inside an old test: switches that test off.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': T0.replace("() => {\n", "() => {\n  return;\n") });
		commit(dir, 'test: add an early return');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// An added line inside the new block is still inside it, so a block with its own extra line passes.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': T0 + added.replace('  assert.equal(2 + 2, 4);\n', '  const four = 4;\n  assert.equal(2 + 2, four);\n') });
		commit(dir, 'test: add the two case');
		assert.equal(integrity(dir, base).code, 0);
	}
	// A statement after the close on the block's own last line, with nothing after it, is a finding too.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': `${T0}\ntest('x', () => {\n  assert.ok(true);\n}); process.exit(0);\n` });
		commit(dir, 'test: add the x case');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `trailing statement on the close line: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// A "new" block that closes and then carries a trailing statement on the same added lines is not a pure block.
	{
		const { dir, base } = prRepo();
		const trick = "\ntest('x', () => {\n  assert.ok(true);\n}); process.exit(0); test('y', () => {\n  assert.ok(true);\n});\n";
		put(dir, { 'tests/add.test.mjs': T0 + trick });
		commit(dir, 'test: add the x case');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `trailing statement: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// Added lines that open a template literal in one new block and close it in another turn every old test between
	// them into text: the file still loads, and the old tests never run.
	{
		const { dir, base } = prRepo();
		const swallow = `test('z', () => {\n  const s = \`\n});\n${T0}\ntest('w', () => {\n  const t = \`;\n});\n`;
		put(dir, { 'tests/add.test.mjs': swallow });
		commit(dir, 'test: add the z and w cases');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `template literal: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// The same with a block comment opened in an added line and closed in a later one.
	{
		const { dir, base } = prRepo();
		const swallow = `test('z', () => { /*\n});\n${T0}\ntest('w', () => { /* */\n  const t = 1; /*/ */;\n});\n`;
		put(dir, { 'tests/add.test.mjs': swallow });
		commit(dir, 'test: add the z and w cases');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `block comment: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
});

// why: catches a retest: commit missing from the owner's list or touching source and passing unseen (K367 S4)
test('test-integrity passes a retest: commit and lists it in retests.json and the step summary, and fails one that touches source', () => {
	const { dir, base } = prRepo();
	put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1') });
	const retest = commit(dir, 'retest: tighten the add case');
	const out = kitTemp.makeTemp('integrity-out-');
	const file = path.join(out, 'retests.json');
	const summary = path.join(out, 'summary.md');
	const r = integrity(dir, base, ['--retests', file], { GITHUB_STEP_SUMMARY: summary });
	assert.equal(r.code, 0, r.out);
	const list = JSON.parse(fs.readFileSync(file, 'utf8'));
	assert.equal(list.length, 1, JSON.stringify(list));
	assert.ok(list[0].sha.length >= 7 && retest.startsWith(list[0].sha), `sha ${list[0].sha}`);
	assert.equal(list[0].subject, 'retest: tighten the add case');
	assert.deepEqual(list[0].files, ['tests/add.test.mjs']);
	const line = new RegExp(`^retest: ${list[0].sha.slice(0, 7)}[0-9a-f]* \`retest: tighten the add case\`$`, 'm');
	assert.match(fs.readFileSync(summary, 'utf8'), line);
	// Only a subject that starts with retest: is exempt: a retest: later in the subject, or in the body, is not.
	for (const [subject, body] of [['fix: retest: tighten the add case', null], ['fix: loosen', 'retest: approved']]) {
		const w = prRepo();
		put(w.dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1') });
		git(w.dir, ['add', '-A']);
		git(w.dir, ['commit', '-q', '-m', subject, ...(body ? ['-m', body] : [])]);
		const sha = git(w.dir, ['rev-parse', 'HEAD']);
		const wf = path.join(out, `w${subject.length}.json`);
		const x = integrity(w.dir, w.base, ['--retests', wf]);
		assert.equal(x.code, 1, `${subject}: ${x.out}`);
		assert.ok(x.out.includes(sha.slice(0, 7)), `names the commit: ${x.out}`);
		const listedFile = fs.existsSync(wf) ? JSON.parse(fs.readFileSync(wf, 'utf8')) : [];
		assert.deepEqual(listedFile, [], `${subject} is not listed as a retest`);
	}
	// Every scope form the commit check allows is still a retest.
	{
		const s = prRepo();
		put(s.dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1') });
		const scoped = commit(s.dir, 'retest(add): tighten the add case');
		const sf = path.join(out, 'scoped.json');
		const x = integrity(s.dir, s.base, ['--retests', sf]);
		assert.equal(x.code, 0, x.out);
		const l = JSON.parse(fs.readFileSync(sf, 'utf8'));
		assert.equal(l.length, 1);
		assert.ok(scoped.startsWith(l[0].sha));
	}
	// A retest: commit that also touches a non-test path fails and names that path.
	{
		const bad = prRepo();
		put(bad.dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1'), 'src/add.js': `${SRC0}// sneaked\n` });
		const sneaky = commit(bad.dir, 'retest: tighten the add case');
		const f = integrity(bad.dir, bad.base, ['--retests', path.join(out, 'bad.json')]);
		assert.equal(f.code, 1, f.out);
		assert.ok(f.out.includes(sneaky.slice(0, 7)), `names the commit: ${f.out}`);
		assert.match(f.out, /src\/add\.js/);
	}
});

// why: catches CI running the PR's own copy of test-integrity so a PR could change the check that grades it (K367 S5)
test('ci.yml runs the base commit copy of test-integrity, never the PR copy, in its own job', () => {
	const ci = fs.readFileSync(CI, 'utf8');
	const start = ci.search(/^ {2}test-integrity:\s*$/m);
	assert.ok(start >= 0, 'ci.yml has a test-integrity job');
	const rest = ci.slice(start + 1);
	const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
	const job = next < 0 ? rest : rest.slice(0, next);
	assert.match(job, /github\.event_name == 'pull_request'/, 'runs on pull requests');
	assert.match(job, /fetch-depth: 0/, 'full history, so a shallow clone is not what it judges');
	assert.match(job, /git archive "\$BASE_SHA" scripts/, 'unpacks the base commit scripts from git objects');
	assert.match(job, /GIT_NO_REPLACE_OBJECTS: '1'/, 'reads no replace ref');
	assert.match(job, /G="\$RUNNER_TEMP\/base"/, 'the base unpack is the copy it runs');
	assert.match(job, /node "\$G\/scripts\/test-integrity\.mjs" "\$BASE_SHA"[^\n]*--retests "\$RUNNER_TEMP\/retests\.json"/, 'runs the base copy and writes retests.json');
	assert.doesNotMatch(ci, /node\s+(\.\/)?scripts\/test-integrity\.mjs/, 'no step runs the PR copy by its bare path');
	// The required rollup waits for the job and fails on anything but success or skipped.
	const kStart = ci.search(/^ {2}kit-tests:\s*$/m);
	assert.ok(kStart >= 0, 'ci.yml has the kit-tests rollup');
	const kRest = ci.slice(kStart + 1);
	const kNext = kRest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
	const kit = kNext < 0 ? kRest : kRest.slice(0, kNext);
	assert.match(kit, /^ {4}needs: \[[^\]]*\btest-integrity\b[^\]]*\]/m, 'kit-tests needs test-integrity');
	assert.match(kit, /needs\.test-integrity\.result != 'success' && needs\.test-integrity\.result != 'skipped'/, 'its gate fails on any result but success or skipped');
	// Every use of the script, in any spelling, sits under the base unpack.
	const uses = ci.split('\n').filter((l) => l.includes('test-integrity.mjs') && !/^\s*#/.test(l));
	assert.ok(uses.length > 0, 'ci.yml uses the script');
	for (const l of uses) assert.ok(!l.replace(/\$G\/scripts\/test-integrity\.mjs/g, '').includes('test-integrity.mjs'), `not under the base unpack: ${l.trim()}`);
});

// why: catches a PR body that leaves out a retest the owner must see before the merge yes (K367 S6)
test('the PR body check fails a body that leaves out a retest: commit of the PR and passes one that lists it', () => {
	const { dir, base } = prRepo();
	// Control: no retest in the range, and the honest body passes unchanged.
	put(dir, { 'src/add.js': `${SRC0}// tidy\n` });
	commit(dir, 'feat: tidy add');
	const run = (text) => {
		const f = path.join(dir, 'body.md');
		fs.writeFileSync(f, text);
		const r = spawnSync(process.execPath, [AUDIT, f, STD_TITLE, '31'], { cwd: dir, env: isolatedEnv({ PR_BASE: base }), encoding: 'utf8' });
		return { code: r.status, out: `${r.stdout}${r.stderr}` };
	};
	const clean = run(honestBody());
	assert.equal(clean.code, 0, clean.out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
	put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1') });
	const retest = commit(dir, 'retest: tighten the add case');
	const short = retest.slice(0, 7);
	const missing = run(honestBody());
	assert.equal(missing.code, 1, missing.out);
	assert.match(missing.out, /FAIL[^\n]*retest/i);
	assert.ok(missing.out.includes(short), `names the missing retest: ${missing.out}`);
	const listed = run(`${honestBody().trimEnd()}\n\nretest: ${short} retest: tighten the add case\n`);
	assert.equal(listed.code, 0, listed.out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
	// A second retest: a body that lists only the first fails and names the second.
	put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '2, 2') });
	const second = commit(dir, 'retest: tighten it again');
	const only = run(`${honestBody().trimEnd()}\n\nretest: ${short} retest: tighten the add case\n`);
	assert.equal(only.code, 1, only.out);
	assert.ok(only.out.includes(second.slice(0, 7)), `names the second retest: ${only.out}`);
	// A wrong sha lists nothing: it fails and still names the real one.
	const wrong = run(`${honestBody().trimEnd()}\n\nretest: ${short} retest: tighten the add case\nretest: 1234567 retest: tighten it again\n`);
	assert.equal(wrong.code, 1, wrong.out);
	assert.ok(wrong.out.includes(second.slice(0, 7)), `names the second retest: ${wrong.out}`);
	const both = run(`${honestBody().trimEnd()}\n\nretest: ${short} retest: tighten the add case\nretest: ${second.slice(0, 7)} retest: tighten it again\n`);
	assert.equal(both.code, 0, both.out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
	// A retest named only inside an HTML comment is not on the page: it fails.
	const hidden = run(`${honestBody().trimEnd()}\n\n<!-- retest: ${short} retest: tighten the add case -->\n<!-- retest: ${second.slice(0, 7)} retest: tighten it again -->\n`);
	assert.equal(hidden.code, 1, hidden.out);
	assert.match(hidden.out, /^FAIL +every retest/m, 'the retest row is what fails, not the comment markers');
	// The lean format (the small PR's body) holds the same list.
	// The example is trimmed by one change line so that the body listing both retests stays inside the audit's own
	// 180-word and 18-line caps, which the retest lines count toward like any other line.
	const leanFull = fs.readFileSync(path.resolve('user/skills/pr-body/examples/lean.md'), 'utf8');
	const lean = leanFull.replace(/^- Each step keeps the old deadline[^\n]*\n/m, '');
	assert.notEqual(lean, leanFull, 'the example line to trim is there');
	const leanTitle = lean.split('\n')[0].replace(/^## /, '').replace(/^[A-Za-z ]+: /, 'feat: ');
	const runLean = (text) => {
		const f = path.join(dir, 'lean-body.md');
		fs.writeFileSync(f, text);
		const r = spawnSync(process.execPath, [path.resolve('project/.claude/pr-body-audit-lean.mjs'), f, leanTitle], { cwd: dir, env: isolatedEnv({ PR_BASE: base }), encoding: 'utf8' });
		return { code: r.status, out: `${r.stdout}${r.stderr}` };
	};
	const leanMissing = runLean(lean);
	assert.equal(leanMissing.code, 1, `lean, no retest named: ${leanMissing.out}`);
	assert.match(leanMissing.out, /FAIL[^\n]*retest/i);
	assert.ok(leanMissing.out.includes(short), `lean names the missing retest: ${leanMissing.out}`);
	const leanListed = runLean(`${lean.trimEnd()}\n\nretest: ${short} retest: tighten the add case\nretest: ${second.slice(0, 7)} retest: tighten it again\n`);
	assert.equal(leanListed.code, 0, leanListed.out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
});

// why: catches a changed parent test hidden by a merge, rename, case change, binary file or replace ref (K367 S2 bypass)
test('test-integrity still fails a test change hidden by a merge, a rename, a case change, a binary file or a replace ref', () => {
	// A merge commit whose resolution weakens the test: only the combined diff shows it.
	{
		const { dir, base } = prRepo();
		git(dir, ['checkout', '-q', '-b', 'side', base]);
		put(dir, { 'src/side.js': 'export const side = 1;\n' });
		commit(dir, 'feat: side');
		git(dir, ['checkout', '-q', 'feat/x']);
		put(dir, { 'src/own.js': 'export const own = 1;\n' });
		commit(dir, 'feat: own');
		git(dir, ['merge', '-q', '--no-ff', '--no-commit', 'side']);
		put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1') });
		const merge = commit(dir, 'merge side');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `merge: ${r.out}`);
		assert.ok(r.out.includes(merge.slice(0, 7)), `merge: names the commit: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// Control: a clean merge of a source-only side branch passes.
	{
		const { dir, base } = prRepo();
		git(dir, ['checkout', '-q', '-b', 'side', base]);
		put(dir, { 'src/side.js': 'export const side = 1;\n' });
		commit(dir, 'feat: side');
		git(dir, ['checkout', '-q', 'feat/x']);
		put(dir, { 'src/own.js': 'export const own = 1;\n' });
		commit(dir, 'feat: own');
		git(dir, ['merge', '-q', '--no-ff', '-m', 'merge side', 'side']);
		assert.equal(integrity(dir, base).code, 0);
	}
	// A rename of the test out of the test folders.
	{
		const { dir, base } = prRepo();
		git(dir, ['mv', 'tests/add.test.mjs', 'src/moved.js']);
		commit(dir, 'fix: move the add test');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `rename: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// A case-only rename, made in the index so the file system's case rules cannot hide it.
	{
		const { dir, base } = prRepo();
		const blob = git(dir, ['rev-parse', 'HEAD:tests/add.test.mjs']);
		git(dir, ['rm', '-q', '--cached', 'tests/add.test.mjs']);
		git(dir, ['update-index', '--add', '--cacheinfo', `100644,${blob},tests/Add.test.mjs`]);
		git(dir, ['commit', '-q', '-m', 'fix: tidy names']);
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `case change: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/i);
	}
	// A binary test fixture, which numstat prints as "-	-" with no count.
	{
		const { dir, base } = prRepo({ 'tests/data/blob.bin': Buffer.from([0, 1, 2, 3]) });
		fs.writeFileSync(path.join(dir, 'tests', 'data', 'blob.bin'), Buffer.from([0, 1, 2, 4]));
		commit(dir, 'fix: change the fixture');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `binary: ${r.out}`);
		assert.match(r.out, /tests\/data\/blob\.bin/);
	}
	// A replace ref that hands the base back with the weakened test already in it: the true diff is read.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1') });
		const weak = commit(dir, 'fix: loosen the add check');
		const fake = git(dir, ['commit-tree', `${weak}^{tree}`, '-m', 'base as the PR wants it']);
		git(dir, ['replace', base, fake]);
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `replace ref: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// The whole branch against its base: main moves on with a test edit (the base holds it), the branch merges main and
	// takes its own side of the test back. No single commit's diff in the range shows a change, yet the test differs.
	{
		const { dir, base } = prRepo();
		git(dir, ['checkout', '-q', 'main']);
		put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '2 + 2, 4') });
		const mainTip = commit(dir, 'test: tighten the add case');
		git(dir, ['checkout', '-q', 'feat/x']);
		put(dir, { 'src/own.js': 'export const own = 1;\n' });
		commit(dir, 'feat: own');
		git(dir, ['merge', '-q', '--no-ff', '-s', 'ours', '-m', 'merge main', 'main']);
		const r = integrity(dir, mainTip);
		assert.equal(r.code, 1, `net change: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// A merge that drops lines of a base-side test which a clean automatic merge would keep: the same net check holds it.
	{
		const { dir, base } = prRepo();
		git(dir, ['checkout', '-q', 'main']);
		put(dir, { 'tests/add.test.mjs': `${T0}\ntest('adds two', () => {\n  assert.equal(2 + 2, 4);\n});\n` });
		const mainTip = commit(dir, 'test: add the two case');
		git(dir, ['checkout', '-q', 'feat/x']);
		put(dir, { 'src/own.js': 'export const own = 1;\n' });
		commit(dir, 'feat: own');
		git(dir, ['merge', '-q', '--no-ff', '-s', 'ours', '-m', 'merge main', 'main']);
		const r = integrity(dir, mainTip);
		assert.equal(r.code, 1, `dropped base lines: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
		// Control: the clean automatic merge keeps them and passes.
		git(dir, ['reset', '-q', '--hard', 'HEAD~1']);
		git(dir, ['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
		assert.equal(integrity(dir, mainTip).code, 0);
	}
	// A weaker copy of a test the red commit added, brought in by a merge that takes the side copy, with one more commit on
	// top so the merge is not HEAD: the file is not on the base, so only the red commit's copy shows what was weakened.
	{
		const { dir, base } = prRepo();
		const strong = T0.replace("'adds'", "'adds new'");
		const weaker = strong.replace('1 + 1, 2', '1, 1');
		git(dir, ['checkout', '-q', '-b', 'side', base]);
		put(dir, { 'tests/new.test.mjs': weaker });
		commit(dir, 'feat: side copy');
		git(dir, ['checkout', '-q', 'feat/x']);
		put(dir, { 'tests/new.test.mjs': strong });
		commit(dir, 'test: add the new cases');
		spawnSync('git', ['merge', '--no-ff', '--no-commit', 'side'], { cwd: dir, env: isolatedEnv(GIT_ID), encoding: 'utf8' });
		put(dir, { 'tests/new.test.mjs': weaker });
		const merge = commit(dir, 'merge side');
		put(dir, { 'src/own.js': 'export const own = 1;\n' });
		commit(dir, 'feat: own');
		assert.notEqual(git(dir, ['rev-parse', 'HEAD']), merge, 'the merge is not HEAD');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `merge brought a weaker copy: ${r.out}`);
		assert.match(r.out, /tests\/new\.test\.mjs/);
	}
	// A merge whose result equals the base is not skipped when an in-range parent changed the path: (a) the result resets
	// a test file to the base copy and discards an assertion a parent added inside an old test; (b) the result deletes a
	// test file a parent holds (absent and absent are not "equal"); control: no parent touched the path, so it passes.
	// Each has one more commit on top so the merge is not HEAD.
	for (const [what, sideEdit, resolve, want] of [
		['reset to base', { 'tests/add.test.mjs': T0.replace('  assert.equal(1 + 1, 2);\n', '  assert.equal(1 + 1, 2);\n  assert.equal(2 + 2, 4);\n') }, () => ({ 'tests/add.test.mjs': T0 }), 1],
		['deleted', { 'tests/extra.test.mjs': T0.replace("'adds'", "'extra'") }, null, 1],
		['control: untouched by a parent', { 'src/side.js': 'export const side = 1;\n' }, () => ({ 'tests/add.test.mjs': T0 }), 0],
	]) {
		const { dir, base } = prRepo();
		git(dir, ['checkout', '-q', '-b', 'side', base]);
		put(dir, sideEdit);
		commit(dir, what === 'reset to base' ? 'retest: add an assertion' : 'test: side change');
		git(dir, ['checkout', '-q', 'feat/x']);
		put(dir, { 'src/own.js': 'export const own = 1;\n' });
		commit(dir, 'feat: own');
		spawnSync('git', ['merge', '--no-ff', '--no-commit', 'side'], { cwd: dir, env: isolatedEnv(GIT_ID), encoding: 'utf8' });
		if (resolve) put(dir, resolve());
		else fs.rmSync(path.join(dir, 'tests', 'extra.test.mjs'));
		const merge = commit(dir, 'merge side');
		put(dir, { 'src/more.js': 'export const more = 1;\n' });
		commit(dir, 'feat: more');
		assert.notEqual(git(dir, ['rev-parse', 'HEAD']), merge, 'the merge is not HEAD');
		const r = integrity(dir, base);
		assert.equal(r.code, want, `merge ${what}: ${r.out}`);
		if (want === 1) assert.ok(r.out.includes(merge.slice(0, 7)), `merge ${what}: names the merge: ${r.out}`);
	}
	// A test under a folder named ":" and one whose name starts with ":(" are judged like any other: a path is never read
	// as pathspec magic. Made in the index, since a working folder cannot hold such names on every system.
	{
		const { dir, base } = prRepo();
		const stage = (rel, body) => {
			const h = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, env: isolatedEnv(GIT_ID), input: body, encoding: 'utf8' }).stdout.trim();
			git(dir, ['-c', 'core.protectNTFS=false', 'update-index', '--add', '--cacheinfo', `100644,${h},${rel}`]);
		};
		const paths = [':/odd.test.mjs', ':(top)odd.test.mjs'];
		for (const p of paths) stage(p, T0.replace("'adds'", "'odd'"));
		git(dir, ['commit', '-q', '-m', 'test: add the odd cases']);
		for (const p of paths) stage(p, T0.replace("'adds'", "'odd'").replace('1 + 1, 2', '1, 1'));
		git(dir, ['commit', '-q', '-m', 'fix: make the odd case pass']);
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `odd path names: ${r.out}`);
		for (const p of paths) assert.ok(r.out.includes(`${p}: a line of the test is changed or removed`), `${p} is judged by its lines like any test: ${r.out}`);
	}
	// A merge whose result lacks a test file the base holds fails as a deletion even when neither in-range parent holds it:
	// the branch was cut before the file existed, the base (main) added it, and the merge of main drops it.
	{
		const dir = kitTemp.makeTemp('integrity-repo-');
		git(dir, ['init', '-q', '-b', 'main']);
		put(dir, { 'src/add.js': SRC0 });
		commit(dir, 'chore: before the test');
		git(dir, ['checkout', '-q', '-b', 'feat/x']);
		put(dir, { 'src/own.js': 'export const own = 1;\n' });
		commit(dir, 'feat: own');
		git(dir, ['checkout', '-q', 'main']);
		put(dir, { 'tests/add.test.mjs': T0 });
		const base = commit(dir, 'test: add the add case');
		git(dir, ['checkout', '-q', 'feat/x']);
		spawnSync('git', ['merge', '--no-ff', '--no-commit', 'main'], { cwd: dir, env: isolatedEnv(GIT_ID), encoding: 'utf8' });
		fs.rmSync(path.join(dir, 'tests', 'add.test.mjs'));
		commit(dir, 'merge main');
		put(dir, { 'src/more.js': 'export const more = 1;\n' });
		commit(dir, 'feat: more');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `merge dropped a base test: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
		assert.match(r.out, /deleted/i);
	}
	// A clean merge of main passes when main edited a line of an existing test in a retest: commit and the branch never
	// touched tests: a merge may not drop what the branch's own side did, but it brings main's own edits. Two shapes: a local
	// `git merge main` with one commit on top, and the CI merge ref, a commit-tree merge with parents (base, feature head).
	// An evil merge, whose result weakens a line neither parent changed, still fails.
	{
		const mainEdit = T0.replace('1 + 1, 2', '2 + 2, 4');
		const cut = () => {
			const { dir, base: b0 } = prRepo();
			git(dir, ['checkout', '-q', 'main']);
			put(dir, { 'tests/add.test.mjs': mainEdit });
			const mainTip = commit(dir, 'retest: tighten the add case');
			git(dir, ['checkout', '-q', 'feat/x']);
			put(dir, { 'src/own.js': 'export const own = 1;\n' });
			const feat = commit(dir, 'feat: own');
			return { dir, b0, mainTip, feat };
		};
		{
			const { dir, b0 } = cut();
			git(dir, ['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
			put(dir, { 'src/more.js': 'export const more = 1;\n' });
			commit(dir, 'feat: more');
			const r = integrity(dir, b0);
			assert.equal(r.code, 0, `local clean merge of main with a retest edit: ${r.out}`);
		}
		{
			const { dir, mainTip, feat } = cut();
			git(dir, ['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
			const tree = git(dir, ['rev-parse', 'HEAD^{tree}']);
			const ref = git(dir, ['commit-tree', tree, '-p', mainTip, '-p', feat, '-m', 'Merge pull request']);
			git(dir, ['checkout', '-q', '--detach', ref]);
			const r = integrity(dir, mainTip);
			assert.equal(r.code, 0, `CI merge ref (base, feature head): ${r.out}`);
		}
		{
			const { dir, b0 } = cut();
			git(dir, ['merge', '-q', '--no-ff', '--no-commit', 'main']);
			put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1, 1') });
			const evil = commit(dir, 'merge main');
			put(dir, { 'src/more.js': 'export const more = 1;\n' });
			commit(dir, 'feat: more');
			const r = integrity(dir, b0);
			assert.equal(r.code, 1, `evil merge: ${r.out}`);
			assert.ok(r.out.includes(evil.slice(0, 7)), `evil merge: names the merge: ${r.out}`);
		}
	}
	// A merge built with commit-tree (parents: the base, the feature head) whose tree is the feature's drops a test the base
	// holds, at a path that is pathspec magic (":/x.test.mjs") and at a plain one run from a subfolder of the checkout.
	for (const [rel, sub] of [[':/x.test.mjs', ''], ['tests/add.test.mjs', 'src']]) {
		const { dir } = prRepo();
		git(dir, ['checkout', '-q', '-b', 'older', 'main']);
		git(dir, ['rm', '-q', '-r', 'tests']);
		const older = commit(dir, 'chore: before the test');
		git(dir, ['checkout', '-q', '-b', 'feat/y']);
		put(dir, { 'src/own.js': 'export const own = 1;\n' });
		const feat = commit(dir, 'feat: own');
		// The base: the older commit plus the test, built in a private index so no working folder has to hold the path.
		const idx = path.join(kitTemp.makeTemp('integrity-idx-'), 'index');
		const priv = (args, input) => {
			const x = spawnSync('git', ['-c', 'core.protectNTFS=false', ...args], { cwd: dir, env: isolatedEnv({ ...GIT_ID, GIT_INDEX_FILE: idx }), input, encoding: 'utf8' });
			assert.equal(x.status, 0, `git ${args.join(' ')}: ${x.stderr}`);
			return x.stdout.trim();
		};
		priv(['read-tree', older]);
		const blob = priv(['hash-object', '-w', '--stdin'], T0);
		priv(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`]);
		const base = git(dir, ['commit-tree', priv(['write-tree']), '-p', older, '-m', 'test: add the case']);
		const merge = git(dir, ['commit-tree', `${feat}^{tree}`, '-p', base, '-p', feat, '-m', 'Merge pull request']);
		git(dir, ['checkout', '-q', '--detach', merge]);
		assert.ok(fs.existsSync(SCRIPT), 'scripts/test-integrity.mjs exists');
		const cwd = sub ? path.join(dir, sub) : dir;
		const x = spawnSync(process.execPath, [SCRIPT, base], { cwd, env: isolatedEnv({ GITHUB_STEP_SUMMARY: '' }), encoding: 'utf8' });
		assert.equal(x.status, 1, `merge dropped ${rel}${sub ? ` (run from ${sub}/)` : ''}: ${x.stdout}${x.stderr}`);
	}
	// Text in a test file that looks like a diff header ("new file mode") does not stand in for a header: a changed line
	// in such a file is still judged.
	{
		const body = "new file mode 100644\ndeleted file mode 100644\nBinary files a and b differ\n";
		const { dir, base } = prRepo({ 'tests/headers.test.mjs': `${T0.replace("'adds'", "'headers'")}\n// ${body.replace(/\n/g, '\n// ')}\n${body.split('\n').map((l) => `const s${l.length} = \`\n${l}\n\`;`).join('\n')}\n` });
		const text = fs.readFileSync(path.join(dir, 'tests', 'headers.test.mjs'), 'utf8');
		fs.writeFileSync(path.join(dir, 'tests', 'headers.test.mjs'), text.replace('1 + 1, 2', '1, 1'));
		const sha = commit(dir, 'fix: change the headers case');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `header text: ${r.out}`);
		assert.ok(r.out.includes(sha.slice(0, 7)), `names the commit: ${r.out}`);
		assert.match(r.out, /tests\/headers\.test\.mjs/);
	}
});

// why: catches the same range giving a different verdict on a second run of test-integrity (K367 S2 repeat)
test('test-integrity gives the same verdict, findings and retests list on the same range run twice', () => {
	const sorted = (s) => s.split('\n').filter(Boolean).sort();
	const bad = prRepo();
	put(bad.dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1') });
	const first = commit(bad.dir, 'fix: loosen the add check');
	put(bad.dir, { 'tests/add.test.mjs': `process.exit(0);\n${T0}` });
	const second = commit(bad.dir, 'fix: add a guard line');
	const a = integrity(bad.dir, bad.base);
	const b = integrity(bad.dir, bad.base);
	assert.equal(a.code, 1, a.out);
	assert.equal(b.code, a.code);
	assert.deepEqual(sorted(b.out), sorted(a.out));
	for (const sha of [first, second]) assert.ok(a.out.includes(sha.slice(0, 7)) && b.out.includes(sha.slice(0, 7)), `both runs name ${sha.slice(0, 7)}`);
	// A passing range with a retest: the same code and the same list both times.
	const ok = prRepo();
	put(ok.dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1') });
	commit(ok.dir, 'retest: tighten the add case');
	const out = kitTemp.makeTemp('integrity-twice-');
	const x = integrity(ok.dir, ok.base, ['--retests', path.join(out, 'a.json')]);
	const y = integrity(ok.dir, ok.base, ['--retests', path.join(out, 'b.json')]);
	assert.equal(x.code, 0, x.out);
	assert.equal(y.code, 0, y.out);
	assert.equal(fs.readFileSync(path.join(out, 'b.json'), 'utf8'), fs.readFileSync(path.join(out, 'a.json'), 'utf8'));
});

// why: catches an unreadable base or a shallow clone passing the check as if nothing was found (K367 S7 fail-closed)
test('test-integrity exits 2 and says why when the base is unreadable, the clone is shallow or git cannot run', () => {
	// A base sha that is no commit here.
	{
		const { dir } = prRepo();
		commit(dir, 'fix: something');
		const r = integrity(dir, 'f'.repeat(40));
		assert.equal(r.code, 2, r.out);
		assert.ok(r.out.includes('ffffff'), `names the base: ${r.out}`);
	}
	// No base given.
	{
		const { dir } = prRepo();
		assert.equal(spawnSync(process.execPath, [SCRIPT], { cwd: dir, env: isolatedEnv(), encoding: 'utf8' }).status, 2);
	}
	// A shallow clone, with the base inside it: the history a weakening could sit in may be cut off.
	{
		const { dir } = prRepo();
		const first = commit(dir, 'feat: one');
		put(dir, { 'src/add.js': `${SRC0}// two\n` });
		commit(dir, 'feat: two');
		const parent = kitTemp.makeTemp('integrity-clone-');
		const clone = path.join(parent, 'c');
		git(parent, ['clone', '-q', '--depth', '2', pathToFileURL(dir).href, clone]);
		assert.ok(fs.existsSync(path.join(clone, '.git', 'shallow')), 'the clone is shallow');
		const r = integrity(clone, first);
		assert.equal(r.code, 2, r.out);
		assert.match(r.out, /shallow/i);
	}
	// git missing from PATH: the check cannot read anything, so it fails closed and says git was not found.
	{
		const { dir, base } = prRepo();
		commit(dir, 'fix: something');
		const env = isolatedEnv({ GITHUB_STEP_SUMMARY: '' });
		for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
		env.PATH = kitTemp.makeTemp('integrity-nopath-');
		assert.ok(fs.existsSync(SCRIPT), 'scripts/test-integrity.mjs exists');
		const r = spawnSync(process.execPath, [SCRIPT, base], { cwd: dir, env, encoding: 'utf8' });
		assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
		assert.match(`${r.stdout}${r.stderr}`, /git[^\n]*(not found|ENOENT|cannot|could not)/i);
	}
	// A folder that is no repository.
	{
		const r = integrity(kitTemp.makeTemp('integrity-none-'), 'a'.repeat(40));
		assert.equal(r.code, 2, r.out);
	}
});

// why: catches a fresh test( block whose arguments run code at load time or sit inside an old test passing as a pure addition
test('test-integrity fails a fresh test( block whose arguments are not a string, options and a function, or that sits in an old test', () => {
	// The arguments run at load time and replace assert.equal with a no-op for every test after it.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': `${T0}\ntest('setup', (assert.equal = () => {}, () => {}));\n` });
		commit(dir, 'test: add the setup case');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `a comma expression as the callback: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// A well-formed block at column 0 that sits inside an old test's own lines runs in that test's scope.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': T0.replace("() => {\n", "() => {\ntest('inner', () => {\n  assert.ok(true);\n});\n") });
		commit(dir, 'test: add the inner case');
		const r = integrity(dir, base);
		assert.equal(r.code, 1, `a block inside an old test: ${r.out}`);
		assert.match(r.out, /tests\/add\.test\.mjs/);
	}
	// Control: a string name, an options object and a function literal is a fresh block and passes.
	{
		const { dir, base } = prRepo();
		put(dir, { 'tests/add.test.mjs': `${T0}\ntest('adds two', { timeout: 5000 }, () => {\n  assert.equal(2 + 2, 4);\n});\n` });
		commit(dir, 'test: add the two case');
		const r = integrity(dir, base);
		assert.equal(r.code, 0, r.out);
	}
});

// why: catches a regex literal holding a bracket hiding the real end of a fresh block so a process.exit rides inside it
test('test-integrity fails a process.exit line that a regex literal with a bracket hides inside a fresh test( block', () => {
	const trick = "\ntest('r', () => {\n  const a = /\\(/;\n});\nprocess.exit(0);\ntest('s', () => {\n  const b = /\\)/;\n});\n";
	const { dir, base } = prRepo();
	put(dir, { 'tests/add.test.mjs': T0.replace("\ntest('adds'", `${trick}\ntest('adds'`) });
	const exit = commit(dir, 'test: add the r and s cases');
	const r = integrity(dir, base);
	assert.equal(r.code, 1, `a process.exit between two fresh blocks: ${r.out}`);
	assert.ok(r.out.includes(exit.slice(0, 7)), `names the commit: ${r.out}`);
	assert.match(r.out, /tests\/add\.test\.mjs/);
});

// why: catches a commit that edits the test runner or CI wiring and drops tests unlisted for the merge yes
test('test-integrity lists a commit that touches scripts/test-run.mjs or .github/workflows as kind runner, and does not fail it', () => {
	const { dir, base } = prRepo({ 'scripts/test-run.mjs': 'export const run = 1;\n', '.github/workflows/ci.yml': 'name: ci\n' });
	put(dir, { 'scripts/test-run.mjs': 'export const run = 2;\n', '.github/workflows/ci.yml': 'name: ci2\n' });
	const runner = commit(dir, 'fix: change the runner and the workflow');
	put(dir, { 'src/add.js': `${SRC0}// tidy\n` });
	commit(dir, 'fix: tidy add');
	const out = kitTemp.makeTemp('integrity-out-');
	const file = path.join(out, 'retests.json');
	const summary = path.join(out, 'summary.md');
	const r = integrity(dir, base, ['--retests', file], { GITHUB_STEP_SUMMARY: summary });
	assert.equal(r.code, 0, `a runner change is listed, never failed: ${r.out}`);
	const list = JSON.parse(fs.readFileSync(file, 'utf8'));
	assert.equal(list.length, 1, `only the runner commit is listed: ${JSON.stringify(list)}`);
	assert.ok(runner.startsWith(list[0].sha), `sha ${list[0].sha}`);
	assert.equal(list[0].kind, 'runner');
	const line = fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8').split('\n').find((l) => l.includes(runner.slice(0, 7))) : '';
	assert.match(line || '', /runner/, 'the step summary lists the runner commit');
});

// why: catches a retest subject with an open HTML comment or control character hiding later retest lines in the summary
test('test-integrity prints each retest subject in a code span with no angle brackets, ampersands or control characters', () => {
	const { dir, base } = prRepo();
	put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 1 + 1') });
	commit(dir, 'retest: hide <!-- the rest & more \u001b[31m');
	put(dir, { 'tests/add.test.mjs': T0.replace('1 + 1, 2', '1 + 1, 3 - 1') });
	commit(dir, 'retest: second line stays visible');
	const out = kitTemp.makeTemp('integrity-out-');
	const summary = path.join(out, 'summary.md');
	const r = integrity(dir, base, ['--retests', path.join(out, 'retests.json')], { GITHUB_STEP_SUMMARY: summary });
	assert.equal(r.code, 0, r.out);
	const text = fs.readFileSync(summary, 'utf8');
	assert.doesNotMatch(text, /[<>&]/, `no angle bracket or ampersand reaches the summary: ${text}`);
	assert.doesNotMatch(text, /[\u0000-\u0009\u000b-\u001f\u007f]/, 'no control character reaches the summary');
	const span = (words) => new RegExp(`\\x60[^\\x60\\n]*${words}[^\\x60\\n]*\\x60`);
	assert.match(text, span('hide[^`\\n]*the rest'), `the first subject is in a code span: ${text}`);
	assert.match(text, span('second line stays visible'), `the later subject is in a code span: ${text}`);
});
