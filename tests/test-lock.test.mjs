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
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
	// A leading ./ and a backslash spelling name the same file, so the list holds one spelling of each.
	const spelled = lock(dir, red, ['./src/add.js', 'src\\util.js']);
	assert.equal(spelled.code, 0, spelled.out);
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
	// A ./ prefix and backslashes are normalised before the test check, so the spelled path is refused as the test it is.
	const spelled = lock(dir, red, ['src/add.js', '.\\tests\\add.test.mjs']);
	assert.equal(spelled.code, 1, spelled.out);
	assert.match(spelled.out, /tests\/add\.test\.mjs/);
});

// why: catches a test shape the lock lets through, so a builder can edit a test named by its shape
test('unit-lock exits 1 and names each test shape given to it, and writes none of them', () => {
	// The lock's own shapes beyond the fence's: a test/ folder, a spec/ folder and a .spec. name.
	for (const shape of [...TEST_SHAPES, 'test/x.js', 'spec/x.js', 'src/x.spec.js']) {
		const { dir, red } = redRepo();
		const r = lock(dir, red, ['src/add.js', shape]);
		assert.equal(r.code, 1, `${shape}: ${r.out}`);
		assert.match(r.out, new RegExp(esc(shape)), `${shape} is named`);
		const file = listPath(dir);
		const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
		assert.doesNotMatch(text, new RegExp(esc(shape)), `${shape} is not written`);
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
	assert.match(test.out, /test file or the unit list/, 'the test-file rule names the block');
	// Folded control: catches a fence that lets a builder edit an unlisted source file, so the list would bind nothing.
	const unlisted = fence(dir, 'builder', path.join(dir, 'src', 'util.js'));
	assert.equal(unlisted.code, 2, unlisted.out);
	assert.match(unlisted.out, /not in this unit's file list/, 'the list rule names the block');
	// Folded control: catches a fence that blocks a tester's edit of the test file its list names, so the tester cannot write its tests.
	fs.writeFileSync(listPath(dir), `# red ${red}\nsrc/add.js\ntests/add.test.mjs\n`);
	const tester = fence(dir, 'tester', path.join(dir, 'tests', 'add.test.mjs'));
	assert.equal(tester.code, 0, tester.out);
});

// why: catches a builder edit of a test file that the unit list names, which the test-file rule must still block
test('edit fence blocks a builder edit of a test file that IS on the unit list', () => {
	const { dir, red } = redRepo();
	fs.writeFileSync(listPath(dir), `# red ${red}\nsrc/add.js\ntests/add.test.mjs\n`);
	const source = fence(dir, 'builder', path.join(dir, 'src', 'add.js'));
	assert.equal(source.code, 0, source.out);
	const test = fence(dir, 'builder', path.join(dir, 'tests', 'add.test.mjs'));
	assert.equal(test.code, 2, test.out);
	assert.match(test.out, /test file or the unit list/, 'the test-file rule blocks it, not the list rule');
});

// why: catches a fence that reads a builder's worktree under .claude/worktrees against the main repo's list, not its own
test('edit fence checks a builder edit in a worktree under .claude/worktrees against that worktree list', () => {
	const { dir, red } = redRepo();
	const wt = path.join(dir, '.claude', 'worktrees', 'build-1');
	git(dir, ['worktree', 'add', '-q', wt, '-b', 'feat/w1']);
	assert.equal(lock(wt, red, ['src/add.js']).code, 0);
	const source = fence(wt, 'builder', path.join(wt, 'src', 'add.js'));
	assert.equal(source.code, 0, source.out);
	const unlisted = fence(wt, 'builder', path.join(wt, 'src', 'util.js'));
	assert.equal(unlisted.code, 2, unlisted.out);
	const test = fence(wt, 'builder', path.join(wt, 'tests', 'add.test.mjs'));
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

// why: guards rule:test-integrity (retest: commit pushed with no owner yes)
test('pre-push refuses a push whose range holds a retest: commit, names it and says an owner yes is needed', () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`);
	assert.notEqual(r.status, 0, `pre-push refused: ${r.stderr}`);
	assert.ok(r.stderr.includes('retest: tighten the add case') || r.stderr.includes(retest.slice(0, 7)), `the retest commit is named: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
	// Folded control (was its own test): catches a push of an ordinary commit refused for a retest it does not hold, so every push stops.
	{
		git(dir, ['checkout', '-q', '-b', 'feat/ordinary', red]);
		put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 0;\n' });
		const feat = commit(dir, 'feat: tidy add');
		const ok = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${feat} refs/heads/feat/x ${red}\n`);
		assert.equal(ok.status, 0, ok.stderr);
		assert.doesNotMatch(ok.stderr, /retest/);
		assert.doesNotMatch(ok.stderr, OWNER_YES);
		// Near-miss control: catches a push held because a word like retesting, or retest: in a body, sits in the range, which the subject-only match must not do.
		put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 1;\n' });
		git(dir, ['add', '-A']);
		git(dir, ['commit', '-q', '-m', 'feat: retesting the add case', '-m', 'retest: named in the body only']);
		const near = git(dir, ['rev-parse', 'HEAD']);
		const nearOk = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${near} refs/heads/feat/x ${feat}\n`);
		assert.equal(nearOk.status, 0, nearOk.stderr);
		assert.doesNotMatch(nearOk.stderr, /retest/);
	}
});


// why: catches an update push that passes while the remote's main lacks the merge of a retest, or is held once that merge is on the remote's main
test('pre-push refuses a three-commit push whose first commit is a retest:, naming that commit, and lets an update push pass when the remote holds that retest', () => {
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
	// Folded control (was its own test): catches an update push re-refusing a retest the remote already holds on another branch, which blocks every merge of main.
	{
		const { dir: d2, red: r2, bare: b2 } = pushRepo();
		git(d2, ['checkout', '-q', '-b', 'topic']);
		put(d2, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		commit(d2, 'retest: tighten the add case');
		git(d2, ['push', '-q', 'origin', 'topic']);
		git(d2, ['checkout', '-q', 'main']);
		git(d2, ['merge', '-q', '--no-ff', '-m', 'merge topic', 'topic']);
		// Main is pushed before the update, so the remote's main holds the merge the update carries.
		git(d2, ['push', '-q', 'origin', 'main']);
		git(d2, ['checkout', '-q', '-b', 'feat/x', r2]);
		put(d2, { 'src/add.js': 'export const add = (a, b) => a + b + 0;\n' });
		const first = commit(d2, 'feat: first add');
		git(d2, ['push', '-q', 'origin', 'feat/x']);
		git(d2, ['merge', '-q', '--no-edit', 'main']);
		put(d2, { 'src/util.js': 'export const id = (x) => x + 0;\n' });
		const next = commit(d2, 'feat: tidy util');
		const up = pushRun(PROJECT_PRE_PUSH, d2, b2, `refs/heads/feat/x ${next} refs/heads/feat/x ${first}\n`);
		assert.equal(up.status, 0, `the update push goes through: ${up.stderr}`);
		assert.doesNotMatch(up.stderr, /retest/);
	}
	// Main not pushed: the same update is held, since the remote's main lacks the merge the update carries.
	{
		const { dir: d3, red: r3, bare: b3 } = pushRepo();
		git(d3, ['checkout', '-q', '-b', 'topic']);
		put(d3, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		commit(d3, 'retest: tighten the add case');
		git(d3, ['push', '-q', 'origin', 'topic']);
		git(d3, ['checkout', '-q', 'main']);
		git(d3, ['merge', '-q', '--no-ff', '-m', 'merge topic', 'topic']);
		git(d3, ['checkout', '-q', '-b', 'feat/x', r3]);
		put(d3, { 'src/add.js': 'export const add = (a, b) => a + b + 0;\n' });
		const first3 = commit(d3, 'feat: first add');
		git(d3, ['push', '-q', 'origin', 'feat/x']);
		git(d3, ['merge', '-q', '--no-edit', 'main']);
		put(d3, { 'src/util.js': 'export const id = (x) => x + 0;\n' });
		const next3 = commit(d3, 'feat: tidy util');
		const held3 = pushRun(PROJECT_PRE_PUSH, d3, b3, `refs/heads/feat/x ${next3} refs/heads/feat/x ${first3}\n`);
		assert.notEqual(held3.status, 0, `the update push passed with main unpushed, so the remote lacks the retest's merge: ${held3.stderr}`);
		assert.match(held3.stderr, HOLD_RE);
	}
});


// why: guards rule:agent-team-adapter (builder brief tells the builder to write its own file list)
test('the builder brief template does not tell the builder to write its own file list', () => {
	const body = fs.readFileSync(BRIEF, 'utf8');
	assert.doesNotMatch(body, /before your first edit, write every path/i);
	// Lines are joined where a bullet wraps, so a sentence that spans lines is read whole.
	const joined = body.replace(/\n {2}/g, ' ');
	for (const line of joined.split('\n')) {
		assert.doesNotMatch(line, /\b(you|builder)\b[^.\n]*\b(write|create)\b[^.\n]*kit-unit-files/i, `a line tells the builder to write the list: ${line}`);
	}
	assert.match(joined, /the lead writes `kit-unit-files\.txt` with `unit-lock\.mjs` once the red commit lands/, 'the brief names the lead as the writer of kit-unit-files.txt');
});

// why: guards rule:test-integrity (retest(scope): commit slips past the exact match)
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

// why: guards rule:security-standards (a new branch holding a retest: is held, a key on a new branch is scanned, an unfetched remote head is not misread)
test('pre-push refuses a new branch with a retest: commit, refuses a key on a new branch, and passes a clean push whose remote head this repo never fetched', () => {
	const { dir, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/new ${retest} refs/heads/feat/new ${ZERO}\n`);
	assert.notEqual(r.status, 0, `the new branch was refused: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
	// Folded control (was its own test): catches a new-branch push (remote sha all zeros) that skips the secret scan, so a key goes out with a new branch.
	{
		const { dir: d4, bare: b4 } = pushRepo();
		put(d4, { 'src/keys.js': `export const key = '${['AKIA', 'IOSFODNN7EXAMPLE'].join('')}';\n` });
		const key = commit(d4, 'feat: add a key');
		const sc = pushRun(PROJECT_PRE_PUSH, d4, b4, `refs/heads/feat/new ${key} refs/heads/feat/new ${ZERO}\n`);
		assert.notEqual(sc.status, 0, `the new branch was refused: ${sc.stderr}`);
		assert.match(sc.stderr, /secret/i);
	}
	// Folded control (was its own test): catches a push whose remote head this repo never fetched being read as unreadable, which blocks a push with no retest.
	{
		const { dir: d3, bare: b3 } = pushRepo();
		const parent = kitTemp.makeTemp('lock-other-');
		git(parent, ['clone', '-q', b3, 'other']);
		const other = path.join(parent, 'other');
		git(other, ['checkout', '-q', '-b', 'feat/other']);
		put(other, { 'src/util.js': 'export const id = (x) => x + 1;\n' });
		commit(other, 'feat: other clone work');
		git(other, ['push', '-q', 'origin', 'feat/other']);
		put(d3, { 'src/add.js': 'export const add = (a, b) => a + b + 0;\n' });
		const feat = commit(d3, 'feat: tidy add');
		const nb = pushRun(PROJECT_PRE_PUSH, d3, b3, `refs/heads/feat/x ${feat} refs/heads/feat/x ${ZERO}\n`);
		assert.equal(nb.status, 0, `a push with no retest goes through: ${nb.stderr}`);
		assert.doesNotMatch(nb.stderr, /cannot be read/);
	}
});

// why: guards rule:test-integrity (kit pre-push passes a retest push with no owner yes)
test("the kit's own pre-push refuses a retest: push with no owner's pop-up yes and names it", () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = pushRun(KIT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`);
	assert.notEqual(r.status, 0, `the kit hook refused: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
	// Folded control (was its own test): catches the kit's own pre-push refusing a retest push even with the owner's pop-up yes to that push, unlike the project hook.
	{
		const { dir: d5, red: r5, bare: b5 } = pushRepo();
		put(d5, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const retest5 = commit(d5, 'retest: tighten the add case');
		const input5 = `refs/heads/feat/x ${retest5} refs/heads/feat/x ${r5}\n`;
		const cfg5 = kitTemp.makeTemp('lock-owner-kit-');
		ownerTaps(cfg5, d5, 'git push origin feat/x', { at: new Date(Date.now() - 1000).toISOString() });
		const yes5 = pushRun(KIT_PRE_PUSH, d5, b5, input5, { KIT_OWNER_PUSH: '1', CLAUDE_CONFIG_DIR: cfg5, CLAUDE_CODE_SESSION_ID: TAP_SID });
		assert.equal(yes5.status, 0, `the owner's yes lets the kit hook's push through: ${yes5.stderr}`);
	}
});

// why: guards rule:test-integrity (approved retest push goes through with no pop-up yes)
test('pre-push refuses a retest: push on KIT_PUSH_APPROVED=1 with no owner pop-up yes, naming it and the owner\'s yes', () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = pushRun(PROJECT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`, { KIT_PUSH_APPROVED: '1', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: TAP_SID });
	assert.notEqual(r.status, 0, `the marker alone did not lift the hold: ${r.stderr}`);
	assert.ok(r.stderr.includes('retest: tighten the add case') || r.stderr.includes(retest.slice(0, 7)), `the retest commit is named: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
	// Folded control (was its own test): catches an approved agent push of a retest commit refused even with the owner's pop-up yes to that push.
	{
		const { dir: d6, red: r6, bare: b6 } = pushRepo();
		put(d6, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const retest6 = commit(d6, 'retest: tighten the add case');
		const input6 = `refs/heads/feat/x ${retest6} refs/heads/feat/x ${r6}\n`;
		const cfg6 = kitTemp.makeTemp('lock-approved-');
		ownerTaps(cfg6, d6, 'KIT_PUSH_APPROVED=1 git push origin feat/x', { at: new Date(Date.now() - 1000).toISOString() });
		const ok6 = pushRun(PROJECT_PRE_PUSH, d6, b6, input6, { KIT_PUSH_APPROVED: '1', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: cfg6, CLAUDE_CODE_SESSION_ID: TAP_SID });
		assert.equal(ok6.status, 0, `the approved push with the owner's yes goes through: ${ok6.stderr}`);
	}
});

// why: guards rule:test-integrity (kit pre-push passes an approved retest push with no pop-up yes)
test("the kit's own pre-push refuses a retest: push on KIT_PUSH_APPROVED=1 with no owner pop-up yes and names the owner's yes", () => {
	const { dir, red, bare } = pushRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const r = pushRun(KIT_PRE_PUSH, dir, bare, `refs/heads/feat/x ${retest} refs/heads/feat/x ${red}\n`, { KIT_PUSH_APPROVED: '1', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: TAP_SID });
	assert.notEqual(r.status, 0, `the kit hook refused on the marker alone: ${r.stderr}`);
	assert.ok(r.stderr.includes('retest: tighten the add case') || r.stderr.includes(retest.slice(0, 7)), `the retest commit is named: ${r.stderr}`);
	assert.match(r.stderr, OWNER_YES);
	// Folded control (was its own test): catches the kit's own pre-push refusing an approved retest push even with the owner's pop-up yes to that push.
	{
		const { dir: d7, red: r7, bare: b7 } = pushRepo();
		put(d7, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const retest7 = commit(d7, 'retest: tighten the add case');
		const input7 = `refs/heads/feat/x ${retest7} refs/heads/feat/x ${r7}\n`;
		const cfg7 = kitTemp.makeTemp('lock-approved-kit-');
		ownerTaps(cfg7, d7, 'KIT_PUSH_APPROVED=1 git push origin feat/x', { at: new Date(Date.now() - 1000).toISOString() });
		const ok7 = pushRun(KIT_PRE_PUSH, d7, b7, input7, { KIT_PUSH_APPROVED: '1', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: cfg7, CLAUDE_CODE_SESSION_ID: TAP_SID });
		assert.equal(ok7.status, 0, `the approved push with the owner's yes goes through the kit hook: ${ok7.stderr}`);
	}
});

// why: guards rule:test-integrity (builder brief keeps the test-first line)
test('the builder brief drops the test-first line and says the tester red commit is never edited', () => {
	const body = fs.readFileSync(BRIEF, 'utf8');
	assert.doesNotMatch(body, /Tests to write first/);
	assert.match(body, /tester'?s red commit[^\n]*never edit/i);
});

// why: catches a fix:, feat: or test: commit that edits an existing test file pushed with no owner yes, so a test changes unheld
test('pre-push holds a fix:, feat: or test: commit that edits an existing test file, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		for (const subject of ['fix: tighten the add case', 'feat: tighten the add case', 'test: tighten the add case']) {
			const { dir, red, bare } = pushRepo();
			put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
			const edit = commit(dir, subject);
			const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${edit} refs/heads/feat/x ${red}\n`);
			assert.notEqual(r.status, 0, `${hook} passed "${subject}" that edits tests/add.test.mjs: ${r.stderr}`);
			assert.match(r.stderr, OWNER_YES, `${hook} asks for the owner's yes on "${subject}"`);
		}
		// Folded controls (were their own tests): a commit that only adds a new test file, and a fix: that edits only source, still pass.
		{
			const { dir, red, bare } = pushRepo();
			put(dir, { 'tests/new.test.mjs': 'test("new", () => {});\n' });
			const adds = commit(dir, 'feat: add a new test file');
			const ok = pushRun(hook, dir, bare, `refs/heads/feat/x ${adds} refs/heads/feat/x ${red}\n`);
			assert.equal(ok.status, 0, `${hook} held a new test file: ${ok.stderr}`);
			assert.doesNotMatch(ok.stderr, OWNER_YES);
		}
		{
			const { dir, red, bare } = pushRepo();
			put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 0;\n' });
			const src = commit(dir, 'fix: tidy add');
			const ok = pushRun(hook, dir, bare, `refs/heads/feat/x ${src} refs/heads/feat/x ${red}\n`);
			assert.equal(ok.status, 0, `${hook} held a source-only fix: ${ok.stderr}`);
			assert.doesNotMatch(ok.stderr, OWNER_YES);
		}
	}
});

// why: catches a Retest: commit in capitals pushed unheld, since the subject match is case-sensitive and reads only the type
test('pre-push holds a Retest: commit in any letter case, and passes Retesting: as a word that is no type', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 1;\n' });
		const cap = commit(dir, 'Retest: tighten the add case');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${cap} refs/heads/feat/x ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} passed "Retest:": ${r.stderr}`);
		assert.match(r.stderr, OWNER_YES);
		// Folded control (was its own test): Retesting: is not the retest type, so it still passes.
		const { dir: d2, red: r2, bare: b2 } = pushRepo();
		put(d2, { 'src/add.js': 'export const add = (a, b) => a + b + 2;\n' });
		const near = commit(d2, 'Retesting: tighten the add case');
		const ok = pushRun(hook, d2, b2, `refs/heads/feat/x ${near} refs/heads/feat/x ${r2}\n`);
		assert.equal(ok.status, 0, `${hook} held Retesting:: ${ok.stderr}`);
		assert.doesNotMatch(ok.stderr, OWNER_YES);
	}
});

// why: catches a test file deleted, renamed, or edited at another path (.test.cjs, tests/sub/) pushed unheld, since the hold reads only the subject
test('pre-push holds a delete, a rename, a .test.cjs edit and a tests/sub/ edit of existing test files, in both hooks', () => {
	const cases = [
		{ subject: 'feat: drop the add tests', change: (d) => git(d, ['rm', '-q', 'tests/add.test.mjs']) },
		{ subject: 'fix: rename the add tests', change: (d) => git(d, ['mv', 'tests/add.test.mjs', 'tests/sum.test.mjs']) },
		{ subject: 'fix: tighten the cjs case', base: { 'tests/add.test.cjs': 'test("a", () => {});\n' }, change: (d) => put(d, { 'tests/add.test.cjs': 'test("b", () => {});\n' }) },
		{ subject: 'fix: tighten the sub case', base: { 'tests/sub/add.mjs': 'test("a", () => {});\n' }, change: (d) => put(d, { 'tests/sub/add.mjs': 'test("b", () => {});\n' }) },
	];
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		for (const c of cases) {
			const { dir, red, bare } = pushRepo();
			if (c.base) {
				// The base file is already on the remote, so the push's range holds only the edit.
				put(dir, c.base);
				const base = commit(dir, 'test: add the base test');
				git(dir, ['push', '-q', 'origin', `${base}:refs/heads/feat/base`]);
			}
			c.change(dir);
			const edit = commit(dir, c.subject);
			const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${edit} refs/heads/feat/x ${red}\n`);
			assert.notEqual(r.status, 0, `${hook} passed "${c.subject}": ${r.stderr}`);
			assert.match(r.stderr, OWNER_YES);
		}
	}
});

// why: catches a git revert of a test change pushed unheld, since its subject starts with Revert and no hold reads it
test('pre-push holds a git revert that carries a test change, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, bare } = pushRepo();
		put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const edit = commit(dir, 'test: tighten the add case');
		// The edit is already on the remote, so the push's range holds only the revert.
		git(dir, ['push', '-q', 'origin', `${edit}:refs/heads/feat/base`]);
		git(dir, ['revert', '--no-edit', edit]);
		const revert = git(dir, ['rev-parse', 'HEAD']);
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${revert} refs/heads/feat/x ${ZERO}\n`);
		assert.notEqual(r.status, 0, `${hook} passed the revert: ${r.stderr}`);
		assert.match(r.stderr, OWNER_YES);
	}
});

// why: catches a fixup! retest: commit pushed unheld, since its subject starts with fixup! and the retest type never matches
test('pre-push holds a fixup! retest: commit, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 3;\n' });
		const fix = commit(dir, 'fixup! retest: tighten the add case');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${fix} refs/heads/feat/x ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} passed the fixup!: ${r.stderr}`);
		assert.match(r.stderr, OWNER_YES);
	}
});

// why: catches a tester with no list and no way to write one before the red commit, so its edit fence stops every edit
test('unit-lock --tester writes a test-only list with no red line, and refuses a source file', () => {
	const { dir } = redRepo();
	const run = (files) => spawnSync(process.execPath, [LOCK, '--tester', '--files', files], { cwd: dir, env: isolatedEnv(), encoding: 'utf8' });
	const refused = run('src/add.js,tests/add.test.mjs');
	assert.equal(refused.status, 1, `a source file is refused: ${refused.stdout}${refused.stderr}`);
	assert.equal(fs.existsSync(listPath(dir)), false, 'a refused tester list writes nothing');
	const ok = run('tests/add.test.mjs');
	assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
	assert.deepEqual(listLines(dir), ['tests/add.test.mjs'], 'the list holds the test file, with no red line');
	// Folded control (was its own test): the fence lets the tester edit the test it lists and stops a source file it does not.
	assert.equal(fence(dir, 'tester', 'tests/add.test.mjs').code, 0, 'the tester may edit the test it lists');
	assert.equal(fence(dir, 'tester', 'src/add.js').code, 2, 'the tester may not edit a file it does not list');
});

// why: catches a plugin role sent as kit:builder or kit:tester that the fence reads as no role, so its test edits pass
test('edit fence reads a plugin role name kit:builder or kit:tester as the builder or tester role', () => {
	const { dir } = redRepo();
	assert.equal(fence(dir, 'kit:builder', 'tests/add.test.mjs').code, 2, 'a plugin builder may not edit a test file');
	assert.equal(fence(dir, 'kit:tester', 'src/add.js').code, 2, 'a plugin tester with no list is stopped');
	// Folded control (was its own test): a plugin role that is neither stays unfenced.
	assert.equal(fence(dir, 'kit:scanner', 'src/add.js').code, 0, 'a plugin scanner is not fenced');
});

// why: catches a test edit under another spelling of its type or a scope, pushed unheld, since the hold matches one lowercase form
test('pre-push holds a test edit under any spelling of its type, in both hooks, and repeats its verdict', () => {
	const subjects = ['fix(hooks): tighten the add case', 'Fix: tighten the add case', 'TEST: tighten the add case', 'RETEST: tighten the add case', 'retest: tighten the add case'];
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		for (const subject of subjects) {
			const { dir, red, bare } = pushRepo();
			put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
			const edit = commit(dir, subject);
			const push = () => pushRun(hook, dir, bare, `refs/heads/feat/x ${edit} refs/heads/feat/x ${red}\n`);
			const first = push();
			assert.notEqual(first.status, 0, `${hook} passed "${subject}": ${first.stderr}`);
			assert.match(first.stderr, OWNER_YES);
			assert.notEqual(push().status, 0, `${hook} passed "${subject}" on a repeat`);
		}
	}
});

// why: catches a test edit in the middle of a push range, or on a new branch, pushed unheld because only the tip was read
test('pre-push holds a push whose test edit sits mid-range, and a new branch carrying a test edit, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 4;\n' });
		commit(dir, 'feat: tidy add');
		put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		commit(dir, 'fix: tighten the add test');
		put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 5;\n' });
		const tip = commit(dir, 'feat: tidy add again');
		const mid = pushRun(hook, dir, bare, `refs/heads/feat/x ${tip} refs/heads/feat/x ${red}\n`);
		assert.notEqual(mid.status, 0, `${hook} passed the range with a mid-range test edit: ${mid.stderr}`);
		assert.match(mid.stderr, OWNER_YES);
		const fresh = pushRun(hook, dir, bare, `refs/heads/feat/new ${tip} refs/heads/feat/new ${ZERO}\n`);
		assert.notEqual(fresh.status, 0, `${hook} passed a new branch with a test edit: ${fresh.stderr}`);
	}
});

// Commits the index as it is: no git add -A, which would drop index-only paths the disk does not hold.
function indexCommit(dir, message) {
	git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
	return git(dir, ['rev-parse', 'HEAD']);
}

// A blob written into the index only: a path no Windows file can hold (a newline) still reaches git and the hook.
function indexPut(dir, mode, rel, text) {
	const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, env: isolatedEnv(GIT_ID), input: text, encoding: 'utf8' });
	assert.equal(blob.status, 0, blob.stderr);
	git(dir, ['update-index', '--add', '--cacheinfo', `${mode},${blob.stdout.trim()},${rel}`]);
}

// why: catches a merge that resolves a test file to a third version pushed unheld, since only the merge's own diff against both parents shows it
test('pre-push holds a merge whose resolution changes a test file away from both parents, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		// Both sides' edits are on the remote already, so the push's range holds only the merge.
		git(dir, ['checkout', '-q', '-b', 'topic']);
		put(dir, { 'tests/add.test.mjs': 'test("topic", () => {});\n' });
		const topic = commit(dir, 'test: tighten the topic case');
		git(dir, ['push', '-q', 'origin', `${topic}:refs/heads/feat/topic`]);
		git(dir, ['checkout', '-q', 'main']);
		put(dir, { 'tests/add.test.mjs': 'test("main", () => {});\n' });
		const main = commit(dir, 'test: tighten the main case');
		git(dir, ['push', '-q', 'origin', `${main}:refs/heads/feat/main`]);
		const m = spawnSync('git', ['merge', '--no-ff', '--no-edit', 'topic'], { cwd: dir, env: isolatedEnv(GIT_ID), encoding: 'utf8' });
		assert.notEqual(m.status, 0, 'the two test edits conflict');
		put(dir, { 'tests/add.test.mjs': 'test("resolved", () => {});\n' });
		const merge = commit(dir, 'merge topic');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${merge} refs/heads/feat/x ${ZERO}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a merge that changes a test file away from both parents: ${r.stderr}`);
		assert.match(r.stderr, OWNER_YES);
	}
});

// why: catches a test path with a space pushed unheld, since the hold's path split could read the name as two paths
test('pre-push holds an edit of a test file whose name has a space, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		indexPut(dir, '100644', 'tests/add case.test.mjs', 'test("a", () => {});\n');
		const base = indexCommit(dir, 'test: add the spaced case');
		git(dir, ['push', '-q', 'origin', `${base}:refs/heads/feat/base`]);
		indexPut(dir, '100644', 'tests/add case.test.mjs', 'test("b", () => {});\n');
		const edit = indexCommit(dir, 'fix: tighten the spaced case');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${edit} refs/heads/feat/x ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} passed an edit of tests/add case.test.mjs: ${r.stderr}`);
		assert.match(r.stderr, OWNER_YES);
	}
});

// why: catches a test path with a newline in its name pushed unheld. Index-only, since git refuses such a path on Windows.
test('pre-push holds an edit of a test file whose name has a newline, in both hooks', { skip: process.platform === 'win32' && 'git refuses a newline in a path on Windows; the Linux unit-tests job in .github/workflows/ci.yml runs it' }, () => {
	const name = 'tests/add\ncase.test.mjs';
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		indexPut(dir, '100644', name, 'test("a", () => {});\n');
		const base = indexCommit(dir, 'test: add the newline case');
		git(dir, ['push', '-q', 'origin', `${base}:refs/heads/feat/base`]);
		indexPut(dir, '100644', name, 'test("b", () => {});\n');
		const edit = indexCommit(dir, 'fix: tighten the newline case');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${edit} refs/heads/feat/x ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} passed an edit of a test file with a newline in its name: ${r.stderr}`);
		assert.match(r.stderr, OWNER_YES);
	}
});

// why: catches a test path in capitals pushed unheld, since the hold lowercases the path but a case-sensitive match would miss Tests/
test('pre-push holds an edit of Tests/X.Test.mjs in upper case, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		indexPut(dir, '100644', 'Tests/X.Test.mjs', 'test("a", () => {});\n');
		const base = indexCommit(dir, 'test: add the upper case');
		git(dir, ['push', '-q', 'origin', `${base}:refs/heads/feat/base`]);
		indexPut(dir, '100644', 'Tests/X.Test.mjs', 'test("b", () => {});\n');
		const edit = indexCommit(dir, 'fix: tighten the upper case');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${edit} refs/heads/feat/x ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} passed an edit of Tests/X.Test.mjs: ${r.stderr}`);
		assert.match(r.stderr, OWNER_YES);
	}
});

// why: catches a test file replaced by a symlink (type change, T) pushed unheld, since only edits and deletes were read
test('pre-push holds a type change of a test file, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		indexPut(dir, '120000', 'tests/add.test.mjs', 'src/add.js');
		const change = indexCommit(dir, 'fix: point the add test at source');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${change} refs/heads/feat/x ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a type change of a test file: ${r.stderr}`);
		assert.match(r.stderr, OWNER_YES);
	}
});


// The net-effect hold (lead ruling, per pushed ref): a test path is held when it is modified, deleted or renamed against
// the remote's tip for that ref, whatever the commits that carry it did. The old reading held per commit and missed these.
const HOLD_RE = /holds a test change/;
// The first push gate (rule:first-push-gate) is past in these repos, so each case reads the test hold alone.
function firstPushDone(dir) {
	fs.writeFileSync(path.join(dir, '.git', 'kit-first-push-done'), '');
}
// Merges ref into the checked-out branch; the caller decides whether a conflict is expected.
function mergeRef(dir, ref, extra = []) {
	return spawnSync('git', ['merge', '--no-ff', '--no-edit', ...extra, ref], { cwd: dir, env: isolatedEnv(GIT_ID), encoding: 'utf8' });
}

// why: catches a merge that takes a side branch's new test file over the remote's v1 pushed unheld, since the merge's diff against its first parent is hidden when the result equals the side parent
test('pre-push holds a merge that takes a side branch new test file over the remote v1, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		// The side branch starts from red, before tests/a.test.js exists, and adds it with new content.
		git(dir, ['checkout', '-q', '-b', 'side', red]);
		put(dir, { 'tests/a.test.js': 'test("side a", () => {});\n' });
		commit(dir, 'feat: add the side a case');
		// The feature branch's remote tip holds v1 of the same file.
		git(dir, ['checkout', '-q', '-b', 'feat/x', red]);
		put(dir, { 'tests/a.test.js': 'test("v1 a", () => {});\n' });
		const v1 = commit(dir, 'test: add the v1 a case');
		git(dir, ['push', '-q', 'origin', `${v1}:refs/heads/feat/x`]);
		assert.notEqual(mergeRef(dir, 'side').status, 0, 'the two tests/a.test.js adds conflict');
		put(dir, { 'tests/a.test.js': 'test("side a", () => {});\n' });
		const merge = commit(dir, 'merge side');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${merge} refs/heads/feat/x ${v1}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a merge that takes the side's tests/a.test.js over the remote v1: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
		// Folded control: main's test change is already on the remote, so a new feature branch that merges main is not held.
		const ctl = pushRepo();
		firstPushDone(ctl.dir);
		git(ctl.dir, ['checkout', '-q', '-b', 'feat/new']);
		put(ctl.dir, { 'src/util.js': 'export const id = (x) => x + 1;\n' });
		commit(ctl.dir, 'feat: tune util');
		git(ctl.dir, ['checkout', '-q', 'main']);
		put(ctl.dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const mainTip = commit(ctl.dir, 'test: tighten the add case');
		git(ctl.dir, ['push', '-q', 'origin', `${mainTip}:refs/heads/main`]);
		git(ctl.dir, ['checkout', '-q', 'feat/new']);
		assert.equal(mergeRef(ctl.dir, 'main').status, 0, 'merging main is clean');
		const ctlMerge = git(ctl.dir, ['rev-parse', 'HEAD']);
		const ok = pushRun(hook, ctl.dir, ctl.bare, `refs/heads/feat/new ${ctlMerge} refs/heads/feat/new ${ZERO}\n`);
		assert.equal(ok.status, 0, `${hook} held a merge of main whose test change is on the remote: ${ok.stderr}`);
		assert.doesNotMatch(ok.stderr, HOLD_RE);
		// Folded control (was its own test): a merge that only brings in a test file one parent already holds is not held.
		const t2 = pushRepo();
		git(t2.dir, ['checkout', '-q', '-b', 'topic']);
		put(t2.dir, { 'tests/new.test.mjs': 'test("new", () => {});\n' });
		commit(t2.dir, 'feat: add the new case');
		git(t2.dir, ['checkout', '-q', 'main']);
		put(t2.dir, { 'src/util.js': 'export const id = (x) => x + 1;\n' });
		commit(t2.dir, 'feat: tune util');
		const mT = spawnSync('git', ['merge', '--no-ff', '--no-edit', 'topic'], { cwd: t2.dir, env: isolatedEnv(GIT_ID), encoding: 'utf8' });
		assert.equal(mT.status, 0, `the merge is clean: ${mT.stderr}`);
		const mergeT = git(t2.dir, ['rev-parse', 'HEAD']);
		const rT = pushRun(hook, t2.dir, t2.bare, `refs/heads/feat/x ${mergeT} refs/heads/feat/x ${ZERO}\n`);
		assert.equal(rT.status, 0, `${hook} held a merge that brings in a test file one parent holds: ${rT.stderr}`);
	}
});

// why: catches an orphan root merged with --allow-unrelated-histories that takes its test file over the remote's v1, pushed unheld
test('pre-push holds an orphan root merge that takes its test file over the remote v1, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		git(dir, ['checkout', '-q', '-b', 'feat/x', red]);
		put(dir, { 'tests/a.test.js': 'test("v1 a", () => {});\n' });
		const v1 = commit(dir, 'test: add the v1 a case');
		git(dir, ['push', '-q', 'origin', `${v1}:refs/heads/feat/x`]);
		// The orphan root holds only its own tests/a.test.js with new content.
		git(dir, ['checkout', '-q', '--orphan', 'orphan']);
		git(dir, ['rm', '-r', '-q', '-f', '.']);
		put(dir, { 'tests/a.test.js': 'test("orphan a", () => {});\n' });
		commit(dir, 'feat: add the orphan a case');
		git(dir, ['checkout', '-q', 'feat/x']);
		const m = mergeRef(dir, 'orphan', ['--allow-unrelated-histories']);
		assert.notEqual(m.status, 0, 'the two tests/a.test.js adds conflict');
		put(dir, { 'tests/a.test.js': 'test("orphan a", () => {});\n' });
		const merge = commit(dir, 'merge orphan');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${merge} refs/heads/feat/x ${v1}\n`);
		assert.notEqual(r.status, 0, `${hook} passed an orphan-root merge over the remote v1: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
		// Folded control (was its own test): a new orphan ref that only adds tests is not held, since a ref with no merge base is a fresh add.
		const oT = pushRepo();
		firstPushDone(oT.dir);
		git(oT.dir, ['checkout', '-q', '--orphan', 'feat/new-tests']);
		git(oT.dir, ['rm', '-r', '-q', '-f', '.']);
		put(oT.dir, { 'tests/fresh.test.mjs': 'test("fresh", () => {});\n' });
		const freshT = commit(oT.dir, 'test: add the fresh case');
		const rO = pushRun(hook, oT.dir, oT.bare, `refs/heads/feat/new-tests ${freshT} refs/heads/feat/new-tests ${ZERO}\n`);
		assert.equal(rO.status, 0, `${hook} held a new orphan ref that only adds tests: ${rO.stderr}`);
		assert.doesNotMatch(rO.stderr, HOLD_RE);
	}
});

// why: catches a merge that restores an older copy of a test over the remote tip pushed unheld, since the merge diff is hidden when the result equals the side parent
test('pre-push holds a merge that restores an older copy of a test over the remote tip, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, bare } = pushRepo();
		firstPushDone(dir);
		put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const base = commit(dir, 'test: tighten the add case');
		git(dir, ['checkout', '-q', '-b', 'feat/x']);
		put(dir, { 'tests/add.test.mjs': 'test("adds three", () => {});\n' });
		const tip = commit(dir, 'test: tighten the add case again');
		git(dir, ['push', '-q', 'origin', `${tip}:refs/heads/feat/x`]);
		// The side branch changes the test back to the copy red held; its tip is on the remote, so only the merge is in range.
		git(dir, ['checkout', '-q', '-b', 'side', base]);
		put(dir, { 'tests/add.test.mjs': 'test("adds", () => {});\n' });
		const side = commit(dir, 'fix: restore the first add case');
		git(dir, ['push', '-q', 'origin', `${side}:refs/heads/side`]);
		git(dir, ['checkout', '-q', 'feat/x']);
		assert.notEqual(mergeRef(dir, 'side').status, 0, 'the two test edits conflict');
		put(dir, { 'tests/add.test.mjs': 'test("adds", () => {});\n' });
		const merge = commit(dir, 'merge side');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${merge} refs/heads/feat/x ${tip}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a merge that restores an older test copy over the remote tip: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
	}
});

// why: catches a test edit hidden from the hold by a git replace object, since the hook read the replaced commit's tree
test('pre-push holds a test edit that a git replace object hides, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const edit = commit(dir, 'fix: tighten the add case');
		// The replacement keeps red's tree, so the edit reads as no change only while replace objects are read.
		const tree = git(dir, ['rev-parse', `${red}^{tree}`]);
		const repl = git(dir, ['commit-tree', tree, '-p', red, '-m', 'fix: tighten the add case']);
		git(dir, ['replace', edit, repl]);
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${edit} refs/heads/feat/x ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a test edit hidden by git replace: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
	}
});

// why: catches a test edit hidden by a root graft in .git/info/grafts, since the hook read the commit as a root that adds every file
test('pre-push holds a test edit that a root graft hides, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const edit = commit(dir, 'fix: tighten the add case');
		fs.writeFileSync(path.join(dir, '.git', 'info', 'grafts'), `${edit}\n`);
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${edit} refs/heads/feat/x ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a test edit hidden by a root graft: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
	}
});

// why: catches a push from a shallow clone passed unheld, since the hold cannot see the history a shallow boundary cuts off
test('pre-push holds every push from a shallow repository, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 2;\n' });
		const tip = commit(dir, 'fix: tidy add');
		fs.writeFileSync(path.join(dir, '.git', 'shallow'), `${red}\n`);
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${tip} refs/heads/feat/x ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a push from a shallow repository: ${r.stderr}`);
		assert.match(r.stderr, /shallow/i);
	}
});

// why: catches an amend! or a double fixup! retest subject on an add-only commit pushed unheld, since the subject match reads only one prefix
test('pre-push holds an amend! retest: or fixup! fixup! retest: commit on an add-only change, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		for (const subject of ['amend! retest: z', 'fixup! fixup! retest: z']) {
			const { dir, red, bare } = pushRepo();
			firstPushDone(dir);
			put(dir, { 'tests/new.test.mjs': 'test("new", () => {});\n' });
			const c = commit(dir, subject);
			const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${c} refs/heads/feat/x ${red}\n`);
			assert.notEqual(r.status, 0, `${hook} passed "${subject}" on an add-only commit: ${r.stderr}`);
			assert.match(r.stderr, HOLD_RE);
		}
	}
});

// why: catches a merge that deletes a test file pushed unheld when a remote tip also lacks it, and a merge of a blob only a side branch holds passed as trusted
test('pre-push holds a merge that deletes an existing test file although a remote tip lacks it, passes a merge bringing a blob the remote main holds, and holds one only a side branch holds, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		// A remote branch whose tip never had tests/add.test.mjs, so one remote tip lacks the path.
		git(dir, ['checkout', '-q', '-b', 'feat/gone', red]);
		git(dir, ['rm', '-q', 'tests/add.test.mjs']);
		const gone = commit(dir, 'feat: drop the add case');
		git(dir, ['push', '-q', 'origin', `${gone}:refs/heads/feat/gone`]);
		git(dir, ['checkout', '-q', '-b', 'side', red]);
		put(dir, { 'src/util.js': 'export const id = (x) => x + 1;\n' });
		const side = commit(dir, 'feat: tune util');
		git(dir, ['push', '-q', 'origin', `${side}:refs/heads/side`]);
		git(dir, ['checkout', '-q', '-b', 'feat/x', red]);
		put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 1;\n' });
		commit(dir, 'feat: tune add');
		assert.equal(mergeRef(dir, 'side', ['--no-commit']).status, 0, 'the merge of side is clean');
		git(dir, ['rm', '-q', 'tests/add.test.mjs']);
		const merge = commit(dir, 'merge side and drop the add case');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${merge} refs/heads/feat/x ${ZERO}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a merge that deletes tests/add.test.mjs: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
		// Folded control: a merge brings a test blob the remote main holds, so it is not held. The blob goes to main first.
		const ctl = pushRepo();
		firstPushDone(ctl.dir);
		git(ctl.dir, ['checkout', '-q', '-b', 'side', ctl.red]);
		put(ctl.dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const tightened = commit(ctl.dir, 'test: tighten the add case');
		git(ctl.dir, ['push', '-q', 'origin', `${tightened}:refs/heads/main`]);
		git(ctl.dir, ['checkout', '-q', '-b', 'feat/x', ctl.red]);
		put(ctl.dir, { 'src/add.js': 'export const add = (a, b) => a + b + 1;\n' });
		commit(ctl.dir, 'feat: tune add');
		assert.equal(mergeRef(ctl.dir, 'side').status, 0, 'merging side is clean');
		const ctlMerge = git(ctl.dir, ['rev-parse', 'HEAD']);
		const ok = pushRun(hook, ctl.dir, ctl.bare, `refs/heads/feat/x ${ctlMerge} refs/heads/feat/x ${ZERO}\n`);
		assert.equal(ok.status, 0, `${hook} held a merge whose test blob the remote main holds: ${ok.stderr}`);
		assert.doesNotMatch(ok.stderr, HOLD_RE);
		// The same merge with the blob only on the side branch: a side branch is not a trusted source, so it is held.
		const only = pushRepo();
		firstPushDone(only.dir);
		git(only.dir, ['checkout', '-q', '-b', 'side', only.red]);
		put(only.dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const onlyTight = commit(only.dir, 'test: tighten the add case');
		git(only.dir, ['push', '-q', 'origin', `${onlyTight}:refs/heads/side`]);
		git(only.dir, ['checkout', '-q', '-b', 'feat/x', only.red]);
		put(only.dir, { 'src/add.js': 'export const add = (a, b) => a + b + 1;\n' });
		commit(only.dir, 'feat: tune add');
		assert.equal(mergeRef(only.dir, 'side').status, 0, 'merging side is clean');
		const onlyMerge = git(only.dir, ['rev-parse', 'HEAD']);
		const held = pushRun(hook, only.dir, only.bare, `refs/heads/feat/x ${onlyMerge} refs/heads/feat/x ${ZERO}\n`);
		assert.notEqual(held.status, 0, `${hook} passed a merge whose test blob only a side branch holds: ${held.stderr}`);
		assert.match(held.stderr, HOLD_RE);
	}
});

// A sandbox copy of one pre-push hook beside its test-change helper. The kit hook reads the helper at project/.claude, the
// project hook at .claude. helper is { code, out } for a fake helper that prints out and exits with code, or null for none.
function hookSandbox(hook, helper) {
	const box = kitTemp.makeTemp('lock-scan-');
	const claude = path.join(box, hook === KIT_PRE_PUSH ? 'project/.claude' : '.claude');
	fs.mkdirSync(path.join(box, '.githooks'), { recursive: true });
	fs.mkdirSync(claude, { recursive: true });
	fs.copyFileSync(hook, path.join(box, '.githooks', 'pre-push'));
	for (const f of ['secret-shapes.mjs', 'secret-patterns.mjs', 'safe-spawn.cjs']) fs.copyFileSync(path.resolve('project/.claude', f), path.join(claude, f));
	if (helper) fs.writeFileSync(path.join(claude, 'test-push-scan.mjs'), `process.stdout.write(${JSON.stringify(helper.out)});\nprocess.exitCode = ${helper.code};\n`);
	return path.join(box, '.githooks', 'pre-push');
}

// why: guards rule:test-and-review-cadence (the pre-push hook reads each test-change helper exit, so a no-result exit 10 or a missing helper never lets a test change through)
test('pre-push reads the test-change helper exit: 10 holds with or without a named commit, 1, 2 and 3 hold, 0 passes, a missing helper holds, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 1;\n' });
		const tip = commit(dir, 'feat: tune add');
		const input = `refs/heads/feat/x ${tip} refs/heads/feat/x ${ZERO}\n`;
		// The helper's own hold text, as the real helper prints it: the header, the owner's yes, then the named commit.
		const NAMED = `Push blocked: this push holds a test change (named below). The owner's yes is needed for it.\n  ${red.slice(0, 7)} M tests/add.test.mjs\n`;
		const run = (helper) => pushRun(hookSandbox(hook, helper), dir, bare, input);
		let r = run({ code: 10, out: NAMED });
		assert.notEqual(r.status, 0, `${hook} passed an exit 10 that names a test change: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
		assert.match(r.stderr, new RegExp(red.slice(0, 7)));
		r = run({ code: 10, out: '' });
		assert.notEqual(r.status, 0, `${hook} passed an exit 10 that names nothing: ${r.stderr}`);
		assert.match(r.stderr, /the test-change scan gave no result/);
		r = run({ code: 1, out: NAMED });
		assert.notEqual(r.status, 0, `${hook} passed an exit 1 that names a test change: ${r.stderr}`);
		assert.match(r.stderr, OWNER_YES);
		for (const code of [2, 3]) {
			r = run({ code, out: '' });
			assert.notEqual(r.status, 0, `${hook} passed a helper exit ${code}: ${r.stderr}`);
		}
		r = run({ code: 0, out: '' });
		assert.equal(r.status, 0, `${hook} held a helper exit 0: ${r.stderr}`);
		r = run(null);
		assert.notEqual(r.status, 0, `${hook} passed a push with its test-change helper missing: ${r.stderr}`);
	}
});

// why: catches a merge to main that restores a weak test copy and drops another test pushed unheld, since its diff against a first parent forked before the test existed is empty
test('pre-push holds a merge to main that restores a weak test copy and drops another test, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		// Main holds the strong copy and a second test; the remote main holds both.
		put(dir, { 'tests/strong.test.mjs': 'test("strong", () => {});\n', 'tests/other.test.mjs': 'test("other", () => {});\n' });
		const mainTip = commit(dir, 'test: add the strong and other cases');
		git(dir, ['push', '-q', 'origin', 'main']);
		// The branch forks from red, before either test existed, and adds a weak copy of the strong one.
		git(dir, ['checkout', '-q', '-b', 'old', red]);
		put(dir, { 'tests/strong.test.mjs': 'test("ok", () => {});\n' });
		commit(dir, 'feat: add the strong case');
		// -s ours keeps the branch's tree, so the merge holds the weak copy and no other test; its first parent is the branch.
		assert.equal(mergeRef(dir, 'main', ['-s', 'ours']).status, 0, 'the ours merge is clean');
		const merge = git(dir, ['rev-parse', 'HEAD']);
		const r = pushRun(hook, dir, bare, `refs/heads/main ${merge} refs/heads/main ${mainTip}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a merge to main that restores a weak tests/strong.test.mjs and drops tests/other.test.mjs: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
	}
});

// why: catches a weak test pushed on an orphan branch, then merged into main keeping its copy, passed unheld since the orphan's own push is a fresh add
test('pre-push passes an orphan branch that adds a weak test, then holds the merge that keeps that copy in main, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		git(dir, ['checkout', '-q', '--orphan', 'feat/orphan-weak']);
		git(dir, ['rm', '-r', '-q', '-f', '.']);
		put(dir, { 'tests/add.test.mjs': 'test("ok", () => {});\n' });
		const orphan = commit(dir, 'test: add a weak add case');
		// The orphan's first push is a fresh add of its test, so it passes.
		const up = pushRun(hook, dir, bare, `refs/heads/feat/orphan-weak ${orphan} refs/heads/feat/orphan-weak ${ZERO}\n`);
		assert.equal(up.status, 0, `${hook} held the orphan branch's first push, which only adds a test: ${up.stderr}`);
		git(dir, ['checkout', '-q', 'main']);
		assert.notEqual(mergeRef(dir, 'feat/orphan-weak', ['--allow-unrelated-histories']).status, 0, 'the two tests/add.test.mjs adds conflict');
		// The merge keeps the weak copy over main's strong one.
		put(dir, { 'tests/add.test.mjs': 'test("ok", () => {});\n' });
		const merge = commit(dir, 'merge orphan');
		const r = pushRun(hook, dir, bare, `refs/heads/main ${merge} refs/heads/main ${red}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a merge into main that keeps the orphan's weak tests/add.test.mjs: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
	}
});

// why: catches a merge into main that restores the copy a remote branch holds over main's newer copy, pushed unheld since its first parent is that branch
test('pre-push holds a merge into main that restores the copy a remote branch holds, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		// The remote branch feat/a holds the copy "adds two".
		git(dir, ['checkout', '-q', '-b', 'feat/a', red]);
		put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const featA = commit(dir, 'test: tighten the add case');
		git(dir, ['push', '-q', 'origin', `${featA}:refs/heads/feat/a`]);
		// Main moves on to a newer copy and the remote main takes it.
		git(dir, ['checkout', '-q', 'main']);
		put(dir, { 'tests/add.test.mjs': 'test("adds three", () => {});\n' });
		const mainTip = commit(dir, 'test: tighten the main case');
		git(dir, ['push', '-q', 'origin', 'main']);
		// The merge takes feat/a's tree, so its diff against its first parent is empty while main's copy is replaced.
		git(dir, ['checkout', '-q', 'feat/a']);
		assert.equal(mergeRef(dir, 'main', ['-s', 'ours']).status, 0, 'the ours merge is clean');
		const merge = git(dir, ['rev-parse', 'HEAD']);
		const r = pushRun(hook, dir, bare, `refs/heads/main ${merge} refs/heads/main ${mainTip}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a merge into main that restores the copy remote feat/a holds: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
	}
});

// why: catches a feature tip's test edit that a merge of main resolves back to main's copy pushed unheld, since the merge still differs from the feature tip it sits on
test('pre-push holds a merge of main that resolves a feature test edit back to main, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		// The remote feat/x holds an edit to tests/add.test.mjs.
		git(dir, ['checkout', '-q', '-b', 'feat/x', red]);
		put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
		const edit = commit(dir, 'test: tighten the add case');
		git(dir, ['push', '-q', 'origin', `${edit}:refs/heads/feat/x`]);
		// Main changes the same test, so the merge conflicts and is resolved to main's copy.
		git(dir, ['checkout', '-q', 'main']);
		put(dir, { 'tests/add.test.mjs': 'test("adds three", () => {});\n' });
		commit(dir, 'test: tighten the main case');
		git(dir, ['push', '-q', 'origin', 'main']);
		git(dir, ['checkout', '-q', 'feat/x']);
		assert.notEqual(mergeRef(dir, 'main').status, 0, 'the two test edits conflict');
		put(dir, { 'tests/add.test.mjs': 'test("adds three", () => {});\n' });
		const merge = commit(dir, 'merge main');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${merge} refs/heads/feat/x ${edit}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a merge that resolves the feature test edit back to main's copy: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
	}
});

// why: catches a merge of a main that dropped a test the feature never touched held, and a test the feature added then dropped in a merge passed, since only the first is a net change from main
test('pre-push passes a merge of main that drops a test the feature never touched, and holds a drop of a test the branch added, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		// main holds tests/old.test.mjs, and the remote main holds it too.
		put(dir, { 'tests/old.test.mjs': 'test("old", () => {});\n' });
		commit(dir, 'test: add the old case');
		git(dir, ['push', '-q', 'origin', 'main']);
		// feat/y forks from main before the drop and never touches tests/old.test.mjs.
		git(dir, ['checkout', '-q', '-b', 'feat/y']);
		put(dir, { 'src/util.js': 'export const id = (x) => x + 2;\n' });
		const featY = commit(dir, 'feat: tune util');
		git(dir, ['push', '-q', 'origin', `${featY}:refs/heads/feat/y`]);
		// A PR drops the old test on main, and the remote main takes the drop.
		git(dir, ['checkout', '-q', 'main']);
		git(dir, ['rm', '-q', 'tests/old.test.mjs']);
		commit(dir, 'test: drop the old case');
		git(dir, ['push', '-q', 'origin', 'main']);
		git(dir, ['checkout', '-q', 'feat/y']);
		assert.equal(mergeRef(dir, 'main').status, 0, 'merging main is clean');
		const merge = git(dir, ['rev-parse', 'HEAD']);
		const ok = pushRun(hook, dir, bare, `refs/heads/feat/y ${merge} refs/heads/feat/y ${featY}\n`);
		assert.equal(ok.status, 0, `${hook} held a merge of main that drops a test the branch never touched: ${ok.stderr}`);
		assert.doesNotMatch(ok.stderr, HOLD_RE);
		// Control: a test feat/z adds itself, then a merge with main drops, is held.
		git(dir, ['checkout', '-q', '-b', 'feat/z', red]);
		put(dir, { 'tests/mine.test.mjs': 'test("mine", () => {});\n' });
		const mine = commit(dir, 'test: add the mine case');
		git(dir, ['push', '-q', 'origin', `${mine}:refs/heads/feat/z`]);
		assert.equal(mergeRef(dir, 'main', ['--no-commit']).status, 0, 'merging main is clean');
		git(dir, ['rm', '-q', 'tests/mine.test.mjs']);
		const dropped = commit(dir, 'merge main and drop the mine case');
		const held = pushRun(hook, dir, bare, `refs/heads/feat/z ${dropped} refs/heads/feat/z ${mine}\n`);
		assert.notEqual(held.status, 0, `${hook} passed a merge that drops a test the branch added: ${held.stderr}`);
		assert.match(held.stderr, HOLD_RE);
	}
});

// why: catches a push whose remote value this clone never fetched passed or held without saying so, since the hold must fail closed and name the fix
test('pre-push holds a push whose remote value is not a local commit, and says fetch first, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, red, bare } = pushRepo();
		firstPushDone(dir);
		// Another clone pushes feat/x, so the remote holds a commit this clone never fetched.
		const parent = kitTemp.makeTemp('lock-other-');
		git(parent, ['clone', '-q', bare, 'clone']);
		const other = path.join(parent, 'clone');
		git(other, ['checkout', '-q', '-b', 'feat/x', 'origin/main']);
		put(other, { 'src/util.js': 'export const id = (x) => x + 5;\n' });
		const remoteOnly = commit(other, 'feat: tune util elsewhere');
		git(other, ['push', '-q', 'origin', 'feat/x']);
		// This clone's feat/x is a different commit, and it names the remote's value as the old one.
		git(dir, ['checkout', '-q', '-b', 'feat/x', red]);
		put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 3;\n' });
		const tip = commit(dir, 'feat: tune add');
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${tip} refs/heads/feat/x ${remoteOnly}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a push whose remote value this clone never fetched: ${r.stderr}`);
		assert.match(r.stderr, /fetch first/);
	}
});

// why: catches a merge that changes a test path passed on a remote with no default branch, since a missing default must hold the change, not let it through
test('pre-push holds a merge that changes a test path on a remote with no default branch, in both hooks', () => {
	for (const hook of [KIT_PRE_PUSH, PROJECT_PRE_PUSH]) {
		const { dir, bare } = pushRepo();
		firstPushDone(dir);
		// The bare repo's HEAD names a branch the remote does not have, so ls-remote reports no default branch.
		fs.writeFileSync(path.join(bare, 'HEAD'), 'ref: refs/heads/no-default\n');
		git(dir, ['checkout', '-q', '-b', 'feat/x', 'main']);
		put(dir, { 'src/util.js': 'export const id = (x) => x + 4;\n' });
		const featX = commit(dir, 'feat: tune util');
		git(dir, ['push', '-q', 'origin', `${featX}:refs/heads/feat/x`]);
		// Main changes its test on the local side only; merging it into feat/x brings that change into the merge.
		git(dir, ['checkout', '-q', 'main']);
		put(dir, { 'tests/add.test.mjs': 'test("adds three", () => {});\n' });
		commit(dir, 'test: tighten the main case');
		git(dir, ['checkout', '-q', 'feat/x']);
		assert.equal(mergeRef(dir, 'main').status, 0, 'merging main is clean');
		const merge = git(dir, ['rev-parse', 'HEAD']);
		const r = pushRun(hook, dir, bare, `refs/heads/feat/x ${merge} refs/heads/feat/x ${featX}\n`);
		assert.notEqual(r.status, 0, `${hook} passed a merge that changes a test path on a remote with no default branch: ${r.stderr}`);
		assert.match(r.stderr, HOLD_RE);
	}
});


