// The test lock (U4, build 24, K308): after the red commit lands, the lead (never the builder) locks the unit with
// kit-unit-files.txt (the red sha first, then source files only); the builder's edit fence then refuses every test file
// and the list itself; a retest: commit (a test change after red) is held at push for the owner's yes; and the builder
// brief no longer has the builder write its own list. Every case runs in a temp git repo with HOME and the Claude
// folders pointed at temp dirs, so no test reads the real home.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { TAP_SID, ownerTaps } from './kit-helpers.mjs';

kitTemp.sessionRoot();
const LOCK = path.resolve('user/kit-tools/unit-lock.mjs');
const FENCE = path.resolve('user/kit-hooks/edit-fence.cjs');
const KIT_PRE_PUSH = path.resolve('.githooks/pre-push');
const PROJECT_PRE_PUSH = path.resolve('project/.githooks/pre-push');
const BRIEF = path.resolve('user/skills/agent-team-build/templates/builder-brief.md');
const ZERO = '0'.repeat(40);
// The test-file shapes both the lock and the fence are checked on. test_x.py is left out: unit-check, whose test-file
// rule the lock follows, does not count it, and the edit fence has no test-file rule of its own (it blocks by list).
const TEST_SHAPES = ['tests/helper.mjs', 'src/x.test.js', '__tests__/x.js'];

// A child environment whose home and Claude config folders are temp dirs.
function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('lock-home-');
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
// Commits everything in dir with the message and returns the new full sha.
function commit(dir, message) {
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
	return git(dir, ['rev-parse', 'HEAD']);
}
function repo() {
	const dir = kitTemp.makeTemp('lock-repo-');
	git(dir, ['init', '-q', '-b', 'main']);
	return dir;
}
// The unit's list file: git's own path for kit-unit-files.txt in this repo or worktree.
function listPath(dir) {
	return git(dir, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']);
}
function listLines(dir) {
	return fs.readFileSync(listPath(dir), 'utf8').split(/\r?\n/).filter(Boolean);
}
// The lead's lock for a unit: runs the lock tool at the red sha with the source files named.
function lock(dir, redSha, files) {
	const r = spawnSync(process.execPath, [LOCK, redSha, '--files', files.join(',')], { cwd: dir, env: isolatedEnv(), encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
// One PreToolUse call of the edit fence. agentType undefined is the lead's session (no agent_type in the call).
function fence(dir, agentType, filePath, toolName = 'Edit') {
	const input = JSON.stringify({ cwd: dir, agent_type: agentType, tool_name: toolName, tool_input: { file_path: filePath } });
	const r = spawnSync(process.execPath, [FENCE], { cwd: dir, env: isolatedEnv(), input, encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
// A unit's red commit: two source files and a test file, committed on main.
function redRepo() {
	const dir = repo();
	put(dir, { 'src/add.js': 'export const add = (a, b) => a + b;\n', 'src/util.js': 'export const id = (x) => x;\n', 'tests/add.test.mjs': 'test("adds", () => {});\n' });
	const red = commit(dir, 'test: add cases');
	return { dir, red };
}
// A repo with a bare origin that already holds main, so pushes to feature branches are not first pushes.
function pushRepo() {
	const { dir, red } = redRepo();
	const bare = kitTemp.makeTemp('lock-bare-');
	git(bare, ['init', '-q', '--bare', '-b', 'main']);
	git(dir, ['remote', 'add', 'origin', bare]);
	git(dir, ['push', '-q', 'origin', 'main']);
	return { dir, red, bare };
}
// A pre-push run as git gives it: the refs on stdin, the remote name and URL as arguments. The AI markers and the
// owner's push marker are blanked so every run is a tool's push unless a test sets them.
const NO_MARKERS = { CLAUDECODE: '', AI_AGENT: '', CLAUDE_CODE_SESSION_ID: '', KIT_OWNER_PUSH: '', KIT_PUSH_APPROVED: '' };
function pushRun(hook, dir, bare, input, extra = {}) {
	return spawnSync('sh', [hook, 'origin', bare], { cwd: dir, env: isolatedEnv({ ...NO_MARKERS, ...extra }), input, encoding: 'utf8' });
}
// Pattern for a refusal that names the retest commit (by subject or short sha) and asks for the owner's yes.
const OWNER_YES = /owner'?s? yes/i;

// why: guards rule:agent-role-table (the lead's lock must hold the unit's source files, so the builder edits only those)
test('unit-lock writes the source files it is given to the unit file list and prints them', () => {
	const { dir, red } = redRepo();
	const r = lock(dir, red, ['src/add.js', 'src/util.js']);
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /src\/add\.js/);
	assert.match(r.out, /src\/util\.js/);
	assert.deepEqual(listLines(dir).filter((l) => !l.startsWith('#')), ['src/add.js', 'src/util.js']);
});

// why: catches a unit lock written with no red sha, so the file list is not tied to the red commit it locks
test('unit-lock writes the red sha as the first line of kit-unit-files.txt, then the source files', () => {
	const { dir, red } = redRepo();
	const r = lock(dir, red, ['src/add.js', 'src/util.js']);
	assert.equal(r.code, 0, r.out);
	assert.deepEqual(listLines(dir), [`# red ${red}`, 'src/add.js', 'src/util.js']);
});

// why: catches a lead's lock that lists a test file, which would let the builder rewrite the test it must pass
test('unit-lock exits 1 and names the test path it is given, and writes no test path to the list', () => {
	const { dir, red } = redRepo();
	const r = lock(dir, red, ['src/add.js', 'tests/add.test.mjs']);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /tests\/add\.test\.mjs/);
	const file = listPath(dir);
	const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
	assert.doesNotMatch(text, /add\.test\.mjs/);
});

// why: catches a test shape the lock lets through, so a builder can edit a test named by its shape
test('unit-lock exits 1 and names each test shape given to it, and writes none of them', () => {
	for (const shape of TEST_SHAPES) {
		const { dir, red } = redRepo();
		const r = lock(dir, red, ['src/add.js', shape]);
		assert.equal(r.code, 1, `${shape}: ${r.out}`);
		assert.match(r.out, new RegExp(shape.replace(/[.]/g, '\\.')), `${shape} is named`);
		const file = listPath(dir);
		const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
		assert.doesNotMatch(text, new RegExp(shape.replace(/[.]/g, '\\.')), `${shape} is not written`);
	}
});

// why: catches a unit lock given a sha that is no commit still writing a list, so the unit locks against nothing
test('unit-lock exits 2 and writes no list when the red sha is not a commit', () => {
	const { dir } = redRepo();
	const r = lock(dir, 'f'.repeat(40), ['src/add.js']);
	assert.equal(r.code, 2, r.out);
	assert.equal(fs.existsSync(listPath(dir)), false, 'no list file is written');
});

// why: catches a lock given a blob sha or plain text as its red point, which locks the unit to something that is no commit
test('unit-lock exits 2 and writes nothing when the red point is a blob sha or the text nope', () => {
	const { dir } = redRepo();
	const blob = git(dir, ['rev-parse', 'HEAD:src/add.js']);
	for (const sha of [blob, 'nope']) {
		const r = lock(dir, sha, ['src/add.js']);
		assert.equal(r.code, 2, `${sha}: ${r.out}`);
		assert.equal(fs.existsSync(listPath(dir)), false, `${sha}: no list file is written`);
	}
});

// why: catches a second lock appending to the first list, so an earlier unit's source files stay editable
test('a second unit-lock replaces the first list rather than adding to it', () => {
	const { dir, red } = redRepo();
	assert.equal(lock(dir, red, ['src/add.js']).code, 0);
	assert.equal(lock(dir, red, ['src/util.js']).code, 0);
	assert.deepEqual(listLines(dir), [`# red ${red}`, 'src/util.js']);
});

// why: catches a lock run in a linked worktree writing the main repo's list, which leaves the worktree's builder unlocked
test('unit-lock in a linked worktree writes the list where git rev-parse --git-path names for that worktree', () => {
	const { dir, red } = redRepo();
	const wt = path.join(kitTemp.makeTemp('lock-wt-parent-'), 'wt');
	git(dir, ['worktree', 'add', '-q', wt, '-b', 'feat/w']);
	const r = lock(wt, red, ['src/add.js']);
	assert.equal(r.code, 0, r.out);
	assert.notEqual(listPath(wt), listPath(dir), 'the worktree has its own list path');
	assert.ok(fs.existsSync(listPath(wt)), 'the list is at the worktree path');
	assert.deepEqual(listLines(wt), [`# red ${red}`, 'src/add.js']);
});

// why: catches the fence reading the red-sha comment line as a path, so a file named after it could be edited
test('edit fence ignores the # red line of the list, blocking a file named after it and allowing the listed source', () => {
	const { dir, red } = redRepo();
	const locked = lock(dir, red, ['src/add.js']);
	assert.equal(locked.code, 0, `lock written first: ${locked.out}`);
	assert.equal(listLines(dir)[0], `# red ${red}`, 'the list starts with the red line');
	const source = fence(dir, 'builder', path.join(dir, 'src', 'add.js'));
	assert.equal(source.code, 0, source.out);
	const named = fence(dir, 'builder', path.join(dir, `# red ${red}`));
	assert.equal(named.code, 2, named.out);
});

// why: catches a builder edit of a test file slipping past the lock, so the red test is rewritten to pass
test('edit fence blocks a builder edit of a test file under the lock and allows a listed source file', () => {
	const { dir, red } = redRepo();
	const locked = lock(dir, red, ['src/add.js']);
	assert.equal(locked.code, 0, `lock written first: ${locked.out}`);
	const source = fence(dir, 'builder', path.join(dir, 'src', 'add.js'));
	assert.equal(source.code, 0, source.out);
	const test = fence(dir, 'builder', path.join(dir, 'tests', 'add.test.mjs'));
	assert.equal(test.code, 2, test.out);
});

// why: catches a builder rewriting kit-unit-files.txt, which would widen its own file list past the lock
test('edit fence blocks a builder edit of kit-unit-files.txt itself', () => {
	const { dir, red } = redRepo();
	const locked = lock(dir, red, ['src/add.js']);
	assert.equal(locked.code, 0, `lock written first: ${locked.out}`);
	const r = fence(dir, 'builder', listPath(dir));
	assert.equal(r.code, 2, r.out);
});

// why: catches a builder writing a test through Write or MultiEdit, which the Edit-only check would let past the lock
test('edit fence blocks a builder Write or MultiEdit of a test file under the lock', () => {
	const { dir, red } = redRepo();
	assert.equal(lock(dir, red, ['src/add.js']).code, 0);
	for (const tool of ['Write', 'MultiEdit']) {
		const r = fence(dir, 'builder', path.join(dir, 'tests', 'add.test.mjs'), tool);
		assert.equal(r.code, 2, `${tool}: ${r.out}`);
	}
});

// why: catches a builder editing the list through its relative .git path, which names the list without its absolute spelling
test('edit fence blocks a builder edit of the list named by the relative path .git/kit-unit-files.txt', () => {
	const { dir, red } = redRepo();
	assert.equal(lock(dir, red, ['src/add.js']).code, 0);
	const r = fence(dir, 'builder', '.git/kit-unit-files.txt');
	assert.equal(r.code, 2, r.out);
});

// why: catches a test shape the builder's fence lets through, so a helper or a __tests__ file is editable mid-unit
test('edit fence blocks a builder edit of each test shape under the lock', () => {
	const { dir, red } = redRepo();
	assert.equal(lock(dir, red, ['src/add.js']).code, 0);
	for (const shape of TEST_SHAPES) {
		const r = fence(dir, 'builder', path.join(dir, ...shape.split('/')));
		assert.equal(r.code, 2, `${shape}: ${r.out}`);
	}
});

// why: catches a retest: commit pushed with no owner yes, so a test changed after red ships unseen
test('pre-push refuses a push whose range holds a retest: commit, names it and says an owner yes is needed', () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`);
	assert.notEqual(r.status, 0, `pre-push refused: ${r.stderr}`);
	assert.ok(r.stderr.includes('retest: tighten the add case') || r.stderr.includes(retest.slice(0, 7)), `the retest commit is named: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
});

// why: catches the owner's yes failing to lift a held retest push, so the one push that needs the owner stays stuck
test('pre-push holds a retest: range without the owner yes and lets it through with the owner yes to that push', () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const input = `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`;
	const held = pushRun(PROJECT_PRE_PUSH, dir, bare, input);
	assert.notEqual(held.status, 0, 'held without a yes');
	const cfg = kitTemp.makeTemp('lock-owner-');
	// The yes is dated a second before the push: owner-yes.cjs reads a yes dated after now as no yes at all.
	ownerTaps(cfg, dir, 'git push origin feat/x', { at: new Date(Date.now() - 1000).toISOString() });
	const yes = pushRun(PROJECT_PRE_PUSH, dir, bare, input, { KIT_OWNER_PUSH: '1', CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: TAP_SID });
	assert.equal(yes.status, 0, `the owner's yes lets the push through: ${yes.stderr}`);
});

// why: catches a push of an ordinary commit refused for a retest it does not hold, so every push stops
test('pre-push does not refuse a range with no retest: commit for that reason', () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 0;\n' });
	const feat = commit(dir, 'feat: tidy add');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${feat} refs/heads/feat/x ${red}\n`);
	assert.equal(r.status, 0, r.stderr);
	assert.doesNotMatch(r.stderr, /retest/);
	assert.doesNotMatch(r.stderr, OWNER_YES);
});

// why: catches a retest: commit at the start of a longer push passing because only the last commit is read
test('pre-push refuses a three-commit push whose first commit is a retest:, naming that commit', () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 0;\n' });
	commit(dir, 'feat: tidy add');
	put(dir, { 'src/util.js': 'export const id = (x) => x + 0;\n' });
	const last = commit(dir, 'feat: tidy util');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${last} refs/heads/feat/x ${red}\n`);
	assert.notEqual(r.status, 0, `pre-push refused: ${r.stderr}`);
	assert.ok(r.stderr.includes('retest: tighten the add case') || r.stderr.includes(retest.slice(0, 7)), `the retest commit is named: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
});

// why: catches a new-branch push (remote sha all zeros) that skips the secret scan, so a key goes out with a new branch
test('pre-push still scans a new-branch push whose remote sha is all zeros', () => {
	const { dir, bare } = pushRepo();
	put(dir, { 'src/keys.js': `export const key = '${['AKIA', 'IOSFODNN7EXAMPLE'].join('')}';\n` });
	const key = commit(dir, 'feat: add a key');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/new ${key} refs/heads/feat/new ${ZERO}\n`);
	assert.notEqual(r.status, 0, `the new branch was refused: ${r.stderr}`);
	assert.match(r.stderr, /secret/i);
});

// why: catches the kit's own pre-push passing a retest: range on to the remote, since the kit source runs that hook too
test("the kit's own pre-push refuses a range holding a retest: commit and says an owner yes is needed", () => {
	const { dir, red } = redRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = spawnSync('sh', [KIT_PRE_PUSH], { cwd: dir, env: isolatedEnv(NO_MARKERS), input: `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`, encoding: 'utf8' });
	assert.notEqual(r.status, 0, `the kit hook refused: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
});

// why: catches the builder brief telling the builder to write its own file list, which lets it widen its own fence
test('the builder brief template does not tell the builder to write its own file list', () => {
	const body = fs.readFileSync(BRIEF, 'utf8');
	assert.doesNotMatch(body, /before your first edit, write every path/i);
	// Lines are joined where a bullet wraps, so a sentence that spans lines is read whole.
	const joined = body.replace(/\n {2}/g, ' ');
	for (const line of joined.split('\n')) {
		assert.doesNotMatch(line, /\b(you|builder)\b[^.\n]*\b(write|create)\b[^.\n]*kit-unit-files/i, `a line tells the builder to write the list: ${line}`);
	}
	assert.match(body, /\blead\b[^\n]{0,80}kit-unit-files\.txt/, 'the brief names the lead as the writer of kit-unit-files.txt');
});

// why: catches a retest(scope): commit that slips past the hold's exact "retest:" match, so a scoped retest ships unseen in either hook
test('pre-push refuses a retest(scope): commit in both the kit and the project hook, naming its subject', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const retest = commit(dir, 'retest(lock): x');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} refused: ${r.stderr}`);
		assert.ok(r.stderr.includes('retest(lock): x'), `${hook} names the subject: ${r.stderr}`);
	}
});

// why: catches a push whose remote head this repo never fetched being read as unreadable, which blocks a push with no retest
test('pre-push lets a new branch with no retest through when the remote holds a head this repo never fetched', () => {
	const { dir, bare } = pushRepo();
	const parent = kitTemp.makeTemp('lock-other-');
	git(parent, ['clone', '-q', bare, 'other']);
	const other = path.join(parent, 'other');
	git(other, ['checkout', '-q', '-b', 'feat/other']);
	put(other, { 'src/util.js': 'export const id = (x) => x + 1;\n' });
	commit(other, 'feat: other clone work');
	git(other, ['push', '-q', 'origin', 'feat/other']);
	put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 0;\n' });
	const feat = commit(dir, 'feat: tidy add');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${feat} refs/heads/feat/x ${ZERO}\n`);
	assert.equal(r.status, 0, `a push with no retest goes through: ${r.stderr}`);
	assert.doesNotMatch(r.stderr, /cannot be read/);
});

// why: catches a new branch carrying a retest: commit going out unheld because only its own sha is read
test('pre-push refuses a new branch whose range holds a retest: commit', () => {
	const { dir, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/new ${retest} refs/heads/feat/new ${ZERO}\n`);
	assert.notEqual(r.status, 0, `the new branch was refused: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
});

// why: catches an update push re-refusing a retest the remote already holds on another branch, which blocks every merge of main
test('pre-push does not refuse an update push for a retest the remote already holds on another branch', () => {
	const { dir, red, bare } = pushRepo();
	git(dir, ['checkout', '-q', '-b', 'topic']);
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	commit(dir, 'retest: tighten the add case');
	git(dir, ['push', '-q', 'origin', 'topic']);
	git(dir, ['checkout', '-q', 'main']);
	git(dir, ['merge', '-q', '--no-ff', '-m', 'merge topic', 'topic']);
	git(dir, ['checkout', '-q', '-b', 'feat/x', red]);
	put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 0;\n' });
	const first = commit(dir, 'feat: first add');
	git(dir, ['push', '-q', 'origin', 'feat/x']);
	git(dir, ['merge', '-q', '--no-edit', 'main']);
	put(dir, { 'src/util.js': 'export const id = (x) => x + 0;\n' });
	const next = commit(dir, 'feat: tidy util');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${next} refs/heads/feat/x ${first}\n`);
	assert.equal(r.status, 0, `the update push goes through: ${r.stderr}`);
	assert.doesNotMatch(r.stderr, /retest/);
});

// why: catches the kit's own pre-push refusing a retest push even with the owner's pop-up yes to that push, unlike the project hook
test("the kit's own pre-push lets a retest: push through with the owner's pop-up yes to that push", () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const input = `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`;
	const cfg = kitTemp.makeTemp('lock-owner-kit-');
	ownerTaps(cfg, dir, 'git push origin feat/x', { at: new Date(Date.now() - 1000).toISOString() });
	const yes = pushRun(KIT_PRE_PUSH, dir, bare, input, { KIT_OWNER_PUSH: '1', CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: TAP_SID });
	assert.equal(yes.status, 0, `the owner's yes lets the kit hook's push through: ${yes.stderr}`);
});

// why: catches the kit's own pre-push passing a retest push with no owner yes; the refusal that names the owner's yes must stay
test("the kit's own pre-push refuses a retest: push with no owner's pop-up yes and names it", () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = pushRun(KIT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`);
	assert.notEqual(r.status, 0, `the kit hook refused: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
});

// why: catches an approved agent push of a retest commit refused even with the owner's pop-up yes to that push
test('pre-push lets a retest: push through on KIT_PUSH_APPROVED=1 with the owner\'s pop-up yes to that push', () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const input = `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`;
	const cfg = kitTemp.makeTemp('lock-approved-');
	ownerTaps(cfg, dir, 'KIT_PUSH_APPROVED=1 git push origin feat/x', { at: new Date(Date.now() - 1000).toISOString() });
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, input, { KIT_PUSH_APPROVED: '1', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: TAP_SID });
	assert.equal(r.status, 0, `the approved push with the owner's yes goes through: ${r.stderr}`);
});

// why: catches an approved retest push going through with no owner pop-up yes, so the marker alone lifts the hold
test('pre-push refuses a retest: push on KIT_PUSH_APPROVED=1 with no owner pop-up yes, naming it and the owner\'s yes', () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`, { KIT_PUSH_APPROVED: '1', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: TAP_SID });
	assert.notEqual(r.status, 0, `the marker alone did not lift the hold: ${r.stderr}`);
	assert.ok(r.stderr.includes('retest: tighten the add case') || r.stderr.includes(retest.slice(0, 7)), `the retest commit is named: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
});

// why: catches the kit's own pre-push refusing an approved retest push even with the owner's pop-up yes to that push
test("the kit's own pre-push lets a retest: push through on KIT_PUSH_APPROVED=1 with the owner's pop-up yes to that push", () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const input = `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`;
	const cfg = kitTemp.makeTemp('lock-approved-kit-');
	ownerTaps(cfg, dir, 'KIT_PUSH_APPROVED=1 git push origin feat/x', { at: new Date(Date.now() - 1000).toISOString() });
	const r = pushRun(KIT_PRE_PUSH, dir, bare, input, { KIT_PUSH_APPROVED: '1', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: TAP_SID });
	assert.equal(r.status, 0, `the approved push with the owner's yes goes through the kit hook: ${r.stderr}`);
});

// why: catches the kit's own pre-push passing an approved retest push with no owner pop-up yes, so the marker alone lifts it
test("the kit's own pre-push refuses a retest: push on KIT_PUSH_APPROVED=1 with no owner pop-up yes and names the owner's yes", () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = pushRun(KIT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`, { KIT_PUSH_APPROVED: '1', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: TAP_SID });
	assert.notEqual(r.status, 0, `the kit hook refused on the marker alone: ${r.stderr}`);
	assert.ok(r.stderr.includes('retest: tighten the add case') || r.stderr.includes(retest.slice(0, 7)), `the retest commit is named: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
});

// why: catches the builder brief keeping the test-first line or not naming the tester's red commit as never edited
test('the builder brief drops the test-first line and says the tester red commit is never edited', () => {
	const body = fs.readFileSync(BRIEF, 'utf8');
	assert.doesNotMatch(body, /Tests to write first/);
	assert.match(body, /tester'?s red commit[^\n]*never edit/i);
});

// why: catches the name check refusing a retest: subject or accepting a retest/ branch, which would break the retest type's rule
test('name-check accepts a retest: subject and refuses a retest/ branch name', () => {
	const NAME_CHECK = path.resolve('project/.claude/name-check.mjs');
	const msg = path.join(kitTemp.makeTemp('lock-msg-'), 'MSG');
	fs.writeFileSync(msg, 'retest: tighten the add case\n');
	const m = spawnSync(process.execPath, [NAME_CHECK, 'message', msg], { env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(m.status, 0, `the retest subject is accepted: ${m.stderr}`);
	const b = spawnSync(process.execPath, [NAME_CHECK, 'branch', 'retest/x'], { env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(b.status, 1, `the retest/ branch is refused: ${b.stdout}${b.stderr}`);
});
