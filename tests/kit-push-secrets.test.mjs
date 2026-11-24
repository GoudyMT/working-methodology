// The secret scans of the kit source (K371): the worktree's own .githooks/pre-push and .githooks/pre-commit run in
// throwaway repos, against a copy of this kit's hook folder and project/.claude. A key-shaped value is never written
// whole in this file: its parts are joined at run time, and the literal goes only into a throwaway repo's file.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const BRANCH = 'feature/push-scan';
const FILE = 'lib/aws-config.mjs';
const ENV = { ...process.env };
for (const k of ['CLAUDECODE', 'AI_AGENT', 'KIT_PUSH_APPROVED', 'KIT_OWNER_PUSH', 'CLAUDE_CODE_SESSION_ID', 'GIT_DIR', 'GIT_INDEX_FILE',
	'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete ENV[k];
const ID = ['-c', 'user.name=Scratch Tester', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false'];
const git = (cwd, args) => spawnSync('git', [...ID, ...args], { cwd, encoding: 'utf8', env: ENV });

// The AWS key shape, in two parts: no whole key is written in this file.
const KEY_PARTS = ['AKIA', 'IOSFODNN7EXAMPLE'];
const KEY_LITERAL = KEY_PARTS.join('');
const LITERAL = `export const key = "${KEY_LITERAL}";\n`;
const JOINED = `export const key = ${JSON.stringify(KEY_PARTS)}.join('');\n`;
const CLEAN = 'export const key = null;\n';

// A copy of this kit's hook folder and project/.claude, so a test can take one file out and the hooks read the copy.
function kitCopy(omit = []) {
	const kit = kitTemp.makeTemp('push-scan-kit-');
	fs.cpSync(path.join(KIT, '.githooks'), path.join(kit, '.githooks'), { recursive: true });
	fs.cpSync(path.join(KIT, 'project', '.claude'), path.join(kit, 'project', '.claude'), { recursive: true });
	for (const f of omit) fs.rmSync(path.join(kit, 'project', '.claude', f), { force: true });
	for (const f of fs.readdirSync(path.join(kit, '.githooks'))) fs.chmodSync(path.join(kit, '.githooks', f), 0o755);
	return kit;
}

// A bare remote and a work clone with one commit pushed. Commits made here run no hooks, as a commit made on the web
// or in a cloud session does: the commits a test names are the ones the push sends.
function repo() {
	const root = kitTemp.makeTemp('push-scan-repo-');
	const remote = path.join(root, 'remote.git');
	const work = path.join(root, 'work');
	const none = path.join(root, 'no-hooks');
	fs.mkdirSync(work);
	fs.mkdirSync(none);
	git(root, ['init', '-q', '--bare', '-b', 'main', remote]);
	git(work, ['init', '-q', '-b', BRANCH]);
	git(work, ['remote', 'add', 'origin', remote]);
	fs.writeFileSync(path.join(work, 'README.md'), '# scratch\n');
	git(work, ['add', '-A']);
	git(work, ['-c', `core.hooksPath=${none}`, 'commit', '-q', '-m', 'docs: a readme']);
	git(work, ['-c', `core.hooksPath=${none}`, 'push', '-q', 'origin', BRANCH]);
	return { work, none };
}

// Writes one file and commits it under the given hooks folder; the commit's result is returned.
function record(work, file, body, hooksPath) {
	fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
	fs.writeFileSync(path.join(work, file), body);
	git(work, ['add', '-A']);
	return git(work, ['-c', `core.hooksPath=${hooksPath}`, 'commit', '-q', '-m', 'feat: add the config module']);
}

// The push as the owner's git runs it: the kit copy's pre-push hook, and what it printed.
function push(work, kit) {
	const r = git(work, ['-c', `core.hooksPath=${path.join(kit, '.githooks')}`, 'push', 'origin', BRANCH]);
	return { status: r.status, out: `${r.stdout}${r.stderr}`, err: r.stderr };
}

// why: catches a push whose commit adds a literal AWS-shaped key in a test file is blocked with "Push blocked: a secret-shaped" (K371 S1)
test('a push whose commit adds a literal AWS-shaped key in a test file is blocked with "Push blocked: a secret-shaped"', () => {
	const { work, none } = repo();
	assert.equal(record(work, FILE, LITERAL, none).status, 0, 'the setup commit did not land');
	const r = push(work, kitCopy());
	assert.notEqual(r.status, 0, `a push of a whole key went through: ${r.out}`);
	assert.match(r.err, /Push blocked: a secret-shaped/);
});

// why: catches a push whose test builds the value from joined parts at run time passes the scan (K371 S2)
test('a push whose test builds the value from joined parts at run time passes the scan', () => {
	const { work, none } = repo();
	assert.equal(record(work, FILE, JOINED, none).status, 0, 'the setup commit did not land');
	const r = push(work, kitCopy());
	assert.equal(r.status, 0, `a joined value was held: ${r.out}`);
	assert.match(r.out, /NO SECRET SHAPES/, 'the scan did not read the pushed commit');
});

// why: guards rule:security-standards (a key in any pushed commit is blocked, even one taken out later) (K371 S1)
test('bypass: a key added in one commit and taken out in the next is still blocked, since every pushed commit is read', () => {
	const { work, none } = repo();
	assert.equal(record(work, FILE, LITERAL, none).status, 0, 'the first setup commit did not land');
	assert.equal(record(work, FILE, CLEAN, none).status, 0, 'the second setup commit did not land');
	const r = push(work, kitCopy());
	assert.notEqual(r.status, 0, `a key taken out again went through: ${r.out}`);
	assert.match(r.err, /Push blocked: a secret-shaped/);
});

// why: catches repeat: the same push twice is blocked the same way (K371 S1)
test('repeat: the same push twice is blocked the same way', () => {
	const { work, none } = repo();
	const kit = kitCopy();
	assert.equal(record(work, FILE, LITERAL, none).status, 0, 'the setup commit did not land');
	const first = push(work, kit);
	const second = push(work, kit);
	assert.notEqual(first.status, 0, `the first push went through: ${first.out}`);
	assert.match(first.err, /Push blocked: a secret-shaped/);
	assert.notEqual(second.status, 0, `the second push went through: ${second.out}`);
	assert.match(second.err, /Push blocked: a secret-shaped/);
});

// why: catches fail-closed: a missing secret-shapes.mjs blocks the push and is logged on stderr (K371 S3)
test('fail-closed: a missing secret-shapes.mjs blocks the push and is logged on stderr', () => {
	const { work, none } = repo();
	assert.equal(record(work, FILE, CLEAN, none).status, 0, 'the setup commit did not land');
	const r = push(work, kitCopy(['secret-shapes.mjs']));
	assert.notEqual(r.status, 0, `a push with no scan script went through: ${r.out}`);
	assert.match(r.err, /the secret scan \(project\/\.claude\/secret-shapes\.mjs\) is missing; reinstall the kit\./); // pin: 2 the refused push says what to do
});

// why: catches write-time twin: a commit staging a file that holds a whole AWS-shaped key is refused by the pre-commit hook with "Commit blocked: a secret-shaped", and a value joined at run time passes (K371 CIFP)
test('write-time twin: a commit staging a file that holds a whole AWS-shaped key is refused by the pre-commit hook with "Commit blocked: a secret-shaped", and a value joined at run time passes', () => {
	const { work } = repo();
	const hooks = path.join(kitCopy(), '.githooks');
	const whole = record(work, FILE, LITERAL, hooks);
	assert.notEqual(whole.status, 0, `a commit of a whole key went through: ${whole.stderr}`);
	assert.match(whole.stderr, /Commit blocked: a secret-shaped/);
	const joined = record(work, FILE, JOINED, hooks);
	assert.equal(joined.status, 0, `a joined value was refused: ${joined.stderr}`);
});

// why: catches a key added in one branch commit and removed in the next passing the CI scan as a clean net diff
test('the CI branch scan reads each commit of base..HEAD, so a key added and then removed is still a hit', () => {
	// The branch scan as CI runs it: the kit copy's secret-shapes.mjs in the work clone, against a base commit.
	const ciScan = (work, kit, base) => {
		const r = spawnSync(process.execPath, [path.join(kit, 'project', '.claude', 'secret-shapes.mjs'), base], { cwd: work, encoding: 'utf8', env: ENV });
		return { status: r.status, out: `${r.stdout}${r.stderr}` };
	};
	const { work, none } = repo();
	const base = git(work, ['rev-parse', 'HEAD']).stdout.trim();
	assert.equal(record(work, FILE, LITERAL, none).status, 0, 'the first setup commit did not land');
	assert.equal(record(work, FILE, CLEAN, none).status, 0, 'the second setup commit did not land');
	const r = ciScan(work, kitCopy(), base);
	assert.notEqual(r.status, 0, `a key taken out again passed the CI scan: ${r.out}`);
	assert.match(r.out, /secret-shaped hit/);
});

// why: catches a key inside a file git treats as binary (a NUL byte) passing every secret scan unread
test('a key in a file with a NUL byte is still a hit in the push scan and the CI branch scan', () => {
	const ciScan = (work, kit, base) => {
		const r = spawnSync(process.execPath, [path.join(kit, 'project', '.claude', 'secret-shapes.mjs'), base], { cwd: work, encoding: 'utf8', env: ENV });
		return { status: r.status, out: `${r.stdout}${r.stderr}` };
	};
	const { work, none } = repo();
	const base = git(work, ['rev-parse', 'HEAD']).stdout.trim();
	assert.equal(record(work, 'lib/blob.txt', `\u0000\n${LITERAL}`, none).status, 0, 'the setup commit did not land');
	const kit = kitCopy();
	const pushed = push(work, kit);
	assert.notEqual(pushed.status, 0, `a push of a key behind a NUL byte went through: ${pushed.out}`);
	assert.match(pushed.err, /Push blocked: a secret-shaped/);
	const ci = ciScan(work, kit, base);
	assert.notEqual(ci.status, 0, `the CI scan read the NUL file as clean: ${ci.out}`);
	assert.match(ci.out, /secret-shaped hit/);
});
