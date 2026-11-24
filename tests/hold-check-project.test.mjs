// Hold check and project guards (U28, K375 S1). A hold's hook file is looked for in user/kit-hooks alone, but the project
// guards (owner-proof, task-gate, guard-outward, guard-delete, guard-read) live in project/.claude, so the release check
// reads each one as missing. Each test builds a temp repo with a v1.0.0 release and the working-tree files it needs, then
// runs user/kit-tools/hold-check.mjs on that repo as a child process.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOLD_CHECK = path.resolve('user/kit-tools/hold-check.mjs');
const GIT_ID = { GIT_AUTHOR_NAME: 'Tester', GIT_AUTHOR_EMAIL: 'tester@example.invalid', GIT_COMMITTER_NAME: 'Tester', GIT_COMMITTER_EMAIL: 'tester@example.invalid' };

// A child process environment whose home and Claude config folders are temp dirs, so no test reads the real home.
function isolatedEnv() {
	const home = kitTemp.makeTemp('hold-check-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, ...GIT_ID, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config };
}

function git(cwd, args) {
	const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
}

// Writes each file under dir, making its folders first.
function put(dir, files) {
	for (const [rel, text] of Object.entries(files)) {
		const file = path.join(dir, rel);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
	}
}

// A repo whose v1.0.0 release has no holds list; the given files are then written into its working tree.
function repoAfterRelease(files) {
	const dir = kitTemp.makeTemp('hold-check-project-');
	git(dir, ['init', '-q', '-b', 'main']);
	put(dir, { 'README.md': 'kit\n' });
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '-m', 'release']);
	git(dir, ['tag', 'v1.0.0']);
	put(dir, files);
	return dir;
}

const holdsText = (holds) => `${JSON.stringify({ holds }, null, 2)}\n`;

// Runs the check on dir as a child process; out holds stdout and stderr together.
function runCheck(dir) {
	const r = spawnSync(process.execPath, [HOLD_CHECK, dir], { cwd: dir, env: isolatedEnv(), encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// why: catches a project guard reported as a missing hook file, so its enforce hold fails the release check (K375 S1)
test('a hold whose hook file is a project guard in project/.claude passes the hold check', () => {
	const dir = repoAfterRelease({
		'user/kit-hooks/holds.json': holdsText([
			{ id: 'owner-proof', hook: 'owner-proof.cjs', mode: 'enforce', tier: 'security' },
			{ id: 'kit-hold', hook: 'kit-hold.cjs', mode: 'enforce', tier: 'high' },
		]),
		'project/.claude/owner-proof.cjs': '// owner-proof\n',
		'user/kit-hooks/kit-hold.cjs': '// kit-hold\n',
	});
	const r = runCheck(dir);
	assert.equal(r.code, 0, r.out);
});

// why: catches a missing-hook report that names only user/kit-hooks, so a project guard's gap reads as a kit gap (K375 S1)
test('a hold whose hook file is in neither user/kit-hooks nor project/.claude still fails, naming both folders', () => {
	const dir = repoAfterRelease({
		'user/kit-hooks/holds.json': holdsText([
			{ id: 'stray-hold', hook: 'stray.cjs', mode: 'enforce', tier: 'high' },
			{ id: 'climb-project', hook: '../owner-proof.cjs', mode: 'enforce', tier: 'security' },
			{ id: 'climb-kit', hook: '../kit-hooks/real.cjs', mode: 'enforce', tier: 'high' },
		]),
		'project/owner-proof.cjs': '// owner-proof\n',
		'user/kit-hooks/real.cjs': '// real\n',
	});
	const r = runCheck(dir);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /stray-hold/);
	assert.match(r.out, /climb-project/);
	assert.match(r.out, /climb-kit/);
	assert.match(r.out, /user[\\/]kit-hooks/);
	assert.match(r.out, /project[\\/]\.claude/);
});
