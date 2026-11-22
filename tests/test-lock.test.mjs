// The test lock (U4, build 24, K308): after the red commit lands, the lead writes kit-unit-files.txt with source files
// only, the builder's edit fence then refuses every test file and the list itself, a retest: commit (a test change
// after red) is held at push for the owner's yes, and the builder brief no longer has the builder write its own list.
// Every case runs in a temp git repo with HOME and the Claude folders pointed at temp dirs, so no test reads the real home.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const LOCK = path.resolve('user/kit-tools/unit-lock.mjs');
const FENCE = path.resolve('user/kit-hooks/edit-fence.cjs');
const PRE_PUSH = path.resolve('.githooks/pre-push');
const BRIEF = path.resolve('user/skills/agent-team-build/templates/builder-brief.md');

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
// The lead's lock for a unit: runs the lock tool at the red sha with the source files named.
function lock(dir, redSha, files) {
	const r = spawnSync(process.execPath, [LOCK, redSha, '--files', files.join(',')], { cwd: dir, env: isolatedEnv(), encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
// One PreToolUse call of the edit fence, as the builder role sends it.
function fence(dir, agentType, filePath) {
	const input = JSON.stringify({ cwd: dir, agent_type: agentType, tool_name: 'Edit', tool_input: { file_path: filePath } });
	const r = spawnSync(process.execPath, [FENCE], { cwd: dir, env: isolatedEnv(), input, encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
// A unit's red commit: a source file and its test file, both committed on main.
function redRepo() {
	const dir = repo();
	put(dir, { 'src/add.js': 'export const add = (a, b) => a + b;\n', 'src/util.js': 'export const id = (x) => x;\n', 'tests/add.test.mjs': 'test("adds", () => {});\n' });
	const red = commit(dir, 'test: add cases');
	return { dir, red };
}

// why: guards rule:agent-role-table (the lead's lock must hold the unit's source files, so the builder edits only those)
test('unit-lock writes the source files it is given to the unit file list and prints them', () => {
	const { dir, red } = redRepo();
	const r = lock(dir, red, ['src/add.js', 'src/util.js']);
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /src\/add\.js/);
	assert.match(r.out, /src\/util\.js/);
	const lines = fs.readFileSync(listPath(dir), 'utf8').split(/\r?\n/).filter(Boolean);
	assert.deepEqual(lines, ['src/add.js', 'src/util.js']);
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

// why: catches a test file outside tests/ slipping into the list, so a root-level test is editable by the builder
test('unit-lock exits 1 and names a *.test.mjs file given outside tests/', () => {
	const { dir, red } = redRepo();
	put(dir, { 'src/add.test.mjs': 'test("x", () => {});\n' });
	commit(dir, 'test: a root case');
	const r = lock(dir, red, ['src/add.test.mjs']);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /src\/add\.test\.mjs/);
});

// why: catches a builder editing its own test file, which would turn the red test green by rewriting it
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

// why: catches a retest: commit pushed with no owner yes, so a test changed after red ships unseen
test('pre-push refuses a push whose range holds a retest: commit, names it and says an owner yes is needed', () => {
	const { dir, red } = redRepo();
	put(dir, { 'tests/add.test.mjs': 'test("adds two", () => {});\n' });
	const retest = commit(dir, 'retest: tighten the add case');
	const subject = 'retest: tighten the add case';
	const r = spawnSync('sh', [PRE_PUSH], { cwd: dir, env: isolatedEnv(), input: `refs/heads/main ${retest} refs/heads/main ${red}\n`, encoding: 'utf8' });
	assert.notEqual(r.status, 0, `pre-push refused: ${r.stderr}`);
	assert.ok(r.stderr.includes(subject) || r.stderr.includes(retest.slice(0, 7)), `the retest commit is named: ${r.stderr}`);
	assert.match(r.stderr, /owner yes/i);
});

// why: catches a push of an ordinary commit refused for a retest it does not hold, so every push stops
test('pre-push does not refuse a range with no retest: commit for that reason', () => {
	const { dir, red } = redRepo();
	put(dir, { 'src/add.js': 'export const add = (a, b) => a + b + 0;\n' });
	const feat = commit(dir, 'feat: tidy add');
	const r = spawnSync('sh', [PRE_PUSH], { cwd: dir, env: isolatedEnv(), input: `refs/heads/main ${feat} refs/heads/main ${red}\n`, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.doesNotMatch(r.stderr, /owner yes/i);
});

// why: catches the builder brief telling the builder to write its own file list, which lets it widen its own fence
test('the builder brief template does not tell the builder to write its own file list', () => {
	const body = fs.readFileSync(BRIEF, 'utf8');
	assert.doesNotMatch(body, /before your first edit, write every path/i);
	assert.match(body, /\blead\b[^\n]{0,80}kit-unit-files\.txt/, 'the brief names the lead as the writer of kit-unit-files.txt');
});
